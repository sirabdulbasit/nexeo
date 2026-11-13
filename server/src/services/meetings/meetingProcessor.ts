/**
 * F-4 Way A: turn a hosted Google Meet into his meeting record.
 *
 *   hosted event ended  → find its conference record(s) → read the transcript → putTranscript (one record per meeting
 *   per user, keyed by the calendar event) → minutes, decisions and proposed action items from the model, merged
 *   without undoing his decisions (C6) and checked against his open items → record_ready; read once more later.
 *
 * A meeting he does not host is `not_covered` with no attempt. Action items stay proposals: they become tasks only on
 * his yes (task.create with source.meeting_id, F-4.7). Nothing is sent anywhere.
 */
import createLogger from '../../utils/logger';
import {
  keyForEvent, keyForConference, putTranscript, mergeDerived, saveDerived, scheduleReread, setStatus,
  type MeetingRecord, type TranscriptLine,
} from './meetingRecordStore';
import { meetFor, conferencesFor, conference, readTranscript, meetingCodeOf } from './meetTranscripts';

const log = createLogger('meetings');
export const FALLBACK_TITLE = /^Meet at \d{2}:\d{2}$/;

/** "Meet at 19:11" in his zone: the title of a meeting with no calendar event until the model names it. */
export async function fallbackTitle(userId: number, start: Date): Promise<string> {
  const { resolveUserTimezone } = await import('../userTimezoneService');
  const tz = await resolveUserTimezone(userId).catch(() => 'Asia/Karachi');
  const hhmm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(start);
  return `Meet at ${hhmm}`;
}

export const REREAD_AFTER_MS = 30 * 60_000;

/** F-4.2: his own switch, off by default (meetingSwitch.ts). clientNumber kept for callers; the switch is per user. */
export async function meetingAssistantOn(_clientNumber: string, userId: number): Promise<boolean> {
  const { isOn } = await import('./meetingSwitch');
  return isOn(userId);
}

export interface HostedEvent { id: string; title: string; start: string; end: string; organizer?: string; link?: string; attendees?: string[] }

/** The model writes the minutes, decisions and action items from the transcript. Null when it cannot. */
export async function deriveMinutes(title: string, lines: TranscriptLine[], ownerName: string): Promise<{
  title?: string; minutes: string; decisions: string[]; action_items: Array<{ title: string; owner_name?: string; due?: string }>;
} | null> {
  if (lines.length === 0) return null;
  let text = lines.map((l) => `${l.speaker}: ${l.text}`).join('\n');
  if (text.length > 120_000) text = text.slice(0, 120_000);
  const system = [
    `You write the record of a meeting for ${ownerName || 'the host'}, from its transcript with speakers named.`,
    'Write plainly, in English, in your own words. Never invent anything that was not said.',
    'title: a short name for the meeting, at most 8 words, from what was discussed.',
    'minutes: 3 to 8 short sentences: what was discussed and where it landed.',
    'decisions: each decision that was clearly made, one short sentence each (empty if none).',
    'action_items: each concrete thing someone agreed or was asked to do: an imperative title (at most 12 words), owner_name as said in the meeting if clear, due as YYYY-MM-DD only if a date was said. Empty if none.',
    'Answer strict JSON only: {"title": string, "minutes": string, "decisions": [string], "action_items": [{"title": string, "owner_name"?: string, "due"?: string}]}',
  ].join('\n');
  try {
    const { callGemini } = await import('../geminiService');
    const raw = await callGemini(system, `Meeting: ${title}\n\nTranscript:\n${text}`, { flash: true, maxTokens: 2000, responseMimeType: 'application/json' });
    const j = JSON.parse(String(raw));
    if (typeof j?.minutes !== 'string') return null;
    return {
      ...(typeof j.title === 'string' && j.title.trim() ? { title: j.title.trim().slice(0, 120) } : {}),
      minutes: j.minutes.slice(0, 4000),
      decisions: Array.isArray(j.decisions) ? j.decisions.map(String).filter(Boolean).slice(0, 30) : [],
      action_items: Array.isArray(j.action_items)
        ? j.action_items.filter((a: any) => a && typeof a.title === 'string' && a.title.trim()).slice(0, 40).map((a: any) => ({
          title: String(a.title).trim().slice(0, 200),
          ...(a.owner_name ? { owner_name: String(a.owner_name).slice(0, 100) } : {}),
          ...(/^\d{4}-\d{2}-\d{2}$/.test(String(a.due ?? '')) ? { due: String(a.due) } : {}),
        }))
        : [],
    };
  } catch (e: any) {
    log.warn('minutes not derived', { error: e?.message?.slice(0, 120) });
    return null;
  }
}

async function openTitles(clientNumber: string, userId: number): Promise<string[]> {
  const { getOpenItems } = await import('../views/openItems');
  return (await getOpenItems({ clientNumber, userId, opts: { limit: 200 } }).catch(() => [])).map((o: any) => o.title);
}

async function ownerName(userId: number, clientNumber: string): Promise<string> {
  const { getBrainPersona } = await import('../knowledge/brainPersonaService');
  const p = await getBrainPersona(userId, clientNumber).catch(() => null);
  return p?.userFullName || p?.userFirstName || '';
}

/** Derive and store the minutes when the transcript is new or better. */
export async function deriveInto(clientNumber: string, userId: number, rec: MeetingRecord): Promise<void> {
  const d = await deriveMinutes(rec.title ?? 'Meeting', rec.transcript, await ownerName(userId, clientNumber));
  if (!d) {
    if (rec.status !== 'record_ready') await setStatus(clientNumber, userId, rec.meeting_key, 'failed', { reason: 'minutes_not_derived' });
    return;
  }
  await saveDerived(rec.id, mergeDerived(rec, d, await openTitles(clientNumber, userId)));
  // A meeting with no calendar event (an instant Meet) carries the fallback "Meet at HH:MM"; the model's short
  // title replaces it. A title from his calendar is never replaced.
  if (d.title && (!rec.title || FALLBACK_TITLE.test(rec.title))) {
    const { setTitle } = await import('./meetingRecordStore');
    await setTitle(rec.id, d.title);
  }
}

/** Read one conference into the record under `key`. Returns the record, or null when no transcript exists yet. */
export async function ingestConference(
  clientNumber: string, userId: number, meet: any, confName: string, key: string,
  meta: { title?: string | null; eventId?: string | null; start?: Date | null; end?: Date | null },
  opts: { reread?: boolean } = {},
): Promise<MeetingRecord | null> {
  const conf = await conference(meet, confName);
  const t = await readTranscript(meet, confName);
  if (!t.transcriptName) return null;
  if (t.state === 'STARTED' || t.lines.length === 0) {
    return setStatus(clientNumber, userId, key, 'transcribing', { title: meta.title, eventId: meta.eventId, start: meta.start, end: meta.end });
  }
  const { record, derive } = await putTranscript(clientNumber, userId, key, {
    way: 'google_transcript', ref: t.transcriptName, title: meta.title ?? null, eventId: meta.eventId ?? null,
    conferenceRecord: confName, space: conf?.space ?? null, platform: 'meet',
    start: meta.start ?? (conf?.startTime ? new Date(conf.startTime) : null),
    end: meta.end ?? (conf?.endTime ? new Date(conf.endTime) : null),
    participants: t.participants, transcript: t.lines,
  });
  const { recordMeetingTranscriptMinutes } = await import('../consumption/consumptionService');
  await recordMeetingTranscriptMinutes(clientNumber, userId, t.transcriptName, t.minutes).catch(() => undefined);
  if (derive) await deriveInto(clientNumber, userId, record);
  // Google's entries can be incomplete right after fileGenerated: read once more, later (cleared after that read).
  if (!opts.reread && !record.reread_due_at && !(record.sources ?? []).some((x: any) => x.reread)) {
    await scheduleReread(record.id, new Date(Date.now() + REREAD_AFTER_MS));
  }
  const { getRecord } = await import('./meetingRecordStore');
  return getRecord(clientNumber, userId, record.id);
}

/**
 * Google makes a transcript within about an hour of the end, or not at all (transcription was off). Two hours after
 * the end, a meeting with none is settled as not_covered, so the 5-minute poll stops asking for it; a transcript that
 * still arrives later (or the computer's notes) replaces it, because a better transcript always wins.
 */
export const SETTLE_AFTER_MS = 2 * 60 * 60_000;
async function settleIfLong(
  clientNumber: string, userId: number, key: string, result: string,
  base: { title?: string | null; eventId?: string | null; start?: Date | null; end?: Date | null; conferenceRecord?: string | null },
): Promise<string> {
  if (!base.end || Date.now() - base.end.getTime() < SETTLE_AFTER_MS) return result;
  await setStatus(clientNumber, userId, key, 'not_covered', { ...base, reason: result });
  return 'not_covered';
}

/** A calendar event that has ended: hosted → read Google's transcript; not hosted → not_covered, no attempt. */
export async function processEndedEvent(clientNumber: string, userId: number, ownEmails: string[], ev: HostedEvent): Promise<string> {
  const code = meetingCodeOf(ev.link);
  if (!code) return 'no_meet_link';
  const key = keyForEvent(ev.id);
  const start = new Date(ev.start); const end = new Date(ev.end);
  const hosted = !!ev.organizer && ownEmails.includes(ev.organizer.toLowerCase());
  if (!hosted) {
    await setStatus(clientNumber, userId, key, 'not_covered', { title: ev.title, eventId: ev.id, start, end, reason: 'not_host' });
    return 'not_covered';
  }
  const meet = await meetFor(userId);
  if (!meet) return 'no_google_client';
  let confs: Awaited<ReturnType<typeof conferencesFor>> = [];
  try { confs = await conferencesFor(meet, code, start, end); } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (/insufficient|scope|403/i.test(msg)) return 'needs_reconnect';
    throw e;
  }
  if (confs.length === 0) return settleIfLong(clientNumber, userId, key, 'no_conference', { title: ev.title, eventId: ev.id, start, end });
  let out = 'no_transcript';
  for (const c of confs) {
    const rec = await ingestConference(clientNumber, userId, meet, c.name, key, { title: ev.title, eventId: ev.id, start, end });
    if (rec) out = rec.status;
  }
  if (out === 'no_transcript') return settleIfLong(clientNumber, userId, key, out, { title: ev.title, eventId: ev.id, start, end, conferenceRecord: confs[0]?.name ?? null });
  return out;
}

/** From a Workspace Events delivery: the conference record names the meeting; his calendar event keys it if found. */
export async function processConferenceForUser(clientNumber: string, userId: number, confName: string): Promise<string> {
  const meet = await meetFor(userId);
  if (!meet) return 'no_google_client';
  const conf = await conference(meet, confName);
  if (!conf) return 'no_conference';
  const start = new Date(conf.startTime);
  const { getEvents } = await import('../calendarService');
  const { events } = await getEvents(userId, new Date(start.getTime() - 3 * 60 * 60_000), new Date(start.getTime() + 3 * 60 * 60_000), 50);
  const space = await meet.spaces.get({ name: conf.space }).catch(() => null);
  const code = String(space?.data?.meetingCode ?? '').toLowerCase();
  // C5: his event with this Meet code; else an event of his that overlaps the conference (an instant Meet called
  // during a booked slot); else the conference gets its own record.
  const startMs = start.getTime();
  const ev = (code ? events.find((e: any) => meetingCodeOf(e.link) === code) : undefined)
    ?? events.find((e: any) => !e.isAllDay && Date.parse(e.start) <= startMs + 10 * 60_000 && Date.parse(e.end) >= startMs);
  const key = ev ? keyForEvent(ev.id) : keyForConference(conf.space, start);
  const rec = await ingestConference(clientNumber, userId, meet, confName, key, {
    title: ev?.title ?? await fallbackTitle(userId, start), eventId: ev?.id ?? null, start: ev ? new Date(ev.start) : start, end: ev ? new Date(ev.end) : (conf.endTime ? new Date(conf.endTime) : null),
  });
  if (rec) return rec.status;
  const endAt = ev ? new Date(ev.end) : (conf.endTime ? new Date(conf.endTime) : null);
  return settleIfLong(clientNumber, userId, key, 'no_transcript', { title: ev?.title ?? null, eventId: ev?.id ?? null, start, end: endAt, conferenceRecord: confName });
}
