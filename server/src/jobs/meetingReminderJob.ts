/**
 * Functional Charter row 7, Nexeo side: "reminders while the computer is off" (DEF-453; Suzi Master AGREE 13 Nov 2026
 * with one condition, the nudges setting). Every 2 minutes, for each user Brain may message:
 *   - meetings starting in the next 10 minutes that this sweep has not covered yet: timed (not all-day), not
 *     cancelled, not declined by him;
 *   - ONLY when no Suzi device of his is alive (the charter's presence rule): while one is, Suzi's own alert covers it,
 *     so the two never double. A user with no Suzi device always gets it;
 *   - nothing when his latest presence frame said nudges off (Suzi Master's condition: kept and given when asked);
 *   - one message for meetings starting together; once per event and start (dedup key); quiet hours and the rest of
 *     Brain's delivery rules apply (WhatsApp first, email if that can't deliver).
 * The fact is built here (title, time in his zone, who, join link); the wording is the model's (owner ruling,
 * 19 Aug: never a template); the join link is appended verbatim because it must be exact.
 */
import prisma from '../db/prisma';
import createLogger from '../utils/logger';

const log = createLogger('meeting-reminder');
export const TICK_MS = 2 * 60_000;
export const LEAD_MS = 10 * 60_000;

export interface ReminderEvent {
  id: string; title: string; start: string; end: string; isAllDay: boolean; status?: string;
  attendees?: string[]; organizer?: string; link?: string; location?: string; selfResponse?: string;
}

/** Meetings whose reminder moment (start - 10 min) falls in (from, to]. */
export function dueMeetings(events: ReminderEvent[], from: Date, to: Date): ReminderEvent[] {
  return events.filter((e) => {
    if (e.isAllDay || e.status === 'cancelled' || e.selfResponse === 'declined') return false;
    const at = Date.parse(e.start) - LEAD_MS;
    return Number.isFinite(at) && at > from.getTime() && at <= to.getTime();
  });
}

/** A link he can press: Google Meet, or a conferencing URL written in the location. Never the calendar page. */
export function joinLinkOf(e: ReminderEvent): string | null {
  if (e.link && /meet\.google\.com\//.test(e.link)) return e.link;
  const m = (e.location ?? '').match(/https?:\/\/\S*(zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com|meet\.google\.com)\S*/i);
  return m ? m[0] : null;
}

/** Whether Nexeo should send now: no Suzi device alive, and his latest frame did not say nudges off. */
export async function mayRemind(clientNumber: string, userId: number, now: Date): Promise<{ ok: boolean; why?: string }> {
  const { reachFor } = await import('../services/suzi/suziReach');
  const reach = await reachFor(clientNumber, userId, now);
  if (!reach.adopted) return { ok: true };
  if (reach.alive) return { ok: false, why: 'suzi_alive' };
  const last = await prisma.$queryRawUnsafe<Array<{ nudges_off: boolean | null }>>(
    `SELECT nudges_off FROM suzi_presence WHERE client_number = $1 AND user_id = $2 ORDER BY last_frame_at DESC LIMIT 1`,
    clientNumber, userId,
  ).catch(() => [] as Array<{ nudges_off: boolean | null }>);
  if (last[0]?.nudges_off) return { ok: false, why: 'nudges_off' };
  return { ok: true };
}

async function namesOf(clientNumber: string, userId: number, emails: string[]): Promise<string[]> {
  const list = emails.map((e) => e.toLowerCase()).filter(Boolean).slice(0, 8);
  if (!list.length) return [];
  const rows = await prisma.$queryRawUnsafe<Array<{ email: string; name: string }>>(
    `SELECT DISTINCT ON (lower(f.facet_value)) lower(f.facet_value) AS email, p.display_name AS name
       FROM person_facets f JOIN persons p ON p.id = f.person_id
      WHERE p.client_number = $1 AND p.user_id = $2 AND f.facet_type = 'email' AND lower(f.facet_value) = ANY($3::text[])
      ORDER BY lower(f.facet_value), f.verified DESC`,
    clientNumber, userId, list,
  ).catch(() => [] as Array<{ email: string; name: string }>);
  const byEmail = new Map(rows.map((r) => [r.email, r.name]));
  return list.map((e) => byEmail.get(e) || e.split('@')[0]);
}

/** The fact for one reminder message (one or more meetings starting together). */
export function reminderFact(items: Array<{ title: string; time: string; who: string[] }>): string {
  const one = (m: { title: string; time: string; who: string[] }) =>
    `"${m.title}" at ${m.time}${m.who.length ? `, with ${m.who.slice(0, 4).join(', ')}${m.who.length > 4 ? ` and ${m.who.length - 4} more` : ''}` : ''}`;
  return `[meeting reminder: starts in 10 minutes: ${items.map(one).join('; and ')}]`;
}

async function usersToCheck(): Promise<Array<{ id: number; clientNumber: string; emails: string[] }>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: number; client_number: string; email: string | null; integration_email: string | null }>>(
    `SELECT id, client_number, email, integration_email FROM users
      WHERE notification_preferences->'brain_channel'->>'outboundEnabled' = 'true'`,
  ).catch(() => [] as Array<{ id: number; client_number: string; email: string | null; integration_email: string | null }>);
  return rows.map((u) => ({ id: u.id, clientNumber: u.client_number, emails: [u.email, u.integration_email].filter(Boolean).map((e) => String(e).toLowerCase()) }));
}

export async function runMeetingReminders(from: Date, to: Date): Promise<{ users: number; sent: number; skipped: number }> {
  const { getEvents } = await import('../services/calendarService');
  const { brainContactsUser } = await import('../services/notifications/brainOutboundService');
  const { renderMarkerInBrainVoice } = await import('../services/knowledge/markerVoice');
  const { resolveUserTimezone } = await import('../services/userTimezoneService');
  const users = await usersToCheck();
  let sent = 0; let skipped = 0;
  for (const u of users) {
    try {
      const { events } = await getEvents(u.id, new Date(from.getTime() + LEAD_MS - 60_000), new Date(to.getTime() + LEAD_MS + 60_000), 50);
      const due = dueMeetings(events as ReminderEvent[], from, to);
      if (!due.length) continue;
      const may = await mayRemind(u.clientNumber, u.id, to);
      if (!may.ok) { skipped += 1; log.info('reminder not sent', { userId: u.id, why: may.why, events: due.map((e) => e.id) }); continue; }
      const tz = await resolveUserTimezone(u.id).catch(() => 'UTC');
      const items = [];
      for (const e of due) {
        const who = await namesOf(u.clientNumber, u.id, (e.attendees ?? []).filter((a) => a && !u.emails.includes(a.toLowerCase())));
        const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(e.start));
        items.push({ title: e.title, time, who, link: joinLinkOf(e) });
      }
      const said = await renderMarkerInBrainVoice(reminderFact(items), { clientNumber: u.clientNumber, userId: u.id, audience: 'owner' });
      const links = items.filter((i) => i.link).map((i) => (items.length > 1 ? `${i.title}: ${i.link}` : `Join: ${i.link}`));
      const body = [said, ...links].join('\n');
      const r = await brainContactsUser({
        userId: u.id, clientNumber: u.clientNumber, kind: 'meeting_reminder', provenance: 'deterministic',
        summary: `Meeting in 10 minutes: ${items.map((i) => i.title).join(', ')}`.slice(0, 200), body, urgency: 'high',
        dedupKey: `meeting_reminder:${due.map((e) => `${e.id}@${e.start}`).sort().join(',')}`.slice(0, 250),
        dedupWindowMs: 60 * 60_000,
        metadata: { events: due.map((e) => ({ id: e.id, start: e.start })) },
      });
      if (r.sent) sent += 1; else skipped += 1;
      log.info('meeting reminder', { userId: u.id, events: due.map((e) => e.id), sent: r.sent, reason: r.reason, channels: r.channelsUsed });
    } catch (e: any) {
      log.warn('meeting reminder failed for user', { userId: u.id, error: e?.message?.slice(0, 160) });
    }
  }
  return { users: users.length, sent, skipped };
}

export function scheduleMeetingReminders(): void {
  // Each tick covers the reminder moments since the previous one, so a meeting is considered exactly once per process.
  let last = new Date(Date.now() - TICK_MS);
  const tick = (): void => {
    const now = new Date(); const from = last; last = now;
    void import('./jobRunner')
      .then(({ protectedTick }) => protectedTick('meeting_reminder', 'important', () => runMeetingReminders(from, now)))
      .catch((e: any) => log.warn('meeting reminder tick could not run protected', { error: e?.message?.slice(0, 160) }));
  };
  setInterval(tick, TICK_MS);
  log.info('meeting reminders scheduled', { intervalMs: TICK_MS, leadMs: LEAD_MS });
}
