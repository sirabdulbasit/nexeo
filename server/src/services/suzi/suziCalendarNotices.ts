/**
 * Link T34 (both AGREE 17 Nov 2026; charter "Calendar notices into the meeting"): every calendar notification email in
 * his Inbox and Sent (invitation, updated invitation, accepted, declined, tentative, proposed new time, cancelled) is
 * linked to its event, read at pack time from the Wiki's email sources (no new table). The match, in this order:
 *
 *   1. the event id in the email's Google Calendar links (`eid=`, base64 of "<event id> <calendar>");
 *   2. the invite's iCalendar UID ("<event id>@google.com" in the text);
 *   3. the title plus the date in the subject, only when exactly one of his events matches.
 *
 * An email no step can place stays where it is. The pack's events carry `updates[]` (newest first, at most 10); placed
 * notices carry `emails[].event_id` and leave the emails needing a reply, except a proposed new time for a meeting still
 * ahead, which stays.
 */
import prisma from '../../db/prisma';
import { localDate } from './dayBriefFacts';

export type NoticeKind = 'invited' | 'accepted' | 'declined' | 'tentative' | 'proposed_time' | 'changed' | 'cancelled' | 'note';
export interface EventUpdate { at: string; who: string; kind: NoticeKind; note?: string; email_id?: string; thread_id?: string }
export const UPDATES_MAX = 10;
export const NOTICE_WINDOW_DAYS = 21;

const PREFIXES: Array<[RegExp, NoticeKind]> = [
  [/^\s*updated\s+invitation(?:\s+with\s+note)?\s*:/i, 'changed'],
  [/^\s*invitation(?:\s+with\s+note)?\s*:/i, 'invited'],
  [/^\s*new\s+event\s*:/i, 'invited'],
  [/^\s*tentatively\s+accepted(?:\s+with\s+note)?\s*:/i, 'tentative'],
  [/^\s*accepted(?:\s+with\s+note)?\s*:/i, 'accepted'],
  [/^\s*declined(?:\s+with\s+note)?\s*:/i, 'declined'],
  [/^\s*proposed\s+new\s+time\s*:/i, 'proposed_time'],
  [/^\s*cancell?ed\s+event(?:\s+with\s+note)?\s*:/i, 'cancelled'],
];
/** SQL twin of PREFIXES, for /v1/changes. */
export const NOTICE_SUBJECT_SQL = `'^\\s*(updated invitation|invitation|new event|tentatively accepted|accepted|declined|proposed new time|cancell?ed event)( with note)?\\s*:'`;

export function noticeKind(subject: string | null | undefined): NoticeKind | null {
  const s = String(subject ?? '');
  for (const [re, k] of PREFIXES) if (re.test(s)) return k;
  return null;
}

/** Step 1: the event ids in the email's Google Calendar links. */
export function eidEventIds(body: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of String(body ?? '').matchAll(/[?&]eid=([A-Za-z0-9_%-]+)/g)) {
    try {
      let e = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/');
      e += '='.repeat((4 - (e.length % 4)) % 4);
      const id = Buffer.from(e, 'base64').toString('utf8').split(' ')[0]?.trim();
      if (id && /^[A-Za-z0-9_]+$/.test(id) && !out.includes(id)) out.push(id);
    } catch { /* not a calendar link */ }
  }
  return out;
}

/** Step 2: iCalendar UIDs of Google events ("<id>@google.com"). */
export function icalEventIds(body: string | null | undefined): string[] {
  return [...new Set([...String(body ?? '').matchAll(/\b([a-z0-9_]{10,})@google\.com\b/gi)].map((m) => m[1]))];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Step 3's facts: "<Kind>: <Title> @ <Wed> <Nov> <18>, <2026> …" → title and date (null when not readable). */
export function subjectTitleDate(subject: string | null | undefined): { title: string; date: string } | null {
  const s = String(subject ?? '').replace(/^[^:]*:\s*/, '');
  const at = s.lastIndexOf(' @ ');
  if (at < 0) return null;
  const m = s.slice(at + 3).match(/^(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  return { title: s.slice(0, at).trim(), date: `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}` };
}

export interface NoticeEvent { id: string; title: string; day: string | null; start: string | null }

/** The event a notice belongs to, by the three steps in order; null when none places it. */
export function placeNotice(n: { subject: string; body: string | null }, events: NoticeEvent[]): NoticeEvent | null {
  const td = subjectTitleDate(n.subject);
  const byId = (ids: string[]) => {
    for (const id of ids) {
      const exact = events.find((e) => e.id === id);
      if (exact) return exact;
      // A recurring series' id: only the instance on the subject's own date (a Monday's "Accepted" is not Wednesday's).
      const inst = events.filter((e) => e.id.startsWith(`${id}_`) && !!td && e.day === td.date);
      if (inst.length === 1) return inst[0];
    }
    return null;
  };
  const one = byId(eidEventIds(n.body)) ?? byId(icalEventIds(n.body));
  if (one) return one;
  if (!td) return null;
  const hits = events.filter((e) => e.day === td.date && norm(e.title) === norm(td.title));
  return hits.length === 1 ? hits[0] : null;
}

const addressOf = (s: string) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase();
const displayOf = (s: string) => (s.includes('<') ? s.slice(0, s.indexOf('<')).replace(/"/g, '').trim() : '');

export interface NoticeLinks {
  /** event id → updates, newest first, at most 10 */
  updates: Map<string, EventUpdate[]>;
  /** email thread → the event it was placed on, and its kind */
  threads: Map<string, { event_id: string; kind: NoticeKind; start: string | null }>;
}

/** His calendar notices of the last three weeks, placed on these events. A read that fails places nothing. */
export async function noticeLinks(
  clientNumber: string, userId: number, raw: Array<{ eventId?: string; id?: string; title?: string; start?: string; status?: string }>, tz: string,
  names: Map<string, string> = new Map(), mine: Set<string> = new Set(), now = new Date(),
): Promise<NoticeLinks> {
  const out: NoticeLinks = { updates: new Map(), threads: new Map() };
  const events: NoticeEvent[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    const id = String(e?.eventId ?? e?.id ?? '');
    if (!id || seen.has(id) || !e?.start) continue;
    seen.add(id);
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(e.start);
    const start = dateOnly ? null : new Date(e.start);
    events.push({ id, title: String(e.title ?? ''), day: dateOnly ? e.start : start && !isNaN(start.getTime()) ? localDate(start, tz) : null, start: start && !isNaN(start.getTime()) ? start.toISOString() : null });
  }
  if (!events.length) return out;
  const rows = await prisma.$queryRawUnsafe<Array<{ external_id: string; thread_key: string | null; title: string | null; occurred_at: Date; sender: string | null; body: string | null }>>(
    `SELECT external_id, thread_key, title, occurred_at, details->>'from' AS sender, body_text AS body FROM wiki_sources
      WHERE client_number = $1 AND user_id = $2 AND kind = 'email' AND occurred_at > $3 AND title ~* ${NOTICE_SUBJECT_SQL}
      ORDER BY occurred_at DESC LIMIT 300`,
    clientNumber, userId, new Date(now.getTime() - NOTICE_WINDOW_DAYS * 86_400_000),
  ).catch(() => []);
  for (const r of rows) { // newest first
    const kind = noticeKind(r.title);
    if (!kind) continue;
    const ev = placeNotice({ subject: String(r.title ?? ''), body: r.body }, events);
    if (!ev) continue;
    const from = String(r.sender ?? '');
    const addr = addressOf(from);
    const who = mine.has(addr) ? 'you' : (names.get(addr) || displayOf(from) || addr || 'someone').slice(0, 120);
    const list = out.updates.get(ev.id) ?? [];
    if (list.length < UPDATES_MAX) list.push({ at: new Date(r.occurred_at).toISOString(), who, kind, email_id: r.external_id, ...(r.thread_key ? { thread_id: r.thread_key } : {}) });
    out.updates.set(ev.id, list);
    const thread = r.thread_key ?? r.external_id;
    if (!out.threads.has(thread)) out.threads.set(thread, { event_id: ev.id, kind, start: ev.start });
  }
  return out;
}
