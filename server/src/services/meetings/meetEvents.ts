/**
 * F-4 Way A arrival by Workspace Events (Functional Charter, agreed 12 Nov 2026).
 *
 * Google publishes `google.workspace.meet.transcript.v2.fileGenerated` to Pub/Sub topic
 * projects/nexeo-tmc/topics/meet-transcripts; the push subscription meet-transcripts-nexeo POSTs it to
 * /api/v1/meet/events with an OIDC token from nexeo-meet-push. Only that token is accepted (401 otherwise). Each
 * delivery is acknowledged at once and processed afterwards, once per CloudEvent id. The subscription that makes
 * Google publish is one per enabled user, created with his own token and renewed before it expires.
 */
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import prisma from '../../db/prisma';
import createLogger from '../../utils/logger';

const log = createLogger('meet-events');
export const PUSH_AUDIENCE = 'https://tai.tmcltd.com/api/v1/meet/events';
export const PUSH_SERVICE_ACCOUNT = 'nexeo-meet-push@nexeo-tmc.iam.gserviceaccount.com';
export const TRANSCRIPT_EVENT = 'google.workspace.meet.transcript.v2.fileGenerated';
export const MEET_TOPIC = 'projects/nexeo-tmc/topics/meet-transcripts';
const RENEW_BEFORE_MS = 24 * 60 * 60_000;

const verifier = new OAuth2Client();

/** The push carries Google's OIDC token for our service account and our URL, or it is refused. */
export async function verifyPushToken(authorization: string | undefined, deps: { verify?: (token: string) => Promise<any> } = {}): Promise<boolean> {
  const m = String(authorization ?? '').match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  try {
    const payload = deps.verify
      ? await deps.verify(m[1])
      : (await verifier.verifyIdToken({ idToken: m[1], audience: PUSH_AUDIENCE })).getPayload();
    return !!payload
      && ['accounts.google.com', 'https://accounts.google.com'].includes(String(payload.iss))
      && payload.aud === PUSH_AUDIENCE
      && payload.email === PUSH_SERVICE_ACCOUNT
      && payload.email_verified === true;
  } catch {
    return false;
  }
}

export interface PushedEvent { id: string; type: string; source: string; data: any }

/** The Pub/Sub push body → the CloudEvent it carries. Null when it is not one. */
export function parsePush(body: any): PushedEvent | null {
  const msg = body?.message;
  const a = msg?.attributes ?? {};
  const id = String(a['ce-id'] ?? msg?.messageId ?? '');
  if (!id) return null;
  let data: any = {};
  try { data = msg?.data ? JSON.parse(Buffer.from(String(msg.data), 'base64').toString('utf8')) : {}; } catch { data = {}; }
  return { id, type: String(a['ce-type'] ?? ''), source: String(a['ce-source'] ?? ''), data };
}

/** First sight of this event id? A redelivery returns false and is only acknowledged. */
export async function claimEvent(id: string): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe(
    `INSERT INTO meet_event_receipts (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING`, id.slice(0, 200),
  );
  return Number(n) > 0;
}

async function markEvent(id: string, status: string, detail?: string): Promise<void> {
  await prisma.$executeRawUnsafe(`UPDATE meet_event_receipts SET status = $2, detail = $3 WHERE event_id = $1`, id.slice(0, 200), status, detail?.slice(0, 300) ?? null).catch(() => undefined);
}

/** Process one delivery: a transcript for one of our users' subscriptions, or a lifecycle note (renew). */
export async function handleEvent(ev: PushedEvent): Promise<string> {
  const subName = ev.source.replace(/^\/\/workspaceevents\.googleapis\.com\//, '');
  const subs = await prisma.$queryRawUnsafe<Array<{ client_number: string; user_id: number }>>(
    `SELECT client_number, user_id FROM meet_event_subscriptions WHERE name = $1`, subName,
  );
  const owner = subs[0];
  if (!owner) { await markEvent(ev.id, 'unknown_subscription', subName); return 'unknown_subscription'; }
  if (ev.type.startsWith('google.workspace.events.subscription.')) {
    await ensureSubscription(owner.client_number, owner.user_id, { force: true }).catch(() => undefined);
    await markEvent(ev.id, 'lifecycle', ev.type);
    return 'lifecycle';
  }
  if (ev.type !== TRANSCRIPT_EVENT) { await markEvent(ev.id, 'ignored', ev.type); return 'ignored'; }
  const { meetingAssistantOn, processConferenceForUser } = await import('./meetingProcessor');
  if (!(await meetingAssistantOn(owner.client_number, owner.user_id))) { await markEvent(ev.id, 'switch_off'); return 'switch_off'; }
  const transcriptName = String(ev.data?.transcript?.name ?? '');
  const conf = transcriptName.match(/^(conferenceRecords\/[^/]+)/)?.[1];
  if (!conf) { await markEvent(ev.id, 'no_conference', transcriptName); return 'no_conference'; }
  const result = await processConferenceForUser(owner.client_number, owner.user_id, conf);
  await markEvent(ev.id, 'processed', result);
  return result;
}

/**
 * His one subscription to his own Meet transcripts, created with his token (he must have reconnected Google with
 * the Meet scopes). Renewed when it has less than a day left. Returns what happened, never throws.
 */
export async function ensureSubscription(clientNumber: string, userId: number, opts: { force?: boolean } = {}): Promise<string> {
  try {
    const have = await prisma.$queryRawUnsafe<Array<{ name: string; expire_at: Date | null }>>(
      `SELECT name, expire_at FROM meet_event_subscriptions WHERE client_number = $1 AND user_id = $2 ORDER BY updated_at DESC LIMIT 1`, clientNumber, userId,
    );
    const current = have[0];
    if (current && !opts.force && current.expire_at && current.expire_at.getTime() - Date.now() > RENEW_BEFORE_MS) return 'fresh';
    const { getAuthenticatedClient } = await import('../integrationService');
    const { client } = await getAuthenticatedClient(userId);
    if (!client) return 'no_google_client';
    const we = google.workspaceevents({ version: 'v1', auth: client });
    if (current) {
      const r = await we.subscriptions.patch({ name: current.name, updateMask: 'ttl', requestBody: { ttl: '0s' } }).catch((e: any) => ({ error: e }));
      if (!(r as any).error) {
        const sub = await we.subscriptions.get({ name: current.name });
        await saveSub(clientNumber, userId, current.name, sub.data.expireTime);
        return 'renewed';
      }
    }
    const me = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    const op = await we.subscriptions.create({
      requestBody: {
        targetResource: `//cloudidentity.googleapis.com/users/${me.data.id}`,
        eventTypes: [TRANSCRIPT_EVENT],
        notificationEndpoint: { pubsubTopic: MEET_TOPIC },
        payloadOptions: { includeResource: false },
      },
    }).catch((e: any) => ({ error: e }));
    if ((op as any).error) {
      const msg = String((op as any).error?.message ?? '');
      if (/already exists|ALREADY_EXISTS/i.test(msg)) return adoptExisting(we, clientNumber, userId);
      log.warn('meet subscription not created', { userId, error: msg.slice(0, 200) });
      return /insufficient|scope|permission/i.test(msg) ? 'needs_reconnect' : 'failed';
    }
    const sub = (op as any).data?.response;
    if (sub?.name) { await saveSub(clientNumber, userId, sub.name, sub.expireTime); return 'created'; }
    return adoptExisting(we, clientNumber, userId);
  } catch (e: any) {
    log.warn('meet subscription check failed', { userId, error: e?.message?.slice(0, 200) });
    return 'failed';
  }
}

async function adoptExisting(we: any, clientNumber: string, userId: number): Promise<string> {
  const l = await we.subscriptions.list({ filter: `event_types:"${TRANSCRIPT_EVENT}"` }).catch(() => null);
  const sub = (l?.data?.subscriptions ?? [])[0];
  if (!sub?.name) return 'pending';
  await saveSub(clientNumber, userId, sub.name, sub.expireTime);
  return 'adopted';
}

async function saveSub(clientNumber: string, userId: number, name: string, expireTime?: string | null): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO meet_event_subscriptions (name, client_number, user_id, expire_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (name) DO UPDATE SET expire_at = EXCLUDED.expire_at, updated_at = now()`,
    name, clientNumber, userId, expireTime ? new Date(expireTime) : null,
  );
}
