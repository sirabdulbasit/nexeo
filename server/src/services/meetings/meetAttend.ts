/**
 * F-4 Way A, "take notes" on a Google Meet he hosts (Functional Charter F-4.2 / F-4.9; NEXEO_SUZI_AGREEMENT item 5):
 *
 *   meeting.attend {event_id, way: "google_transcript"} → {meeting_id?, status: "transcribing" | "not_covered"}
 *
 * Nexeo switches the Meet space's own transcription on (Meet API: config.artifactConfig.transcriptionConfig.
 * autoTranscriptionGeneration = ON, scope meetings.space.settings, read live on his account 16 Nov 2026). Meet then
 * shows every participant that transcription is on (F-4.3). A meeting he does not host is `not_covered`, no attempt.
 * The record is made at once with status transcribing, so his choice is known (the pack's attend: always) and Suzi
 * has the meeting_id; the poller turns it into the record after the meeting.
 *
 * His "always" rules do the same by themselves, for his hosted meetings starting within the next 48 hours (autoAttend,
 * called from the meet poll). A "never" rule never switches a space off: what he set in Meet himself stays.
 */
import prisma from '../../db/prisma';
import createLogger from '../../utils/logger';
import { meetFor, meetingCodeOf } from './meetTranscripts';
import { keyForEvent, setStatus } from './meetingRecordStore';

const log = createLogger('meet-attend');
export const TRANSCRIPTION_MASK = 'config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration';
export const AUTO_AHEAD_MS = 48 * 60 * 60_000; // today and tomorrow, as the pack shows them

type Result = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
const fail = (error: string, detail?: string): Result => ({ ok: false, error, ...(detail ? { detail } : {}) });

export interface AttendEventIn { id: string; title?: string; start: string; end: string; organizer?: string; link?: string | null; isAllDay?: boolean }

/** Switch the space's transcription on. 'already_on' when Meet had it on; throws on an API failure. */
export async function transcriptionOn(meet: any, code: string): Promise<'switched_on' | 'already_on'> {
  return (await setTranscription(meet, code, 'ON')) === 'changed' ? 'switched_on' : 'already_on';
}

export async function setTranscription(meet: any, code: string, to: 'ON' | 'OFF'): Promise<'changed' | 'unchanged'> {
  const got = await meet.spaces.get({ name: `spaces/${code}` });
  const space = got?.data ?? {};
  if ((space?.config?.artifactConfig?.transcriptionConfig?.autoTranscriptionGeneration ?? 'OFF') === to) return 'unchanged';
  await meet.spaces.patch({
    name: space.name ?? `spaces/${code}`, updateMask: TRANSCRIPTION_MASK,
    requestBody: { config: { artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: to } } } },
  });
  return 'changed';
}

/** The events whose space Nexeo itself switched on (so meeting.leave may switch them off again): his own preferences,
 *  users.notification_preferences.meeting_assistant.nexeo_on {eventId: at}. Atomic jsonb writes, no read-modify-write. */
export async function markNexeoOn(userId: number, eventId: string, on: boolean): Promise<void> {
  if (on) {
    await prisma.$executeRawUnsafe(
      `UPDATE users SET notification_preferences = jsonb_set(notification_preferences, '{meeting_assistant,nexeo_on}',
          COALESCE(notification_preferences->'meeting_assistant'->'nexeo_on', '{}'::jsonb) || jsonb_build_object($2::text, now()::text))
        WHERE id = $1 AND notification_preferences ? 'meeting_assistant'`, userId, eventId,
    ).catch(() => undefined);
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE users SET notification_preferences = jsonb_set(notification_preferences, '{meeting_assistant,nexeo_on}',
          COALESCE(notification_preferences->'meeting_assistant'->'nexeo_on', '{}'::jsonb) - $2::text)
        WHERE id = $1 AND notification_preferences ? 'meeting_assistant'`, userId, eventId,
    ).catch(() => undefined);
  }
}
async function nexeoSwitchedOn(userId: number, eventId: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<Array<{ on: boolean }>>(
    `SELECT (notification_preferences->'meeting_assistant'->'nexeo_on') ? $2 AS on FROM users WHERE id = $1`, userId, eventId,
  ).catch(() => [] as Array<{ on: boolean }>);
  return r[0]?.on === true;
}

export const HIS_CHOICE = 'his_choice';

async function ownEmails(userId: number): Promise<string[]> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, integrationEmail: true } as any }).catch(() => null) as any;
  return [u?.email, u?.integrationEmail].filter(Boolean).map((e: string) => e.toLowerCase());
}

/** One meeting, by his word or his "always" rule. */
export async function attendEvent(clientNumber: string, userId: number, ev: AttendEventIn, deps: { meet?: any; own?: string[] } = {}): Promise<Result> {
  const code = meetingCodeOf(ev.link);
  if (!code || ev.isAllDay) return fail('not_meet', 'Way A covers a Google Meet only; notes on the computer cover the rest');
  if (Date.parse(ev.end) < Date.now()) return fail('ended', 'the meeting has already ended');
  const key = keyForEvent(ev.id);
  const base = { title: ev.title ?? null, eventId: ev.id, start: new Date(ev.start), end: new Date(ev.end) };
  const own = deps.own ?? await ownEmails(userId);
  if (!ev.organizer || !own.includes(ev.organizer.toLowerCase())) {
    const r = await setStatus(clientNumber, userId, key, 'not_covered', { ...base, reason: 'not_host' });
    return { ok: true, item: { meeting_id: r.id, status: 'not_covered', reason: 'not_host' } };
  }
  const meet = deps.meet ?? await meetFor(userId);
  if (!meet) return fail('needs_reconnect', 'Google is not connected');
  try {
    const how = await transcriptionOn(meet, code);
    if (how === 'switched_on') await markNexeoOn(userId, ev.id, true);
    log.info('meet transcription on', { userId, eventId: ev.id, how });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    log.warn('meet transcription not switched on', { userId, eventId: ev.id, error: msg.slice(0, 160) });
    if (/insufficient|scope|403|permission/i.test(msg)) return fail('needs_reconnect', 'Reconnect Google to allow Meet');
    return fail('meet_failed', msg.slice(0, 200));
  }
  const r = await setStatus(clientNumber, userId, key, 'transcribing', base);
  return { ok: true, item: { meeting_id: r.id, status: 'transcribing' } };
}

/** meeting.attend for Way A: finds the event in his calendar (the next 14 days, or one in progress). */
export async function meetingAttendWayA(clientNumber: string, userId: number, eventId: string): Promise<Result> {
  if (!eventId) return fail('bad_args', 'event_id is required');
  const { isOn } = await import('./meetingSwitch');
  if (!(await isOn(userId))) return fail('switched_off', 'Meeting Assistant is off in his Settings');
  const { getEvents } = await import('../calendarService');
  const { events, error } = await getEvents(userId, new Date(Date.now() - 6 * 60 * 60_000), new Date(Date.now() + 14 * 24 * 60 * 60_000), 250);
  if (error && !events.length) return fail('calendar_unavailable', error);
  const ev = (events as any[]).find((e) => e.id === eventId);
  if (!ev) return fail('not_found', 'no such event in his calendar in the next 14 days');
  return attendEvent(clientNumber, userId, ev);
}

/**
 * meeting.leave {event_id} for Way A (charter F-4.2 "switched on or off ... before or during it"; F-4.9; behaviour
 * proposed by suzi-b5 16 Nov): his single-meeting "never". If Nexeo switched the space on, it is switched back OFF; a
 * space he turned on in Meet himself is left alone. Either way the meeting gets no record from Nexeo (not_covered,
 * reason his_choice, no push) and the pack's attend reads never. A later meeting.attend wins again.
 */
export async function leaveEvent(clientNumber: string, userId: number, ev: AttendEventIn, deps: { meet?: any; own?: string[] } = {}): Promise<Result> {
  const code = meetingCodeOf(ev.link);
  if (!code || ev.isAllDay) return fail('not_meet', 'Way A covers a Google Meet only');
  const key = keyForEvent(ev.id);
  const base = { title: ev.title ?? null, eventId: ev.id, start: new Date(ev.start), end: new Date(ev.end) };
  const own = deps.own ?? await ownEmails(userId);
  if (ev.organizer && own.includes(ev.organizer.toLowerCase()) && await nexeoSwitchedOn(userId, ev.id)) {
    const meet = deps.meet ?? await meetFor(userId);
    if (!meet) return fail('needs_reconnect', 'Google is not connected');
    try { await setTranscription(meet, code, 'OFF'); } catch (e: any) {
      const msg = String(e?.message ?? e);
      log.warn('meet transcription not switched off', { userId, eventId: ev.id, error: msg.slice(0, 160) });
      if (/insufficient|scope|403|permission/i.test(msg)) return fail('needs_reconnect', 'Reconnect Google to allow Meet');
      return fail('meet_failed', msg.slice(0, 200));
    }
    await markNexeoOn(userId, ev.id, false);
  }
  const r = await setStatus(clientNumber, userId, key, 'not_covered', { ...base, reason: HIS_CHOICE, quiet: true });
  return { ok: true, item: { meeting_id: r.id, status: 'not_covered' } };
}

export async function meetingLeaveWayA(clientNumber: string, userId: number, eventId: string): Promise<Result> {
  if (!eventId) return fail('bad_args', 'event_id is required');
  const { getEvents } = await import('../calendarService');
  const { events, error } = await getEvents(userId, new Date(Date.now() - 6 * 60 * 60_000), new Date(Date.now() + 14 * 24 * 60 * 60_000), 250);
  if (error && !events.length) return fail('calendar_unavailable', error);
  const ev = (events as any[]).find((e) => e.id === eventId);
  if (!ev) return fail('not_found', 'no such event in his calendar in the next 14 days');
  return leaveEvent(clientNumber, userId, ev);
}

/** His "always" rules, applied to his hosted Meets starting within the next day. Idempotent; never switches off. */
export async function autoAttend(clientNumber: string, userId: number, events: AttendEventIn[], own: string[], now = new Date()): Promise<number> {
  const { meetingAttendRules, meetingAttendFor } = await import('../suzi/suziMeetingRules');
  const rules = await meetingAttendRules(clientNumber, userId).catch(() => []);
  if (!rules.some((r) => r.attend === 'always')) return 0;
  const chosen = await chosenEvents(clientNumber, userId);
  let n = 0;
  for (const ev of events) {
    const start = Date.parse(ev.start);
    if (!meetingCodeOf(ev.link) || ev.isAllDay || !Number.isFinite(start) || start - now.getTime() > AUTO_AHEAD_MS || Date.parse(ev.end) < now.getTime()) continue;
    if (chosen.has(ev.id)) continue;
    if (!ev.organizer || !own.includes(ev.organizer.toLowerCase())) continue; // the poller marks those not_covered after
    const d = meetingAttendFor(rules, { title: ev.title, organizer: ev.organizer, attendees: (ev as any).attendees, hasJoinLink: true });
    if (d.decision !== 'always') continue;
    const r = await attendEvent(clientNumber, userId, ev, { own });
    if (r.ok) n += 1;
  }
  return n;
}

/** His single-meeting choices for meetings still ahead: a record waiting with transcription on (always: meeting.attend
 *  or an applied always rule), or his meeting.leave (never). A finished record is a past meeting, not a choice: a
 *  moved event keeps its id (16 Nov, ECP Payroll held, then moved to the next day, showed attend always). */
export async function chosenEvents(clientNumber: string, userId: number): Promise<Map<string, 'always' | 'never'>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ event_id: string; status: string; status_reason: string | null }>>(
    `SELECT event_id, status, status_reason FROM meeting_records WHERE client_number = $1 AND user_id = $2 AND event_id IS NOT NULL
        AND (status = 'transcribing' OR (status = 'not_covered' AND status_reason = $3))`,
    clientNumber, userId, HIS_CHOICE,
  ).catch(() => [] as Array<{ event_id: string; status: string; status_reason: string | null }>);
  return new Map(rows.map((r) => [r.event_id, r.status === 'not_covered' ? 'never' as const : 'always' as const]));
}
