/**
 * POST /api/v1/meet/events — Google Workspace Events (Meet transcripts) through Pub/Sub push. F-4 Way A.
 * Google's OIDC token for nexeo-meet-push is the only credential accepted. Acknowledged at once (204), processed
 * afterwards, once per event id; a redelivery is acknowledged and not processed again.
 */
import { Router, Request, Response } from 'express';
import createLogger from '../utils/logger';
import { verifyPushToken, parsePush, claimEvent, handleEvent } from '../services/meetings/meetEvents';

const log = createLogger('meet-events');
const router = Router();

router.post('/meet/events', async (req: Request, res: Response) => {
  if (!(await verifyPushToken(req.headers.authorization))) return res.status(401).json({ error: 'unauthorized' });
  const ev = parsePush(req.body);
  if (!ev) return res.status(204).end(); // not a CloudEvent: acknowledged, nothing to do
  let first = false;
  try { first = await claimEvent(ev.id); } catch (e: any) {
    log.warn('meet event not recorded', { error: e?.message?.slice(0, 120) });
    return res.status(500).end(); // Pub/Sub retries
  }
  res.status(204).end();
  if (!first) return;
  void handleEvent(ev).then((r) => log.info('meet event handled', { id: ev.id, type: ev.type, result: r }))
    .catch((e: any) => log.warn('meet event failed', { id: ev.id, error: e?.message?.slice(0, 200) }));
});

export default router;
