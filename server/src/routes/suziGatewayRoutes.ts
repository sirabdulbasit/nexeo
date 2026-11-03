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
 *  - read-only. Nothing here sends, writes or changes anything. Sends wait on
 *    DEF-384 (approval proof on risky calls).
 */
import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { verifyGatewaySecret } from '../services/suzi/gatewayAdminClient';
import { buildDayBriefFacts } from '../services/suzi/dayBriefFacts';
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

router.get('/day-brief', async (req: Request, res: Response) => {
  const userId = Number(req.query.user_id);
  const tenantId = String(req.query.tenant_id ?? '');
  if (!Number.isInteger(userId) || userId <= 0 || !tenantId) {
    res.status(400).json({ error: 'user_id and tenant_id are required' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { clientNumber: true, isActive: true } as any }) as any;
  if (!user || user.clientNumber !== tenantId || user.isActive === false) {
    res.status(404).json({ error: 'no such active user in that tenant' });
    return;
  }
  try {
    const facts = await buildDayBriefFacts(tenantId, userId, { timezone: typeof req.query.timezone === 'string' ? req.query.timezone : undefined });
    log.info('day brief served', { userId, clientNumber: tenantId, meetings: (facts.blocks[1] as any).items.length, calendar: facts.sources.calendar });
    res.json(facts);
  } catch (err: any) {
    log.warn('day brief failed', { userId, error: err?.message });
    res.status(500).json({ error: 'day brief could not be built' });
  }
});

export default router;
