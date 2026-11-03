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
    const facts = await buildDayBriefFacts(tenantId, userId, { timezone: typeof req.query.timezone === 'string' ? req.query.timezone : undefined });
    log.info('day brief served', { userId, clientNumber: tenantId, meetings: (facts.blocks[1] as any).items.length, calendar: facts.sources.calendar });
    res.json(facts);
  } catch (err: any) {
    log.warn('day brief failed', { userId, error: err?.message });
    res.status(500).json({ error: 'day brief could not be built' });
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
