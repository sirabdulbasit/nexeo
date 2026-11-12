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

export async function enabledUsers(): Promise<Array<{ clientNumber: string; userId: number; emails: string[] }>> {
  const { MEETING_SWITCH } = await import('../services/meetings/meetingProcessor');
  const { getFlagValue } = await import('../services/featureFlagService');
  // Tenants that have the switch at all; the value is read through the flag service (it may be stored encrypted).
  const tenants = await (prisma as any).systemConfig.findMany({ where: { key: MEETING_SWITCH }, select: { clientNumber: true } }).catch(() => []);
  const rows: Array<{ client_number: string; value: string }> = [];
  for (const t of tenants as Array<{ clientNumber: string }>) {
    const value = await getFlagValue(t.clientNumber, MEETING_SWITCH, '').catch(() => '');
    if (value.trim()) rows.push({ client_number: t.clientNumber, value });
  }
  const out: Array<{ clientNumber: string; userId: number; emails: string[] }> = [];
  for (const r of rows) {
    const ids = String(r.value).split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isInteger);
    if (!ids.length) continue;
    const users = await prisma.user.findMany({ where: { id: { in: ids }, clientNumber: r.client_number } as any, select: { id: true, email: true, integrationEmail: true } as any });
    for (const u of users as any[]) {
      out.push({ clientNumber: r.client_number, userId: u.id, emails: [u.email, u.integrationEmail].filter(Boolean).map((e: string) => e.toLowerCase()) });
    }
  }
  return out;
}

export async function runMeetPoll(now = new Date()): Promise<{ users: number; processed: number; rereads: number; trimmed: number }> {
  const { processEndedEvent, ingestConference } = await import('../services/meetings/meetingProcessor');
  const { meetFor } = await import('../services/meetings/meetTranscripts');
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
        if (!ev.link || ev.isAllDay || !Number.isFinite(end) || finished.has(ev.id)) continue;
        if (now.getTime() - end < ENDED_AFTER_MS || now.getTime() - end > LOOKBACK_MS) continue;
        const r = await processEndedEvent(u.clientNumber, u.userId, u.emails, ev).catch((e: any) => `error:${String(e?.message ?? e).slice(0, 80)}`);
        processed += 1;
        log.info('meeting processed', { userId: u.userId, eventId: ev.id, result: r });
      }
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
