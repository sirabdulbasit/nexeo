/**
 * Meeting record standard (founder 24 Nov 2026: "Make the minutes the main meeting page (summary → decisions →
 * actions → risks/blockers → open questions). Keep the full transcript one click away, with each decision and action
 * linked to its supporting timestamp. Never silently guess unclear words, or assign a speaker without enough
 * confidence."). Agreed with Suzi-Builder 25 Nov (field name transcript_en).
 *
 * The record carries, beside minutes text:
 *   decisions[]      {id, text, confirmed_by?, source?: [from_ts, to_ts]}
 *   action_items[]   {id, title, owner_name? | owner_needed: true, person_id?, due? (YYYY-MM-DD), dependency?, status?, source?, state}
 *   record_fields    {risks[{id, text, impact?, response?}], open_questions[], chair?, purpose?, record_status: draft | approved}
 *   transcript_en    [{t, speaker, text}] — the English version, the original stays in transcript
 *   transcript_edits [{at, who, index, before, after}] — every correction kept
 * Nothing here invents an owner or a date: a missing one stays missing (owner_needed), never guessed.
 */
type Args = Record<string, unknown>;
const text = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const span = (v: unknown): [string, string] | undefined =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string' && x.length <= 12) ? [v[0], v[1]] : undefined;

export interface Decision { id: string; text: string; confirmed_by?: string; source?: [string, string] }
export interface Risk { id: string; text: string; impact?: string; response?: string }
export interface RecordFields { risks: Risk[]; open_questions: string[]; chair?: string; purpose?: string; record_status: 'draft' | 'approved' }

export function decisionsArg(v: unknown): Decision[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 100).map((x: any, i) => {
    if (typeof x === 'string') return x.trim() ? { id: `D${i + 1}`, text: x.trim().slice(0, 1000) } : null;
    const t = text(x?.text, 1000);
    if (!t) return null;
    return { id: text(x?.id, 20) || `D${i + 1}`, text: t, ...(text(x?.confirmed_by, 200) ? { confirmed_by: text(x.confirmed_by, 200) } : {}), ...(span(x?.source) ? { source: span(x.source) } : {}) };
  }).filter(Boolean) as Decision[];
}

/** Action items as Suzi sends them (title or text; owner as person_id/name or owner_needed). */
export function actionItemsArg(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 200).map((x: any) => {
    const title = text(x?.title, 300) || text(x?.text, 300);
    if (!title) return null;
    const owner = x?.owner && typeof x.owner === 'object' ? x.owner : {};
    const ownerName = text(x?.owner_name, 120) || text(owner?.name, 120) || (typeof x?.owner === 'string' ? text(x.owner, 120) : '');
    const personId = text(x?.person_id, 60) || text(owner?.person_id, 60);
    const due = text(x?.due, 10);
    return {
      title,
      ...(ownerName ? { owner_name: ownerName } : {}), ...(personId ? { person_id: personId } : {}),
      ...(!ownerName && !personId ? { owner_needed: true } : {}),
      ...(DAY.test(due) && !isNaN(Date.parse(`${due}T12:00:00Z`)) ? { due } : {}),
      ...(text(x?.dependency, 300) ? { dependency: text(x.dependency, 300) } : {}),
      ...(text(x?.status, 40) ? { status: text(x.status, 40) } : {}),
      ...(span(x?.source) ? { source: span(x.source) } : {}),
      ...(text(x?.id, 20) ? { ref: text(x.id, 20) } : {}),
    };
  }).filter(Boolean) as Array<Record<string, unknown>>;
}

export function recordFieldsArg(a: Args): RecordFields {
  const risks = Array.isArray(a.risks) ? (a.risks as any[]).slice(0, 50).map((x, i) => {
    const t = typeof x === 'string' ? x.trim().slice(0, 1000) : text(x?.text, 1000);
    return t ? { id: text(x?.id, 20) || `R${i + 1}`, text: t, ...(text(x?.impact, 300) ? { impact: text(x.impact, 300) } : {}), ...(text(x?.response, 500) ? { response: text(x.response, 500) } : {}) } : null;
  }).filter(Boolean) as Risk[] : [];
  const qs = Array.isArray(a.open_questions) ? (a.open_questions as unknown[]).map((q) => (typeof q === 'string' ? q.trim().slice(0, 500) : text((q as any)?.text, 500))).filter(Boolean).slice(0, 50) : [];
  return {
    risks, open_questions: qs,
    ...(text(a.chair, 120) ? { chair: text(a.chair, 120) } : {}), ...(text(a.purpose, 500) ? { purpose: text(a.purpose, 500) } : {}),
    record_status: a.status === 'approved' || a.record_status === 'approved' ? 'approved' : 'draft',
  };
}

export function transcriptEnArg(v: unknown): Array<{ t: string; speaker: string; text: string }> | null {
  if (!Array.isArray(v) || !v.length) return null;
  const out = v.slice(0, 20_000).map((x: any) => ({ t: text(x?.t, 12), speaker: text(x?.speaker, 120) || 'Unknown speaker', text: text(x?.text, 4000) })).filter((l) => l.text);
  return out.length ? out : null;
}

export async function saveRecordFields(id: string, fields: RecordFields, transcriptEn: unknown[] | null): Promise<void> {
  const prisma = (await import('../../db/prisma')).default;
  await prisma.$executeRawUnsafe(
    `UPDATE meeting_records SET record_fields = $2::jsonb, transcript_en = COALESCE($3::jsonb, transcript_en), updated_at = now(), changed_at = now() WHERE id = $1`,
    id, JSON.stringify(fields), transcriptEn ? JSON.stringify(transcriptEn) : null,
  );
}

/** A transcript correction keeps its history: who, when, the line, before and after. */
export async function editTranscriptLine(clientNumber: string, userId: number, id: string, index: number, after: string, who: string): Promise<'ok' | 'not_found' | 'bad_line'> {
  const prisma = (await import('../../db/prisma')).default;
  const rows = await prisma.$queryRawUnsafe<Array<{ transcript: any[] }>>(`SELECT transcript FROM meeting_records WHERE client_number = $1 AND user_id = $2 AND id = $3`, clientNumber, userId, id);
  const t = rows[0]?.transcript;
  if (!Array.isArray(t)) return 'not_found';
  if (!Number.isInteger(index) || index < 0 || index >= t.length || !after.trim()) return 'bad_line';
  const edit = { at: new Date().toISOString(), who, index, before: String(t[index]?.text ?? ''), after: after.trim().slice(0, 4000) };
  t[index] = { ...t[index], text: edit.after };
  await prisma.$executeRawUnsafe(
    `UPDATE meeting_records SET transcript = $2::jsonb, transcript_edits = transcript_edits || $3::jsonb, updated_at = now(), changed_at = now() WHERE id = $1`,
    id, JSON.stringify(t), JSON.stringify([edit]),
  );
  return 'ok';
}
