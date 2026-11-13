/**
 * F-4 Way A polling fallback (Functional Charter, agreed 12 Nov 2026). Every 5 minutes, for each user whose Meeting
 * Assistant switch is on:
 *   - calendar events with a Meet link that ended 15 minutes to 24 hours ago and have no finished record are
 *     processed: hosted → Google's transcript is read; not hosted → `not_covered`, no attempt;
 *   - a record due for its one later re-read is read again (Google's entries can be incomplete at first);
 *   - records older than 12 months keep only their minutes and action items (F-4.10).
 * Workspace Events (meetEvents.ts) only make records arrive sooner; this sweep alone is enough.
 */
import prisma from '../db/prisma';
import createLogger from '../utils/logger';

const log = createLogger('meet-poll');
const INTERVAL_MS = 5 * 60_000;
const FIRST_TICK_MS = 3 * 60_000;
const ENDED_AFTER_MS = 15 * 60_000;
const LOOKBACK_MS = 24 * 60 * 60_000;

/** Users whose own Meeting Assistant switch is on (F-4.2, per user). */
export async function enabledUsers(): Promise<Array<{ clientNumber: string; userId: number; emails: string[] }>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: number; client_number: string; email: string | null; integration_email: string | null }>>(
    `SELECT id, client_number, email, integration_email FROM users
      WHERE notification_preferences->'meeting_assistant'->>'enabled' = 'true'`,
  ).catch(() => [] as Array<{ id: number; client_number: string; email: string | null; integration_email: string | null }>);
  return rows.map((u) => ({ clientNumber: u.client_number, userId: u.id, emails: [u.email, u.integration_email].filter(Boolean).map((e) => String(e).toLowerCase()) }));
}

/** His conferences that ended 15 minutes to 24 hours ago and have no finished record yet. */
export async function pollConferences(u: { clientNumber: string; userId: number }, now: Date): Promise<number> {
  const { meetFor, recentConferences } = await import('../services/meetings/meetTranscripts');
  const { processConferenceForUser } = await import('../services/meetings/meetingProcessor');
  const meet = await meetFor(u.userId);
  if (!meet) return 0;
  let confs: Awaited<ReturnType<typeof recentConferences>> = [];
  try { confs = await recentConferences(meet, new Date(now.getTime() - LOOKBACK_MS)); } catch (e: any) {
    log.warn('conference list failed', { userId: u.userId, error: e?.message?.slice(0, 160) });
    return 0;
  }
  const done = await prisma.$queryRawUnsafe<Array<{ conference_record: string }>>(
    `SELECT conference_record FROM meeting_records WHERE client_number = $1 AND user_id = $2 AND conference_record IS NOT NULL
        AND status IN ('record_ready','not_covered')`, u.clientNumber, u.userId,
  );
  const finished = new Set(done.map((d) => d.conference_record));
  let n = 0;
  for (const c of confs) {
    const end = c.endTime ? Date.parse(c.endTime) : NaN;
    if (!Number.isFinite(end) || finished.has(c.name) || now.getTime() - end < ENDED_AFTER_MS) continue;
    const r = await processConferenceForUser(u.clientNumber, u.userId, c.name).catch((e: any) => `error:${String(e?.message ?? e).slice(0, 80)}`);
    n += 1;
    log.info('conference processed', { userId: u.userId, conference: c.name, result: r });
  }
  return n;
}

export async function runMeetPoll(now = new Date()): Promise<{ users: number; processed: number; rereads: number; trimmed: number }> {
  const { processEndedEvent, ingestConference } = await import('../services/meetings/meetingProcessor');
  const { meetFor, meetingCodeOf } = await import('../services/meetings/meetTranscripts');
  const { trimOldTranscripts, scheduleReread } = await import('../services/meetings/meetingRecordStore');
  const { getEvents } = await import('../services/calendarService');
  const users = await enabledUsers();
  let processed = 0; let rereads = 0;
  const { ensureSubscription } = await import('../services/meetings/meetEvents');
  for (const u of users) {
    try {
      // His Workspace Events subscription: created once he has the Meet scopes, renewed a day before it expires.
      await ensureSubscription(u.clientNumber, u.userId);
      const { events } = await getEvents(u.userId, new Date(now.getTime() - LOOKBACK_MS - 6 * 60 * 60_000), now, 100);
      const done = await prisma.$queryRawUnsafe<Array<{ event_id: string }>>(
        `SELECT event_id FROM meeting_records WHERE client_number = $1 AND user_id = $2 AND event_id IS NOT NULL
            AND status IN ('record_ready','not_covered')`, u.clientNumber, u.userId,
      );
      const finished = new Set(done.map((d) => d.event_id));
      for (const ev of events as any[]) {
        const end = Date.parse(ev.end);
        // A calendar link that is not a Meet (the event's own page, Zoom, Teams) is never ours to read: skipped, not
        // processed again every 5 minutes (Suzi Master, 13 Nov).
        if (!meetingCodeOf(ev.link) || ev.isAllDay || !Number.isFinite(end) || finished.has(ev.id)) continue;
        if (now.getTime() - end < ENDED_AFTER_MS || now.getTime() - end > LOOKBACK_MS) continue;
        const r = await processEndedEvent(u.clientNumber, u.userId, u.emails, ev).catch((e: any) => `error:${String(e?.message ?? e).slice(0, 80)}`);
        processed += 1;
        log.info('meeting processed', { userId: u.userId, eventId: ev.id, result: r });
      }
      // Instant Meets have no calendar event: his recent conferences are read too (tmcai-10, first live test 11-12).
      // A conference already finished in a record, or found not hosted, is not read again.
      processed += await pollConferences(u, now);
      const due = await prisma.$queryRawUnsafe<Array<{ id: string; meeting_key: string; conference_record: string; title: string | null; event_id: string | null; start_at: Date | null; end_at: Date | null }>>(
        `SELECT id, meeting_key, conference_record, title, event_id, start_at, end_at FROM meeting_records
          WHERE client_number = $1 AND user_id = $2 AND reread_due_at <= $3 AND conference_record IS NOT NULL`, u.clientNumber, u.userId, now,
      );
      if (due.length) {
        const meet = await meetFor(u.userId);
        for (const d of due) {
          await scheduleReread(d.id, null);
          if (!meet) continue;
          await ingestConference(u.clientNumber, u.userId, meet, d.conference_record, d.meeting_key,
            { title: d.title, eventId: d.event_id, start: d.start_at, end: d.end_at }, { reread: true }).catch(() => undefined);
          rereads += 1;
        }
      }
    } catch (e: any) {
      log.warn('meet poll failed for user', { userId: u.userId, error: e?.message?.slice(0, 160) });
    }
  }
  const trimmed = await trimOldTranscripts(now).catch(() => 0);
  return { users: users.length, processed, rereads, trimmed };
}

export function scheduleMeetPoll(): void {
  const tick = (): void => {
    void import('./jobRunner')
      .then(({ protectedTick }) => protectedTick('meet_poll', 'important', () => runMeetPoll()))
      .catch((e: any) => log.warn('meet poll tick could not run protected', { error: e?.message?.slice(0, 160) }));
  };
  setTimeout(() => { tick(); setInterval(tick, INTERVAL_MS); }, FIRST_TICK_MS);
  log.info('meet poll scheduled', { intervalMs: INTERVAL_MS });
}
