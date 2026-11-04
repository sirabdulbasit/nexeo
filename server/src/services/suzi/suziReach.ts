/**
 * Functional Charter, "Reminders and presence": how Nexeo reaches a user who has Suzi.
 *
 *   - Alive: a presence frame in the last 3 minutes with state active, or away for under 30 minutes.
 *   - While alive, Nexeo uses no other channel. A critical item Suzi may speak starts a turn at once;
 *     everything else arrives as a silent card.
 *   - Not alive: the item is held and delivered on return. After 10 minutes outside quiet hours a
 *     critical item also goes by email.
 *   - Quiet hours (the user's, default 22:00-08:00): a critical item shows as a silent card and is
 *     spoken when quiet hours end. Only an emergency is spoken at night, as it reached him before.
 *
 * A user with no presence row has not adopted any of this: Nexeo contacts them exactly as before. So
 * does any failure reading presence, because a lost reminder is worse than a duplicate one.
 *
 * One delivery engine: every item goes in the outbox and `pumpHeld` moves it, whether called for a new
 * item, a user coming back, or the sweep. Each step claims its row first, so two pumps cannot both
 * deliver the same item.
 */
import prisma from '../../db/prisma';
import createLogger from '../../utils/logger';

const log = createLogger('suzi-reach');

export const PRESENCE_STATES = ['active', 'away', 'locked', 'asleep', 'paused'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

const ALIVE_FRAME_MS = 3 * 60_000;
const AWAY_MAX_MS = 30 * 60_000;
const ABSENT_FOR_EMAIL_MS = 10 * 60_000;
const HOLD_MAX_MS = 72 * 3_600_000;
const MAX_SPOKEN_PER_PUMP = 3; // Suzi's server waits at most 5 per session
const MAX_ROWS_PER_PUMP = 25;

export interface PresenceRow { state: string; state_since: Date | string; last_frame_at: Date | string; last_alive_at?: Date | string | null }

export function isAlive(p: PresenceRow, now: Date): boolean {
  const frameAge = now.getTime() - new Date(p.last_frame_at).getTime();
  if (frameAge > ALIVE_FRAME_MS) return false;
  if (p.state === 'active') return true;
  return p.state === 'away' && now.getTime() - new Date(p.state_since).getTime() < AWAY_MAX_MS;
}

export interface Reach { adopted: boolean; alive: boolean; absentMs: number }
const NOT_ADOPTED: Reach = { adopted: false, alive: false, absentMs: 0 };

/** Any device for now. Once `primary` exists (next in the charter's list), only that device counts. */
export async function reachFor(clientNumber: string, userId: number, now = new Date()): Promise<Reach> {
  try {
    const rows = await prisma.$queryRawUnsafe<PresenceRow[]>(
      `SELECT state, state_since, last_frame_at, last_alive_at FROM suzi_presence WHERE client_number = $1 AND user_id = $2`,
      clientNumber, userId,
    );
    if (!rows?.length) return NOT_ADOPTED;
    if (rows.some((r) => isAlive(r, now))) return { adopted: true, alive: true, absentMs: 0 };
    const last = Math.max(...rows.map((r) => new Date(r.last_alive_at ?? r.last_frame_at).getTime()));
    return { adopted: true, alive: false, absentMs: now.getTime() - last };
  } catch (e: any) {
    log.warn('presence unreadable, contacting as before', { userId, error: e?.message });
    return NOT_ADOPTED;
  }
}

/** Saves a frame. `returned` = the user was not alive and now is, so what was held can go. */
export async function recordPresence(clientNumber: string, userId: number, deviceId: string, state: PresenceState, now = new Date()): Promise<{ returned: boolean }> {
  const before = await reachFor(clientNumber, userId, now);
  const prior = await prisma.$queryRawUnsafe<Array<{ state: string; state_since: Date }>>(
    `SELECT state, state_since FROM suzi_presence WHERE client_number = $1 AND user_id = $2 AND device_id = $3`,
    clientNumber, userId, deviceId,
  );
  const since = prior[0]?.state === state ? new Date(prior[0].state_since) : now;
  const alive = isAlive({ state, state_since: since, last_frame_at: now }, now);
  await prisma.$executeRawUnsafe(
    `INSERT INTO suzi_presence (client_number, user_id, device_id, state, state_since, last_frame_at, last_alive_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (client_number, user_id, device_id) DO UPDATE
       SET state = EXCLUDED.state, state_since = EXCLUDED.state_since, last_frame_at = EXCLUDED.last_frame_at,
           last_alive_at = COALESCE(EXCLUDED.last_alive_at, suzi_presence.last_alive_at)`,
    clientNumber, userId, deviceId, state, since, now, alive ? now : null,
  );
  return { returned: alive && !before.alive };
}

export type Step = 'speak' | 'card' | 'hold';

/**
 * What to do with one item right now. `carded`: the silent card has already shown.
 * Stays held after a card only when it is still owed a spoken turn.
 */
export function decide(i: { critical: boolean; emergency: boolean; speakable: boolean; carded: boolean; alive: boolean; quiet: boolean; absentMs: number; emailed: boolean }): { step: Step; email: boolean } {
  if (!i.alive) return { step: 'hold', email: i.critical && !i.quiet && !i.emailed && i.absentMs >= ABSENT_FOR_EMAIL_MS };
  if (i.critical && i.speakable && (!i.quiet || i.emergency)) return { step: 'speak', email: false };
  if (i.carded) return { step: 'hold', email: false };
  return { step: 'card', email: false };
}

interface OutboxRow { id: string; kind: string; summary: string; body: string | null; urgency: string; provenance: string | null; metadata: any; carded_at: Date | null; emailed_at: Date | null }

export async function holdItem(item: { clientNumber: string; userId: number; kind: string; summary: string; body: string; urgency: string; provenance?: string; metadata?: Record<string, unknown> }): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO suzi_outbox (client_number, user_id, kind, summary, body, urgency, provenance, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING id::text`,
    item.clientNumber, item.userId, item.kind, item.summary.slice(0, 500), item.body, item.urgency, item.provenance ?? null, JSON.stringify(item.metadata ?? {}),
  );
  return rows[0].id;
}

const finished = (id: string, how: string) => prisma.$executeRawUnsafe(
  `UPDATE suzi_outbox SET state = 'delivered', delivered_how = $2, delivered_at = now(), body = NULL WHERE id = $1::bigint AND state = 'held'`,
  id, how,
);

/** Moves what can move now, for one user. Never throws: a failed step leaves the item held. */
export async function pumpHeld(clientNumber: string, userId: number, now = new Date()): Promise<{ spoken: number; carded: number; emailed: number; expired: number }> {
  const out = { spoken: 0, carded: 0, emailed: 0, expired: 0 };
  try {
    out.expired = Number(await prisma.$executeRawUnsafe(
      `UPDATE suzi_outbox SET state = 'expired', body = NULL
        WHERE client_number = $1 AND user_id = $2 AND state = 'held' AND created_at < $3`,
      clientNumber, userId, new Date(now.getTime() - HOLD_MAX_MS),
    )) || 0;
    const rows = await prisma.$queryRawUnsafe<OutboxRow[]>(
      `SELECT id::text, kind, summary, body, urgency, provenance, metadata, carded_at, emailed_at FROM suzi_outbox
        WHERE client_number = $1 AND user_id = $2 AND state = 'held' ORDER BY created_at LIMIT ${MAX_ROWS_PER_PUMP}`,
      clientNumber, userId,
    );
    if (!rows?.length) return out;

    const user = await prisma.user.findFirst({ where: { id: userId, clientNumber }, select: { notificationPreferences: true } });
    const bc = (user?.notificationPreferences as any)?.brain_channel ?? {};
    const [{ isWithinQuietHours, emailHeldItem, recordSuziDelivery }, { tellSuzi, noticeSuzi, suziReasonFor }, { scrubSyntheticIdentities }] = await Promise.all([
      import('../notifications/brainOutboundService'), import('./gatewayAdminClient'), import('../whatsapp/displayIdentity'),
    ]);
    const quiet = await isWithinQuietHours({ ...bc, quietStart: bc.quietStart || '22:00', quietEnd: bc.quietEnd || '08:00' }, userId);
    const reach = await reachFor(clientNumber, userId, now);
    const owner = { userId, clientNumber };

    for (const r of rows) {
      const body = r.body ?? '';
      const critical = r.urgency === 'high' || r.urgency === 'emergency';
      const speakable = !!suziReasonFor(r.kind, r.metadata) && r.provenance !== 'quoted_third_party';
      const d = decide({ critical, emergency: r.urgency === 'emergency', speakable, carded: !!r.carded_at, alive: reach.alive, quiet, absentMs: reach.absentMs, emailed: !!r.emailed_at });

      if (d.step === 'speak' && out.spoken < MAX_SPOKEN_PER_PUMP) {
        const told = await tellSuzi(owner, { kind: r.kind, body: await scrubSyntheticIdentities(body, clientNumber), urgency: r.urgency, provenance: r.provenance ?? undefined, metadata: r.metadata });
        if (told.delivered > 0) {
          await finished(r.id, 'assistant_start');
          out.spoken++;
          if (!r.carded_at) await recordSuziDelivery({ userId, clientNumber, kind: r.kind, summary: r.summary, body, urgency: r.urgency, how: 'assistant_start' });
        }
      } else if (d.step === 'card') {
        const shown = await noticeSuzi(owner, { kind: r.kind, text: await scrubSyntheticIdentities(body, clientNumber), urgency: r.urgency });
        if (shown.delivered > 0) {
          out.carded++;
          await recordSuziDelivery({ userId, clientNumber, kind: r.kind, summary: r.summary, body, urgency: r.urgency, how: 'notice' });
          // Still owed its spoken turn when quiet hours end; otherwise the card is the delivery.
          if (critical && speakable) await prisma.$executeRawUnsafe(`UPDATE suzi_outbox SET carded_at = now() WHERE id = $1::bigint`, r.id);
          else await finished(r.id, 'notice');
        }
      }
      if (d.email) {
        const claimed = await prisma.$executeRawUnsafe(`UPDATE suzi_outbox SET emailed_at = now() WHERE id = $1::bigint AND state = 'held' AND emailed_at IS NULL`, r.id);
        if (Number(claimed) > 0) {
          const ok = await emailHeldItem({ userId, clientNumber, kind: r.kind, summary: r.summary, body, urgency: r.urgency, metadata: r.metadata });
          if (ok) out.emailed++;
          else await prisma.$executeRawUnsafe(`UPDATE suzi_outbox SET emailed_at = NULL WHERE id = $1::bigint`, r.id);
        }
      }
    }
  } catch (e: any) {
    log.warn('pump failed, items stay held', { userId, error: e?.message });
  }
  return out;
}

/** Every 5 minutes: the things no event triggers (10 minutes gone, quiet hours ending, expiry). */
export async function sweepHeld(now = new Date()): Promise<{ users: number }> {
  const users = await prisma.$queryRawUnsafe<Array<{ client_number: string; user_id: number }>>(
    `SELECT DISTINCT client_number, user_id FROM suzi_outbox WHERE state = 'held'`,
  );
  for (const u of users) await pumpHeld(u.client_number, u.user_id, now);
  return { users: users.length };
}

/** A brief reached the board on a device that sends presence. Nexeo's own morning brief stops. */
export async function markBriefHandover(clientNumber: string, userId: number, deviceId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE suzi_presence SET brief_handover_at = COALESCE(brief_handover_at, now())
      WHERE client_number = $1 AND user_id = $2 AND device_id = $3`,
    clientNumber, userId, deviceId,
  );
}

export async function briefHandedOver(clientNumber: string, userId: number): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM suzi_presence WHERE client_number = $1 AND user_id = $2 AND brief_handover_at IS NOT NULL LIMIT 1`,
      clientNumber, userId,
    );
    return rows.length > 0;
  } catch {
    return false; // he keeps his brief if this cannot be read
  }
}
