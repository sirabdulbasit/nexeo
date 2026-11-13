/**
 * W-1 "Wiki first", Nexeo's side (Functional Charter, section "Wiki first", agreed by the founder 13 Nov 2026 16:25:47
 * PKT with S1–S3). Everything Suzi captures is placed in the Wiki, through the Wiki's own door only:
 *
 *   identity.put    {kind: voiceprint|faceprint|voice_sample, data, model}  signed + confirmed. An encrypted 'record'
 *                   source per kind (S2: readable only by his own devices, used only to verify him).
 *   identity.get    {kind}                                             answers his own device only (the act is his).
 *   identity.delete {kind}                                             signed. not_yet until the Wiki has a removal door.
 *   profile.update  {notes[{key, value, evidence_count, updated}]}      confirmed. One note "How to work with <user>";
 *                   the pack returns it as profile{} (USER learning only; GENERIC goes to Suzi Master as learning.note).
 *   device.report   {settings, audit[], usage}                         daily. One 'record' source per device per day.
 */
import prisma from '../../db/prisma';

type Args = Record<string, unknown>;
type Result = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const fail = (error: string, detail?: string): Result => ({ ok: false, error, ...(detail ? { detail } : {}) });

export const W1_OPS = ['identity.put', 'identity.get', 'identity.delete', 'profile.update', 'device.report'] as const;
export const IDENTITY_KINDS = ['voiceprint', 'faceprint', 'voice_sample'] as const;
const MAX_IDENTITY_BYTES = 3 * 1024 * 1024;
const MAX_REPORT_BYTES = 256 * 1024;

const identityId = (kind: string) => `identity:${kind}`;

async function userName(clientNumber: string, userId: number): Promise<string> {
  const u = await prisma.user.findFirst({ where: { id: userId, clientNumber } as any, select: { name: true, email: true } as any }).catch(() => null) as any;
  return String(u?.name || u?.email || `User ${userId}`);
}
export const profileTitle = (name: string) => `How to work with ${name}`;

/** His profile note's facts, for the pack's profile{} (key -> value). null when there is none or it cannot be read. */
export async function profileOf(clientNumber: string, userId: number): Promise<Record<string, unknown> | null> {
  const { getNote } = await import('../wiki/wikiStore');
  const n = await getNote(clientNumber, userId, { title: profileTitle(await userName(clientNumber, userId)) }).catch(() => null);
  const p = (n?.properties ?? {}) as Record<string, any>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (k.startsWith('profile.') && v && typeof v === 'object') out[k.slice(8)] = (v as any).value;
  return Object.keys(out).length ? out : null;
}

export async function runW1Op(clientNumber: string, userId: number, op: string, a: Args, confirmed: boolean,
  gate: { signatureVerified: boolean; deviceId?: string | null }): Promise<Result> {
  const { sourceId, saveSource, readSource } = await import('../wiki/wikiSources');
  const writer = { clientNumber, userId };

  if (op === 'identity.put' || op === 'identity.get' || op === 'identity.delete') {
    const kind = text(a.kind);
    if (!(IDENTITY_KINDS as readonly string[]).includes(kind)) return fail('bad_kind', 'kind is voiceprint, faceprint or voice_sample');
    if (op === 'identity.get') {
      const src = await readSource(clientNumber, userId, sourceId(clientNumber, userId, 'record', identityId(kind))).catch(() => null);
      if (!src?.body) return fail('not_found');
      try { const v = JSON.parse(src.body); return { ok: true, item: { kind, data: v.data, model: v.model ?? null, at: v.at ?? null } }; }
      catch { return fail('not_found'); }
    }
    if (!confirmed) return fail('needs_confirmation');
    if (!gate.signatureVerified) return fail('needs_signature', 'identity changes are signed by the device (W-1, S2)');
    if (op === 'identity.delete') return fail('not_yet', 'removal from the Wiki is not available yet; nothing was changed');
    const data = text(a.data);
    if (!data) return fail('bad_data');
    if (Buffer.byteLength(data) > MAX_IDENTITY_BYTES) return fail('too_big', 'at most 3 MB');
    const model = text(a.model).slice(0, 100) || null;
    const at = new Date().toISOString();
    await saveSource({
      clientNumber, userId, kind: 'record', externalId: identityId(kind), title: `Identity: ${kind}`, occurredAt: new Date(),
      body: JSON.stringify({ data, model, at }), encrypt: true,
      details: { type: 'identity', kind, model, bytes: Buffer.byteLength(data), device_id: gate.deviceId ?? null },
    });
    return { ok: true, item: { kind, stored: true, at } };
  }

  if (op === 'profile.update') {
    if (!confirmed) return fail('needs_confirmation');
    const notes = Array.isArray(a.notes) ? (a.notes as any[]).slice(0, 100) : [];
    const clean = notes
      .map((n) => ({ key: text(n?.key).slice(0, 80), value: n?.value, evidence_count: Number(n?.evidence_count) || 0, updated: text(n?.updated) || new Date().toISOString() }))
      .filter((n) => /^[a-z0-9_.-]+$/i.test(n.key) && n.value !== undefined && JSON.stringify(n.value).length <= 2000);
    if (!clean.length) return fail('bad_notes', 'notes[{key, value, evidence_count, updated}]');
    const { writeNote, getNote } = await import('../wiki/wikiStore');
    const name = await userName(clientNumber, userId);
    const title = profileTitle(name);
    const props: Record<string, unknown> = {};
    for (const n of clean) props[`profile.${n.key}`] = { value: n.value, evidence_count: n.evidence_count, updated: n.updated };
    const existing = await getNote(clientNumber, userId, { title }).catch(() => null);
    const merged = { ...((existing?.properties ?? {}) as Record<string, any>), ...props };
    const lines = Object.entries(merged).filter(([k]) => k.startsWith('profile.'))
      .map(([k, v]: [string, any]) => `- **${k.slice(8)}**: ${typeof v?.value === 'string' ? v.value : JSON.stringify(v?.value)} (seen ${v?.evidence_count ?? 0} times)`);
    await writeNote({
      clientNumber, userId, type: 'person', title, scope: 'user', actor: 'suzi',
      body: [`What Suzi has learned about how ${name} likes to work (W-1, his own; never shared).`, '', ...lines].join('\n'),
      properties: props, ids: [`profile:user:${userId}`],
    });
    return { ok: true, item: { title, keys: clean.map((n) => n.key) } };
  }

  if (op === 'device.report') {
    const report = { settings: a.settings ?? {}, audit: Array.isArray(a.audit) ? a.audit : [], usage: a.usage ?? {} };
    if (JSON.stringify(report).length > MAX_REPORT_BYTES) return fail('too_big', 'at most 256 KB');
    const day = new Date().toISOString().slice(0, 10);
    const device = String(gate.deviceId ?? 'unknown').slice(0, 60);
    await saveSource({
      clientNumber, userId, kind: 'record', externalId: `device-report:${device}:${day}`, title: `Suzi device report, ${day}`, occurredAt: new Date(),
      body: `Suzi device ${device}, ${day}: ${report.audit.length} audit entries.`,
      details: { type: 'device_report', device_id: device, day, ...report },
    });
    void writer;
    return { ok: true, item: { day, stored: true } };
  }
  return fail('unknown_op');
}
