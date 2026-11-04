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
 * Phase 1 ops: task.update (done / cancel / move / not_yet / note).
 */
import crypto from 'crypto';
import prisma from '../../db/prisma';
import { audit } from '../auditLogService';
import { applyFollowUp } from './suziActions';

export const ACT_OPS = ['task.update'] as const;
const STALE_RUNNING_MS = 5 * 60_000;

export interface ActRequest {
  op: string;
  args: Record<string, unknown>;
  idempotency_key: string;
  confirmed_by_user?: boolean;
  voice_score?: number | null;
  timezone?: string;
}

export type ActResponse =
  | { status: 200; body: { ok: true; audit_id: string; item: unknown; replayed?: boolean } }
  | { status: 400 | 403 | 404 | 409; body: { ok: false; audit_id?: string; error: string; detail?: string; replayed?: boolean } };

const fingerprint = (op: string, args: unknown) =>
  crypto.createHash('sha256').update(`${op}\u0000${JSON.stringify(args ?? {})}`).digest('hex');

function statusOf(error: string): 400 | 403 | 404 | 409 {
  if (error === 'not_found') return 404;
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
      timezone: req.timezone,
    });
    return r.ok ? { ok: true, item: r.action } : { ok: false, error: r.error, detail: r.detail };
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
    subjectType: 'open_item', subjectId: typeof req.args?.id === 'string' ? req.args.id : null,
    result: out.ok ? 'success' : 'failure',
    details: { audit_id: logId, update: req.args?.update, confirmed_by_user: req.confirmed_by_user === true, voice_score: req.voice_score ?? null, ...(out.ok ? {} : { error: out.error }) },
  });
  if (out.ok) return { status: 200, body: { ok: true, audit_id: logId, item: out.item } };
  return { status: statusOf(out.error), body: { ok: false, audit_id: logId, error: out.error, ...(out.detail ? { detail: out.detail } : {}) } };
}
