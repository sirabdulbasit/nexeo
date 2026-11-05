/**
 * DEF-385 — read-only routes that Suzi's server (the gateway) calls on behalf of
 * one of its connected users.
 *
 *   GET /suzi/gateway/day-brief?user_id=2&tenant_id=TMC-0001&timezone=Asia/Karachi
 *       → DayBriefFacts (present_report-shaped blocks, facts only, no wording)
 *
 * Trust is narrow on purpose:
 *  - loopback only: the gateway runs on this box. A request that came through
 *    Apache (it carries X-Forwarded-For) or from any other address is refused;
 *  - `Authorization: Bearer <gateway admin secret>`, the same secret file
 *    Nexeo uses to call the gateway, compared in constant time;
 *  - the user must exist, be active, and belong to the named tenant;
 *  - the day brief is read-only. The operator routes (DEF-386) only DECIDE screen
 *    actions; Suzi's own guard runs on every one of them on the Mac (password fields
 *    refused, risky shortcuts spoken-approved, everything audited). No email or
 *    message is sent through here: sends wait on DEF-384.
 */
import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { verifyGatewaySecret } from '../services/suzi/gatewayAdminClient';
import { buildDayBriefFacts } from '../services/suzi/dayBriefFacts';
import { RunBusyError, startRun, stepRun, stopRun } from '../services/operator/operatorService';
import { applyFollowUp, listPendingActions } from '../services/suzi/suziActions';
import { buildDayPack } from '../services/suzi/dayPack';
import { act } from '../services/suzi/suziAct';
import { resolveUserTimezone } from '../services/userTimezoneService';
import { recordDesktopBatch, recordServerRound } from '../services/consumption/consumptionService';
import { markBriefHandover, PRESENCE_STATES, primaryDeviceOf, pumpHeld, recordPresence } from '../services/suzi/suziReach';
import { newerRulesVersion } from '../services/suzi/suziRules';
import { searchPeople } from '../services/suzi/suziPeople';
import { getAssistantName, heldItems, setAssistantName } from '../services/suzi/suziProfile';
import { searchKnowledge } from '../services/suzi/suziKnowledge';
import createLogger from '../utils/logger';

const log = createLogger('suzi-gateway');
const router = Router();

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopbackDirect(req: Pick<Request, 'headers' | 'socket'>): boolean {
  if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']) return false;
  return LOOPBACK.has(req.socket?.remoteAddress ?? '');
}

router.use(async (req: Request, res: Response, next) => {
  if (!isLoopbackDirect(req)) { res.status(403).json({ error: 'gateway routes are loopback-only' }); return; }
  const auth = String(req.headers.authorization ?? '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
  if (!(await verifyGatewaySecret(token))) { res.status(401).json({ error: 'bad gateway secret' }); return; }
  next();
});

/** The active user named by user_id + tenant_id (query or body), or null after answering 400/404. */
async function activeUser(req: Request, res: Response): Promise<{ userId: number; tenantId: string } | null> {
  const src: any = req.method === 'GET' ? req.query : (req.body ?? {});
  const userId = Number(src.user_id);
  const tenantId = String(src.tenant_id ?? '');
  if (!Number.isInteger(userId) || userId <= 0 || !tenantId) {
    res.status(400).json({ error: 'user_id and tenant_id are required' });
    return null;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { clientNumber: true, isActive: true } as any }) as any;
  if (!user || user.clientNumber !== tenantId || user.isActive === false) {
    res.status(404).json({ error: 'no such active user in that tenant' });
    return null;
  }
  return { userId, tenantId };
}

router.get('/day-brief', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  const { userId, tenantId } = who;
  try {
    // Functional Charter: the user's own zone unless the caller names one.
    const facts = await buildDayBriefFacts(tenantId, userId, { timezone: typeof req.query.timezone === 'string' ? req.query.timezone : await resolveUserTimezone(userId) });
    log.info('day brief served', { userId, clientNumber: tenantId, meetings: (facts.blocks[1] as any).items.length, calendar: facts.sources.calendar });
    res.json(facts);
  } catch (err: any) {
    log.warn('day brief failed', { userId, error: err?.message });
    res.status(500).json({ error: 'day brief could not be built' });
  }
});

/**
 * Day contract, Phase 1 (spec 2026-11-04).
 *   GET  /day-pack?user_id&tenant_id  → Suzi's working copy of the day, in the user's own zone
 *   POST /act {user_id, tenant_id, op, args, idempotency_key, confirmed_by_user, voice_score}
 *        → {ok, audit_id, item}. Idempotent per key, permission-checked, audited.
 */
router.get('/day-pack', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  try {
    const timezone = await resolveUserTimezone(who.userId);
    const pack = await buildDayPack(who.tenantId, who.userId, { timezone });
    log.info('day pack served', { userId: who.userId, clientNumber: who.tenantId, actions: pack.actions.length, emails: pack.emails.length, today: pack.calendar.today.length });
    res.json(pack);
  } catch (err: any) {
    log.warn('day pack failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ error: 'day pack could not be built' });
  }
});

router.post('/act', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  const b = req.body ?? {};
  try {
    const timezone = await resolveUserTimezone(who.userId);
    const out = await act(who.tenantId, who.userId, {
      op: String(b.op ?? ''), args: b.args && typeof b.args === 'object' ? b.args : {},
      idempotency_key: b.idempotency_key, confirmed_by_user: b.confirmed_by_user === true,
      voice_score: typeof b.voice_score === 'number' ? b.voice_score : null, timezone,
      device_id: typeof b.device_id === 'string' ? b.device_id : null,
    });
    log.info('suzi act', { userId: who.userId, op: b.op, ok: out.body.ok, auditId: out.body.audit_id });
    // Link T12, P2: decided from Nexeo's own copy either way; a stale number only tells Suzi to refetch.
    const newer = await newerRulesVersion(who.tenantId, who.userId, b.rules_version);
    res.status(out.status).json(newer === undefined ? out.body : { ...out.body, rules_version: newer });
  } catch (err: any) {
    log.warn('suzi act failed', { userId: who.userId, op: b.op, error: err?.message });
    res.status(500).json({ ok: false, error: 'act_failed' });
  }
});

/** Functional Charter, contract "Knowledge": wiki excerpts as facts. Suzi's model writes the words. */
router.get('/knowledge', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) { res.status(400).json({ error: 'q is required' }); return; }
  try {
    const results = await searchKnowledge(who.tenantId, who.userId, q);
    log.info('knowledge served', { userId: who.userId, clientNumber: who.tenantId, results: results.length });
    res.json(results);
  } catch (err: any) {
    log.warn('knowledge failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ error: 'knowledge could not be searched' });
  }
});

/** Link T14: the assistant's one name. Nexeo's profile is the record. */
router.get('/profile', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  try {
    res.json({ assistant_name: await getAssistantName(who.tenantId, who.userId) });
  } catch (err: any) {
    log.warn('profile failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ error: 'profile could not be read' });
  }
});

router.post('/profile', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  try {
    const ok = await setAssistantName(who.tenantId, who.userId, req.body?.assistant_name);
    if (!ok) { res.status(400).json({ ok: false, error: 'bad_name' }); return; }
    res.json({ ok: true, assistant_name: await getAssistantName(who.tenantId, who.userId) });
  } catch (err: any) {
    log.warn('profile update failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ ok: false, error: 'profile_failed' });
  }
});

/** Link T11, N4: what nudges-off keeps back, for "anything urgent?". */
router.get('/held', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  try {
    res.json(await heldItems(who.tenantId, who.userId));
  } catch (err: any) {
    log.warn('held failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ error: 'held items could not be read' });
  }
});

/** Link T12, P3: the user's own people, by name. Results are never logged, only their number. */
router.get('/people', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) { res.status(400).json({ error: 'q is required' }); return; }
  try {
    const results = await searchPeople(who.tenantId, who.userId, q);
    log.info('people served', { userId: who.userId, clientNumber: who.tenantId, results: results.length });
    res.json(results);
  } catch (err: any) {
    log.warn('people failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ error: 'people could not be searched' });
  }
});

/** Functional Charter: `pack.tz` is the only source of a user's zone; Suzi's server asks here for its clock. */
router.get('/user-time', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  res.json({ tz: await resolveUserTimezone(who.userId) });
});

/** Functional Charter row 15: which device is in charge. Suzi's server puts the answer in `welcome`. */
router.get('/primary-device', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  res.json({ device_id: await primaryDeviceOf(who.tenantId, who.userId) });
});

/**
 * Costing Charter — the consumption record.
 *   POST /usage/round {user_id, tenant_id, turn_id, round, model, prompt, cached, output, thoughts, device_id}
 *   POST /usage/desktop {user_id, tenant_id, day, os, app_version, idempotency_key, items, device_id}
 * Counts only, never content. Safe to resend.
 */
/**
 * Functional Charter: the device's presence frame, forwarded by Suzi's server. Coming back releases
 * what was held; the answer does not wait for that.
 */
router.post('/presence', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  const { state, device_id: deviceId, nudges, meeting } = req.body ?? {};
  if (!PRESENCE_STATES.includes(state) || typeof deviceId !== 'string' || !deviceId) { res.status(400).json({ ok: false, error: 'bad_presence' }); return; }
  try {
    const { returned } = await recordPresence(who.tenantId, who.userId, deviceId.slice(0, 60), state, new Date(), nudges === false, meeting === true);
    if (returned) void pumpHeld(who.tenantId, who.userId);
    res.json({ ok: true });
  } catch (err: any) {
    log.warn('presence failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ ok: false, error: 'presence_failed' });
  }
});

/** The day brief reached the board. Nexeo's own morning brief stops, if this device sends presence. */
router.post('/brief-delivered', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  const deviceId = req.body?.device_id;
  if (typeof deviceId !== 'string' || !deviceId) { res.status(400).json({ ok: false, error: 'bad_device' }); return; }
  try {
    await markBriefHandover(who.tenantId, who.userId, deviceId.slice(0, 60));
    res.json({ ok: true });
  } catch (err: any) {
    log.warn('brief handover failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ ok: false, error: 'handover_failed' });
  }
});

router.post('/usage/round', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  try {
    await recordServerRound(who.tenantId, who.userId, req.body ?? {}, { timezone: await resolveUserTimezone(who.userId) });
    res.json({ ok: true });
  } catch (err: any) {
    log.warn('usage round failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ ok: false, error: 'usage_failed' });
  }
});

router.post('/usage/desktop', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  try {
    const out = await recordDesktopBatch(who.tenantId, who.userId, req.body ?? {}, { timezone: await resolveUserTimezone(who.userId) });
    res.status(out.status).json(out.body);
  } catch (err: any) {
    log.warn('usage batch failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ ok: false, error: 'usage_failed' });
  }
});

/**
 * DEF-385 (CL-063) — the Action Center for Suzi.
 *   GET  /actions?user_id&tenant_id&limit?&timezone?  → {total, overdue, actions:[{id,title,priority,status,due,overdue}]}
 *   POST /actions/update {user_id, tenant_id, action_id, update: done|cancel|move|not_yet, due?: YYYY-MM-DD, note?}
 *        → {ok:true, update, action} | 400 bad_update/bad_date | 404 not_found | 409 rejected
 */
router.get('/actions', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  try {
    res.json(await listPendingActions(who.tenantId, who.userId, {
      limit: Number(req.query.limit) || undefined,
      timezone: typeof req.query.timezone === 'string' ? req.query.timezone : undefined,
    }));
  } catch (err: any) {
    log.warn('suzi actions list failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ error: 'actions could not be read' });
  }
});

router.post('/actions/update', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  const b = req.body ?? {};
  try {
    const out = await applyFollowUp(who.tenantId, who.userId, { actionId: String(b.action_id ?? ''), update: String(b.update ?? ''), due: typeof b.due === 'string' ? b.due : undefined, note: typeof b.note === 'string' ? b.note : undefined, timezone: typeof b.timezone === 'string' ? b.timezone : undefined });
    if (out.ok) { log.info('suzi follow-up applied', { userId: who.userId, actionId: out.action.id, update: out.update }); res.json(out); return; }
    res.status(out.error === 'not_found' ? 404 : out.error === 'rejected' ? 409 : 400).json(out);
  } catch (err: any) {
    log.warn('suzi follow-up failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ error: 'follow-up could not be applied' });
  }
});

/**
 * DEF-386 — the screen operator. The gateway relays; Nexeo decides.
 *
 *   POST /operator/start {user_id, tenant_id, goal, os?}
 *        → {status:'act', run_id, actions} | {status:'local', reason:'private_mode'} | {status:'refused', reason}
 *   POST /operator/step  {user_id, tenant_id, run_id, results:[{call_id, ok, output?, image_b64?, meta?, error?}]}
 *        → {status:'act', actions, step, progress?} | {status: done|unverified|needs_user|failed|step_limit|stopped, summary, …}
 *   POST /operator/stop  {user_id, tenant_id, run_id} → {status:'stopped', …}
 *
 * Each action is either {call_id, tool, args} (run that Suzi tool, report its result
 * under call_id) or {call_id, wait_ms} (pause, then report ok). Stop at the first failed
 * action; anything not run is reported missing and the model hears it was not executed.
 */
router.post('/operator/start', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  try {
    res.json(await startRun({ clientNumber: who.tenantId, userId: who.userId, goal: String(req.body?.goal ?? ''), os: typeof req.body?.os === 'string' ? req.body.os : undefined }));
  } catch (err: any) {
    log.warn('operator start failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ error: 'operator could not start' });
  }
});

router.post('/operator/step', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  const results = Array.isArray(req.body?.results) ? req.body.results : [];
  try {
    const out = await stepRun({ runId: String(req.body?.run_id ?? ''), clientNumber: who.tenantId, userId: who.userId, results });
    if (!out) { res.status(404).json({ error: 'no such run' }); return; }
    res.json(out);
  } catch (err: any) {
    if (err instanceof RunBusyError) { res.status(409).json({ error: err.message }); return; }
    log.warn('operator step failed', { userId: who.userId, error: err?.message });
    res.status(500).json({ error: 'operator step failed' });
  }
});

router.post('/operator/stop', async (req: Request, res: Response) => {
  const who = await activeUser(req, res);
  if (!who) return;
  const out = await stopRun({ runId: String(req.body?.run_id ?? ''), clientNumber: who.tenantId, userId: who.userId });
  if (!out) { res.status(404).json({ error: 'no such run' }); return; }
  res.json(out);
});

export default router;
