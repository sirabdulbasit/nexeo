/**
 * Day contract, Phase 1 — POST /suzi/gateway/act: the one way Suzi writes to Nexeo.
 *
 *   {op, args, idempotency_key, confirmed_by_user, voice_score} → {ok, audit_id, item}
 *
 * Every call:
 *   - is IDEMPOTENT per (tenant, user, idempotency_key). The key is claimed by inserting a
 *     suzi_act_log row BEFORE the work, so two racing retries cannot both run: the second gets
 *     the first's stored answer, or 409 while it is still running. The same key with different
 *     arguments is refused rather than answered with someone else's result;
 *   - is PERMISSION-CHECKED: the op works only on the user's own items (`applyFollowUp` looks the
 *     item up by tenant AND user);
 *   - is AUDITED: the suzi_act_log row is the audit entry (its id is the `audit_id`), and a line
 *     also goes to audit_logs with the rest of the system's actions, including refusals.
 *
 * Ops: task.update (done / cancel / move / not_yet / note / reopen / assign), whatsapp.to_user, the
 * email session (suziEmail.ts; a signed send for a user on the switch is really sent, suziSend.ts), and
 * build control's gap.report / gap.approve (suziGaps.ts, link T28).
 */
import crypto from 'crypto';
import prisma from '../../db/prisma';
import { audit } from '../auditLogService';
import { applyFollowUp } from './suziActions';
import { EMAIL_OPS, runEmailOp } from './suziEmail';
import { GAP_OPS, runGapOp } from './suziGaps';

export const ACT_OPS = ['task.update', 'whatsapp.to_user', ...EMAIL_OPS, ...GAP_OPS] as const;
const STALE_RUNNING_MS = 5 * 60_000;

export interface ActRequest {
  op: string;
  args: Record<string, unknown>;
  idempotency_key: string;
  confirmed_by_user?: boolean;
  voice_score?: number | null;
  timezone?: string;
  /** From the verified login on Suzi's server (Functional Charter, row 18). */
  device_id?: string | null;
  /** T22: set only by Suzi's server, after it checked the device's signature. The device can't send it. */
  signature_verified?: boolean;
}

export type ActResponse =
  | { status: 200; body: { ok: true; audit_id: string; item: unknown; replayed?: boolean } }
  | { status: 400 | 403 | 404 | 409; body: { ok: false; audit_id?: string; error: string; detail?: string; replayed?: boolean } };

const fingerprint = (op: string, args: unknown) =>
  crypto.createHash('sha256').update(`${op}\u0000${JSON.stringify(args ?? {})}`).digest('hex');

function statusOf(error: string): 400 | 403 | 404 | 409 {
  if (error === 'not_found') return 404;
  if (error === 'needs_confirmation') return 403;
  if (error === 'rejected') return 409;
  return 400;
}

async function runOp(clientNumber: string, userId: number, req: ActRequest): Promise<{ ok: true; item: unknown } | { ok: false; error: string; detail?: string }> {
  if (req.op === 'task.update') {
    const a = req.args ?? {};
    const r = await applyFollowUp(clientNumber, userId, {
      actionId: String(a.id ?? ''),
      update: String(a.update ?? ''),
      due: typeof a.due === 'string' ? a.due : undefined,
      note: typeof a.note === 'string' ? a.note : undefined,
      personId: typeof a.person_id === 'string' ? a.person_id : undefined,
      timezone: req.timezone,
    });
    return r.ok ? { ok: true, item: r.action } : { ok: false, error: r.error, detail: r.detail };
  }
  // Founder, 5 Nov: online, Suzi sends through Nexeo. Row 19: only to the user themself, so there is no `to` to give.
  if (req.op === 'whatsapp.to_user') {
    const text = typeof req.args?.text === 'string' ? req.args.text.trim().slice(0, 2000) : '';
    if (!text) return { ok: false, error: 'bad_text' };
    const { brainContactsUser } = await import('../notifications/brainOutboundService');
    const r = await brainContactsUser({ userId, clientNumber, kind: 'suzi_to_user', summary: text.slice(0, 120), body: text, urgency: 'normal' as any, bypassRateLimit: true });
    return r.sent ? { ok: true, item: { sent: true } } : { ok: false, error: 'rejected', detail: 'WhatsApp could not deliver it' };
  }
  if (req.op.startsWith('email.')) {
    return runEmailOp(clientNumber, userId, req.op, req.args ?? {}, req.confirmed_by_user === true, {
      signatureVerified: req.signature_verified === true,
      voiceScore: typeof req.voice_score === 'number' ? req.voice_score : null,
    });
  }
  // Link T28: build control. Signed, voiced and confirmed, from his own device only (suziGaps.ts).
  if (req.op.startsWith('gap.')) {
    return runGapOp(clientNumber, userId, req.op, req.args ?? {}, {
      signatureVerified: req.signature_verified === true,
      voiceScore: typeof req.voice_score === 'number' ? req.voice_score : null,
      confirmed: req.confirmed_by_user === true,
      deviceId: req.device_id ?? null,
    });
  }
  return { ok: false, error: 'unknown_op' };
}

export async function act(clientNumber: string, userId: number, req: ActRequest): Promise<ActResponse> {
  if (!(ACT_OPS as readonly string[]).includes(req.op)) return { status: 400, body: { ok: false, error: 'unknown_op' } };
  const key = typeof req.idempotency_key === 'string' ? req.idempotency_key.trim() : '';
  if (!key || key.length > 200) return { status: 400, body: { ok: false, error: 'bad_idempotency_key' } };

  const fp = fingerprint(req.op, req.args);
  let logId: string;
  try {
    const row = await prisma.suziActLog.create({
      data: {
        clientNumber, userId, op: req.op, idempotencyKey: key, argsHash: fp, args: (req.args ?? {}) as any,
        confirmedByUser: req.confirmed_by_user === true,
        voiceScore: typeof req.voice_score === 'number' ? req.voice_score : null,
        deviceId: req.device_id ? String(req.device_id).slice(0, 60) : null,
      },
      select: { id: true },
    });
    logId = row.id;
  } catch (e: any) {
    if (e?.code !== 'P2002') throw e;
    const prior = await prisma.suziActLog.findUnique({ where: { clientNumber_userId_idempotencyKey: { clientNumber, userId, idempotencyKey: key } } });
    if (!prior) return { status: 409, body: { ok: false, error: 'in_progress' } };
    if (prior.argsHash !== fp) return { status: 409, body: { ok: false, audit_id: prior.id, error: 'idempotency_key_reused' } };
    if (prior.status === 'running') {
      const stale = Date.now() - prior.createdAt.getTime() > STALE_RUNNING_MS;
      return { status: 409, body: { ok: false, audit_id: prior.id, error: stale ? 'stale_retry_with_new_key' : 'in_progress' } };
    }
    const stored: any = prior.result ?? {};
    if (prior.status === 'ok') return { status: 200, body: { ok: true, audit_id: prior.id, item: stored.item, replayed: true } };
    return { status: statusOf(String(stored.error)), body: { ok: false, audit_id: prior.id, error: String(stored.error), ...(stored.detail ? { detail: stored.detail } : {}), replayed: true } };
  }

  let out: Awaited<ReturnType<typeof runOp>>;
  try {
    out = await runOp(clientNumber, userId, req);
  } catch (e: any) {
    out = { ok: false, error: 'rejected', detail: String(e?.message ?? 'failed').slice(0, 200) };
  }
  await prisma.suziActLog.update({
    where: { id: logId },
    data: { status: out.ok ? 'ok' : 'failed', result: out as any, finishedAt: new Date() },
  }).catch(() => {});
  await audit({
    clientNumber, actorId: userId, actorKind: 'user',
    action: `suzi.act.${req.op}`,
    subjectType: req.op.startsWith('email.') ? 'email' : req.op.startsWith('gap.') ? 'suzi_gap' : 'open_item',
    subjectId: typeof req.args?.id === 'string' ? req.args.id : typeof req.args?.draft_id === 'string' ? req.args.draft_id : typeof req.args?.thread_id === 'string' ? req.args.thread_id : null,
    result: out.ok ? 'success' : 'failure',
    details: { audit_id: logId, update: req.args?.update, confirmed_by_user: req.confirmed_by_user === true, voice_score: req.voice_score ?? null, device_id: req.device_id ?? null, signature_verified: req.signature_verified === true, ...(out.ok ? {} : { error: out.error }) },
  });
  if (out.ok) return { status: 200, body: { ok: true, audit_id: logId, item: out.item } };
  return { status: statusOf(out.error), body: { ok: false, audit_id: logId, error: out.error, ...(out.detail ? { detail: out.detail } : {}) } };
}
