/**
 * Day contract, Phase 1 — the day pack: Suzi's local working copy of the user's day.
 *
 * Spec, 2026-11-04: Suzi runs the day from a local copy; Nexeo stays the system of record and
 * the only writer. `buildDayPack` returns, for ONE user and only what they may see:
 *
 *   calendar   today and tomorrow in full; the rest of the week as titles only
 *   actions    all open items
 *   emails     threads needing a reply: a preview of at most 200 characters, never a body
 *   kpis       key figures, numbers filled by the server
 *   brief      the day-brief blocks in Suzi's present_report format
 *
 * Every time is in the user's own zone, with its offset (DEF-387). The numbers come from the
 * server; only `title` and `say` of a brief block are the model's to write, so `say` is empty
 * here and `title` is the default for a model that writes none. One source down never fails
 * the pack: `missing` says which and how to reconnect it (the DEF-385 rule).
 */
import { meetingAttendFor, type MeetingAttendRule } from './suziMeetingRules';
import { emailGist } from './emailGist';
import { rulesDocument, type RulesDocument, type SuziRules } from './suziRules';
import { recentPeople, type SuziPerson } from './suziPeople';
import prisma from '../../db/prisma';
import { buildDayBriefFacts, loadAttentionEmails, localDate, safeTimezone, type BriefBlock, type DayBriefFacts } from './dayBriefFacts';
import { listPendingActions, type SuziAction } from './suziActions';
import { toZonedIso } from './zonedTime';
import createLogger from '../../utils/logger';

const log = createLogger('day-pack');

/**
 * DEF-511 (19 Nov): Suzi waits 20 s for the pack, twice, then stays on the morning's copy. Usually the pack takes 2–5 s,
 * but a slow outside read (Google Calendar, Gmail, the Wiki's emails) could hold the whole pack past her limit.
 * Each such part now has its own cap: past it, the part answers as it does when its read fails (left out, or the feed
 * copy, or emails_loading), and the pack goes on. Every pack logs its parts' times; one over PACK_SLOW_MS is a warning.
 */
export const PART_CAP_MS = 4000;
export const ATTENTION_CAP_MS = 6000;
export const PACK_SLOW_MS = 5000;

export async function capped<T>(times: Record<string, number | string>, name: string, work: () => Promise<T>, fallback: T, capMs: number = PART_CAP_MS): Promise<T> {
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof CAPPED>((res) => { timer = setTimeout(() => res(CAPPED), capMs); (timer as any).unref?.(); });
  const p = work();
  p.catch(() => undefined); // a part that loses the race must not become an unhandled rejection
  try {
    const out = await Promise.race([p, late]);
    if (out === CAPPED) { times[name] = `capped>${capMs}`; return fallback; }
    times[name] = Date.now() - t0;
    return out as T;
  } finally { clearTimeout(timer); }
}
const CAPPED = Symbol('capped');

/** Our own database reads (the brief, the actions): timed, never capped — there is no fallback for them. */
async function timed<T>(times: Record<string, number | string>, name: string, work: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try { return await work(); } finally { times[name] = Date.now() - t0; }
}
import { packPeople, readableName as nameFromEmail, meetingsRecorded, type RecordedMeeting } from './packMeetings';
import { noticeLinks, type EventUpdate, type NoticeLinks } from './suziCalendarNotices';

export const DAY_PACK_VERSION = 1;
export const EMAIL_PREVIEW_MAX = 200;
export const MAX_BRIEF_BLOCKS = 8;

export interface RawPackEvent {
  eventId?: string; id?: string; title?: string; start?: string; end?: string; isAllDay?: boolean;
  attendees?: unknown[]; organizer?: unknown; location?: string | null; link?: string | null; hangoutLink?: string | null; status?: string;
}
/** Slice 2 (agreed 13 Nov, suzi-b5): name from his contacts, else readable from the address; self on his own. */
export interface PackAttendee { name: string; email: string; self?: true }
export interface PackEvent {
  id: string; start: string; end: string | null; all_day: boolean; title: string;
  attendees: PackAttendee[]; organizer_self: boolean; organizer: { name: string; email: string } | null; location: string | null; link: string | null; prep_notes: string | null;
  /** F-4.2: only on his hosted Meets while his switch is on; always = the space's transcription is really on. */
  attend?: { decision: 'always' | 'never' | 'ask'; rule_id?: string };
  /** T34 (both AGREE 17 Nov): the calendar notices about this event, newest first, at most 10. */
  updates?: EventUpdate[];
}
export type AttendOf = (e: RawPackEvent, id: string, organizerSelf: boolean, link: string | null) => PackEvent['attend'] | undefined;
/** His own addresses (lower-cased) and the names his contacts give addresses, for attendees. */
export interface PackPeople { own: Set<string>; names: Map<string, string> }

const addrOf = (a: unknown): string => String((a as any)?.email ?? a ?? '').trim().toLowerCase();

function packAttendees(raw: unknown[] | undefined, people: PackPeople): PackAttendee[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PackAttendee[] = [];
  for (const a of raw) {
    const email = addrOf(a);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const given = String((a as any)?.displayName ?? (a as any)?.name ?? '').trim();
    const name = people.names.get(email) || given || nameFromEmail(email) || email;
    out.push({ name: name.slice(0, 120), email, ...(people.own.has(email) || (a as any)?.self === true ? { self: true as const } : {}) });
    if (out.length >= 50) break;
  }
  return out;
}
/** Suzi 24 Nov 09:31: who organised the event, so Suzi can write to them; null when it is him or unknown. */
function organizerOf(raw: unknown, self: boolean, people: PackPeople): { name: string; email: string } | null {
  const email = addrOf(raw);
  if (self || !email) return null;
  const given = String((raw as any)?.displayName ?? (raw as any)?.name ?? '').trim();
  return { name: (people.names.get(email) || given || nameFromEmail(email) || email).slice(0, 120), email };
}
export interface PackCalendar { today: PackEvent[]; tomorrow: PackEvent[]; rest_of_week: Array<{ id: string; date: string; title: string }> }

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Sunday closing `day`'s week (Monday-first). */
export function endOfWeek(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, dow === 0 ? 0 : 7 - dow);
}

/**
 * Sort synced events into the pack's calendar. `events` must be newest-synced first: the poller
 * can store an event more than once, and the latest copy is the true one.
 */
export function packCalendar(events: RawPackEvent[], today: string, tz: string, prep: Map<string, string> = new Map(), people: PackPeople = { own: new Set(), names: new Map() }, attendOf?: AttendOf): PackCalendar {
  const tomorrow = addDays(today, 1);
  const weekEnd = endOfWeek(today);
  const seen = new Set<string>();
  const dated: Array<{ day: string; sort: string; ev: PackEvent }> = [];
  for (const e of events) {
    if (!e?.start) continue;
    const id = String(e.eventId ?? e.id ?? `${e.start}|${e.title ?? ''}`);
    if (seen.has(id)) continue;
    seen.add(id);
    if (e.status === 'cancelled') continue;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(e.start);
    const start = dateOnly ? null : new Date(e.start);
    if (start && isNaN(start.getTime())) continue;
    const day = dateOnly ? e.start : localDate(start!, tz);
    const end = e.end && !/^\d{4}-\d{2}-\d{2}$/.test(e.end) && !isNaN(new Date(e.end).getTime()) ? toZonedIso(new Date(e.end), tz) : (e.end ?? null);
    const allDay = !!e.isAllDay || dateOnly;
    const organizerSelf = !!addrOf(e.organizer) && people.own.has(addrOf(e.organizer));
    const link = e.hangoutLink ?? e.link ?? null;
    const attend = attendOf && !allDay ? attendOf(e, id, organizerSelf, link) : undefined;
    dated.push({
      day,
      sort: allDay ? '0' : `1${start!.toISOString()}`,
      ev: {
        id,
        start: dateOnly ? e.start : toZonedIso(start!, tz),
        end,
        all_day: allDay,
        title: String(e.title || '(no title)').slice(0, 200),
        attendees: packAttendees(e.attendees, people),
        organizer_self: organizerSelf,
        organizer: organizerOf(e.organizer, organizerSelf, people),
        location: e.location ?? null,
        link,
        prep_notes: prep.get(id) ?? null,
        ...(attend ? { attend } : {}),
      },
    });
  }
  dated.sort((a, b) => a.sort.localeCompare(b.sort));
  return {
    today: dated.filter((x) => x.day === today).map((x) => x.ev),
    tomorrow: dated.filter((x) => x.day === tomorrow).map((x) => x.ev),
    rest_of_week: dated
      .filter((x) => x.day > tomorrow && x.day <= weekEnd)
      .sort((a, b) => a.day.localeCompare(b.day) || a.sort.localeCompare(b.sort))
      .map((x) => ({ id: x.ev.id, date: x.day, title: x.ev.title })),
  };
}

export type DeviceBlock = {
  id: string; kind: 'kpis' | 'chart' | 'table' | 'list' | 'text'; title: string; say: string;
  items?: Array<{ label: string; value: number | string; delta?: number; good?: boolean } | { text: string; meta?: string }>;
  chart?: 'bar' | 'line'; x?: string[]; series?: Array<{ name: string; values: number[] }>;
  columns?: string[]; rows?: Array<Array<string | number>>; text?: string;
};

/** Figures where more is worse: shown as not good when above zero. */
const WORSE_WHEN_ABOVE_ZERO = new Set(['Overdue']);

/** Key figures in the device's {label, value, good?} form. No delta yet: no history is kept to compute one. */
export function toDeviceKpis(items: Extract<BriefBlock, { type: 'kpis' }>['items']): Array<{ label: string; value: number | string; good?: boolean }> {
  return items.map((i) => ({
    label: i.label,
    value: i.value,
    ...(WORSE_WHEN_ABOVE_ZERO.has(i.label) && typeof i.value === 'number' && i.value > 0 ? { good: false } : {}),
  }));
}

/** The brief's facts as present_report blocks: every number from the server, `say` left to the model. */
export function toDeviceBlocks(facts: Pick<DayBriefFacts, 'blocks' | 'missing'>): DeviceBlock[] {
  const out: DeviceBlock[] = [];
  for (const b of facts.blocks) {
    if (b.type === 'kpis') out.push({ id: b.id, kind: 'kpis', title: b.title, say: '', items: toDeviceKpis(b.items) });
    else if (b.type === 'list') {
      out.push({
        id: b.id, kind: 'list', title: b.title, say: '',
        items: b.items.map((i) => {
          const meta = [i.time, i.secondary].filter(Boolean).join(' · ');
          return { text: i.primary, ...(meta ? { meta } : {}) };
        }),
      });
    } else if (b.type === 'table') {
      out.push({ id: b.id, kind: 'table', title: b.title, say: '', columns: b.columns, rows: b.rows.map((r) => r.map((c) => (c === null ? '' : c))) });
    } else if (b.type === 'chart') {
      out.push({ id: b.id, kind: 'chart', title: b.title, say: '', chart: b.chart, x: b.series.map((s) => s.label), series: [{ name: b.title, values: b.series.map((s) => s.value) }] });
    }
  }
  const shown = new Set<string>();
  for (const m of facts.missing) {
    if (m.status === 'loading' || shown.has(m.source)) continue;
    shown.add(m.source);
    out.push({ id: `missing_${m.source}`, kind: 'text', title: m.source, say: '', text: m.reconnect ?? 'Could not be read just now.' });
  }
  return out.slice(0, MAX_BRIEF_BLOCKS);
}

/** F-2.5: an email a rule of his has handled or prepared. Suzi lists these apart from the emails needing a reply. */
/** state on 'delegated' (F-2.4, agreed 13 Nov): sending until Gmail's receipt, then delivered; cancelled if it did not go. */
export interface PackByRule { action: 'ready' | 'ignored' | 'delegated'; rule_id: string; person_name?: string; task_id?: string | null; at: string; state?: 'sending' | 'sent' | 'bounced' | 'cancelled' | 'failed' }
/** T38 (both AGREE 18 Nov 14:33): his latest risk radar run, read only, ranked, at most 12. */
export interface PackRisk { id: string; severity: 'high' | 'medium' | 'low'; title: string; reason: string; suggested_action?: string; refs: Array<{ kind: string; id: string; label?: string }>; run_date: string }
export const PACK_RISKS_MAX = 12;

/** T38: the flags of his latest active radar run, ranked as the radar ranked them. */
export function toPackRisks(doc: { flags?: unknown; runDate?: Date | string | null } | null): PackRisk[] {
  if (!doc) return [];
  const runDate = doc.runDate ? new Date(doc.runDate).toISOString().slice(0, 10) : '';
  const flags = Array.isArray(doc.flags) ? (doc.flags as any[]) : [];
  return flags
    .filter((f) => f && f.id && f.title && ['high', 'medium', 'low'].includes(f.severity))
    .sort((a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0))
    .slice(0, PACK_RISKS_MAX)
    .map((f) => ({
      id: String(f.id), severity: f.severity, title: String(f.title).slice(0, 200), reason: String(f.reason ?? '').slice(0, 500),
      ...(f.suggestedAction ? { suggested_action: String(f.suggestedAction).slice(0, 200) } : {}),
      refs: (Array.isArray(f.sourceRefs) ? f.sourceRefs : []).slice(0, 10).map((r: any) => ({ kind: String(r?.kind ?? ''), id: String(r?.id ?? ''), ...(r?.label ? { label: String(r.label).slice(0, 120) } : {}) })),
      run_date: runDate,
    }));
}

export interface PackEmail { to?: string[]; cc?: string[]; summary?: string; point?: string; task_id?: string; event_id?: string; thread_id: string; from: string; subject: string; preview: string; received_at: string; urgency: string; replied_at?: string | null; reply_checked?: boolean; by_rule?: PackByRule }

/** Mail snippets arrive HTML-escaped ("&lt;vm@tmcltd.com&gt;"); Suzi shows and speaks plain text. */
function decodeEntities(t: string): string {
  return t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/** One attention item as a pack email. Never a body: the preview is cut at 200 characters. */
export function toPackEmail(i: { threadId?: string | null; feedEventId: string; fromDisplay?: string; from: string; subject: string; preview?: string; receivedAt: string; critical?: boolean; criticality?: { band?: string } | null; rationale?: string | null; suggestedAction?: string | null; suggestedDelegateeName?: string | null }, tz: string): PackEmail {
  const received = new Date(i.receivedAt);
  return {
    thread_id: i.threadId ?? i.feedEventId,
    from: i.fromDisplay || i.from,
    subject: (i.subject || '(no subject)').slice(0, 200),
    preview: decodeEntities(String(i.preview ?? '')).replace(/\s+/g, ' ').trim().slice(0, EMAIL_PREVIEW_MAX),
    received_at: isNaN(received.getTime()) ? String(i.receivedAt) : toZonedIso(received, tz),
    urgency: i.criticality?.band ?? (i.critical ? 'critical' : 'normal'),
    ...emailGist(i),
  };
}

/** DEF-459 (Suzi Master AGREE 13 Nov): an email that needs nothing from him but he should know. Never a body. */
export interface PackFyi { email_id: string; thread_id: string; from: string; subject: string; kind: string; why: string; point: string; urgency: string; received_at: string; preview: string;
  /** D-326 (Suzi 26 Nov 10:51, T49): the same facts as emails[], so Suzi reads no thread to answer "was it sent to me?". */
  to?: string[]; cc?: string[]; to_me?: 'to' | 'cc' | 'group'; replied_at?: string | null; reply_checked?: boolean; by_rule?: PackByRule }
export const PACK_FYI_MAX = 10;

export function toPackFyi(i: { feedEventId: string; threadId?: string | null; fromDisplay?: string; from: string; subject: string; preview?: string; receivedAt: string; critical?: boolean; criticality?: { band?: string } | null; forYourKnowledge?: { kind: string; why: string } | null }, tz: string): PackFyi {
  const e = toPackEmail(i as any, tz);
  const why = i.forYourKnowledge?.why ?? '';
  const band = i.criticality?.band;
  return {
    email_id: i.feedEventId, thread_id: e.thread_id, from: e.from, subject: e.subject,
    kind: i.forYourKnowledge?.kind ?? 'escalation', why, point: why,
    urgency: band === 'critical' || i.critical ? 'critical' : band === 'high' ? 'high' : 'normal',
    received_at: e.received_at, preview: e.preview,
  };
}

/**
 * D-326: the facts on each FYI and what leaves the list. An FYI he has answered is not FYI any more (out, counted
 * `answered`); one his ignore rule covers is out (counted `ignored`), the vm@ "sent to" rule included; a delegate rule
 * marks it ready. `to_me`: his address in To → "to", in Cc → "cc", in neither (a group address) → "group".
 */
export function fyiWithFacts(
  items: Array<{ fyi: PackFyi; address: string }>,
  f: { recips: Map<string, { to: string[]; cc: string[] }>; replies: Map<string, { replied_at: string | null; reply_checked: boolean }>; own: Set<string>;
       ruleOf: (e: { from: string; subject: string; to?: string[]; cc?: string[] }) => { kind: string; id: string; person_name?: string | null } | null; at: string; autoForward: boolean },
): { fyi: PackFyi[]; ignored: number; answered: number } {
  const out: PackFyi[] = [];
  let ignored = 0; let answered = 0;
  for (const { fyi, address } of items) {
    const rc = f.recips.get(fyi.email_id);
    const rp = f.replies.get(fyi.thread_id);
    if (rp?.replied_at) { answered += 1; continue; }
    const r = f.ruleOf({ from: address, subject: fyi.subject, to: rc?.to, cc: rc?.cc });
    if (r && r.kind !== 'email_delegate') { ignored += 1; continue; }
    const has = (l?: string[]) => (l ?? []).some((a) => f.own.has(a.toLowerCase()));
    out.push({
      ...fyi,
      ...(rc ? { to: rc.to, cc: rc.cc, to_me: has(rc.to) ? 'to' as const : has(rc.cc) ? 'cc' as const : 'group' as const } : {}),
      ...(rp ? { replied_at: null, reply_checked: rp.reply_checked } : {}),
      ...(r && !f.autoForward ? { by_rule: { action: 'ready' as const, rule_id: r.id, ...(r.person_name ? { person_name: r.person_name } : {}), at: f.at } } : {}),
    });
  }
  return { fyi: out, ignored, answered };
}

export interface DayPack {
  version: number; generated_at: string; cursor: string; tz: string; date: string;
  calendar: PackCalendar; actions: SuziAction[]; emails: PackEmail[]; emails_hidden?: { ignored: number; tasked: number; calendar?: number; answered?: number }; emails_loading: boolean;
  risks?: PackRisk[];
  /** D-323 (T47): suggestions on tasks not in actions[] (tasks he is watching). Absent = none. */
  proposals?: import('./proposals').PackLevelProposal[];
  /** Link T41: the computer operator's control. Left out when it cannot be read; the desktop then keeps its last copy. */
  operator?: import('./suziOperator').PackOperator;
  /** D-328 (T48): the one current picture: new to him, done, to do (ranked), advice. Absent = could not be built. */
  situation?: import('./situation').Situation;
  /** D-329 (T49 B1): the advisor's weekly review, at most 5 items. Absent = none this week. */
  review?: import('./advisor').PackReview;
  /** D-333 (T52): what Nexeo thinks is ahead: important, pending, risks now, risks ahead (predictions), forecast. Absent = none yet. */
  outlook?: import('./outlook').Outlook;
  /** D-329 (T49 B3): counted results, this week so far and last week. Absent = could not be read. */
  scorecard?: { this_week: import('./advisor').Scorecard; last_week: import('./advisor').Scorecard };
  /** D-330 (T50): his scheduled jobs. Absent = could not be read. */
  jobs?: import('./scheduledJobs').PackJob[];
  /** D-327 (T49): his past decisions, newest 50. Absent = could not be read. */
  decisions?: import('./decisions').PackDecision[];
  /** DEF-459: for your knowledge, newest first, at most 10. Absent = nothing to say. */
  fyi?: PackFyi[];
  kpis: ReturnType<typeof toDeviceKpis>; brief: { blocks: DeviceBlock[] }; missing: DayBriefFacts['missing'];
  rules_version?: number; rules?: SuziRules; rules_md?: string; people?: SuziPerson[];
  /** F-4.7 Q1 (Nexeo AGREE 13 Nov): his own Meeting Assistant switch. Absent = could not be read. */
  meeting_assistant?: { on: boolean; status_push?: true };
  /** F-4.8 slice 2 (agreed 13 Nov; 7 days and updated_at, 14 Nov): his meeting records. Absent = could not be read. */
  meetings_recorded?: RecordedMeeting[];
  /** W-1: "How to work with <user>", his own facts learned by Suzi (key -> value). Absent = none yet. */
  profile?: Record<string, unknown>;
}

/** Link T12, approved by the founder 5 Nov. The desktop app builds ahead, so a field in the pack is a live feature. */
export const PHASE2_IN_PACK = true;

/** What can't be read stays out and the desktop keeps its last copy, which only ever makes it stricter. */
export async function phase2Fields(clientNumber: string, userId: number): Promise<Partial<RulesDocument> & { people?: SuziPerson[] }> {
  const [rules, people] = await Promise.all([
    rulesDocument(clientNumber, userId).catch(() => null),
    recentPeople(clientNumber, userId).catch(() => null),
  ]);
  return { ...(rules ?? {}), ...(people ? { people } : {}) };
}

/** Prep notes already written for upcoming meetings, by calendar event id. */
async function prepNotes(clientNumber: string, userId: number): Promise<Map<string, string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ event_id: string; question: string }>>(
    `SELECT DISTINCT ON (metadata->>'eventId') metadata->>'eventId' AS event_id, question
       FROM brain_prompt_queue
      WHERE client_number = $1 AND user_id = $2 AND metadata->>'source' = 'preactive_meeting_prep'
        AND queued_at > now() - interval '2 days'
      ORDER BY metadata->>'eventId', queued_at DESC`,
    clientNumber, userId,
  ).catch(() => [] as Array<{ event_id: string; question: string }>);
  return new Map(rows.map((r) => [r.event_id, r.question]));
}

/**
 * F-2.5: his Suzi email rules applied to the list. A delegate rule marks the email "ready" (nothing is sent until
 * his one signed yes); an ignore rule marks it "ignored". Emails delegated by a rule in the last day are added as
 * "delegated". Rules that can't be read leave the list as it was.
 */
async function withRules(clientNumber: string, userId: number, items: Array<{ email: PackEmail; address: string; feedEventId?: string }>, now: Date, tz: string): Promise<PackEmail[]> {
  const { suziEmailRules, ruleFor, delegatedByRule } = await import('./suziEmailRules');
  // Suzi 25 Nov 15:17: to[] and cc[] on each email (addresses), so he can make rules on mail sent to a group address.
  const recips = await recipientsOf(clientNumber, items.map((i) => i.feedEventId).filter(Boolean) as string[]).catch(() => new Map<string, { to: string[]; cc: string[] }>());
  const rules = await suziEmailRules(clientNumber, userId).catch(() => []);
  const at = toZonedIso(now, tz);
  const autoForward = (await import('../../jobs/ruleForwardJob')).RULE_FORWARD_ENABLED;
  const out = items.map(({ email: e0, address, feedEventId }) => {
    const rc = feedEventId ? recips.get(feedEventId) : undefined;
    const email: PackEmail = rc ? { ...e0, to: rc.to, cc: rc.cc } : e0;
    const r = rules.length ? ruleFor(rules, { from: address, subject: email.subject, to: rc?.to, cc: rc?.cc }) : null;
    if (!r) return email;
    // F-2.4 (founder 13 Nov): delegate rules act by themselves, so nothing is held "ready"; the forward shows as a
    // "delegated" row once it has gone (delegatedByRule below).
    if (r.kind === 'email_delegate' && autoForward) return email;
    return { ...email, by_rule: { action: r.kind === 'email_delegate' ? 'ready' as const : 'ignored' as const, rule_id: r.id, ...(r.person_name ? { person_name: r.person_name } : {}), at } };
  });
  const shown = new Set(out.map((e) => e.thread_id));
  const done = await delegatedByRule(clientNumber, userId, new Date(now.getTime() - 24 * 3600_000));
  for (const d of done) {
    if (shown.has(d.thread_id)) continue;
    shown.add(d.thread_id);
    out.push({ thread_id: d.thread_id, from: '', subject: d.subject.slice(0, 200), preview: '', received_at: d.at, urgency: 'normal', by_rule: { action: 'delegated', rule_id: d.rule_id, person_name: d.person_name, task_id: d.task_id, at: d.at, ...(d.state ? { state: d.state } : {}) } });
  }
  return out;
}

/**
 * DEF-509 (both AGREE 18 Nov, T37): an email he has dealt with leaves `emails`, counted in `emails_hidden`: ignored by
 * his rule, or its thread has an open task (his, or handed on). A new message in the thread after the task brings it
 * back, carrying `task_id` (T33 P4: a reply on a task's thread is shown on the task). Rule-delegated rows stay (F-2.5).
 */
export function leaveHandled(
  emails: PackEmail[], tasks: Map<string, { id: string; since: string }>,
  notices: NoticeLinks['threads'] = new Map(), now: Date = new Date(),
): { emails: PackEmail[]; emails_hidden: { ignored: number; tasked: number; calendar: number } } {
  const hidden = { ignored: 0, tasked: 0, calendar: 0 };
  const out: PackEmail[] = [];
  for (const e of emails) {
    if (e.by_rule?.action === 'ignored') { hidden.ignored += 1; continue; }
    // T34: a calendar notice placed on its event leaves; a proposed new time for a meeting still ahead stays.
    const n = notices.get(e.thread_id);
    if (n) {
      const ahead = !!n.start && Date.parse(n.start) > now.getTime();
      if (n.kind === 'proposed_time' && ahead) { out.push({ ...e, event_id: n.event_id }); continue; }
      hidden.calendar += 1; continue;
    }
    const t = e.by_rule?.action === 'delegated' ? undefined : tasks.get(e.thread_id);
    if (t) {
      const newer = Date.parse(e.received_at) > Date.parse(t.since);
      if (!newer) { hidden.tasked += 1; continue; }
      out.push({ ...e, task_id: t.id });
      continue;
    }
    out.push(e);
  }
  return { emails: out, emails_hidden: hidden };
}

/** T34: today's and tomorrow's events carry their notices (rest_of_week stays a short list). */
export function withUpdates(cal: PackCalendar, notices: NoticeLinks): PackCalendar {
  const add = (e: PackEvent): PackEvent => { const u = notices.updates.get(e.id); return u?.length ? { ...e, updates: u } : e; };
  return { ...cal, today: cal.today.map(add), tomorrow: cal.tomorrow.map(add) };
}

/** Thread → its open task and since when (the card's task from cardTruth, or a task email's linked thread). */
async function taskOfThread(clientNumber: string, userId: number, cards: any[]): Promise<Map<string, { id: string; since: string }>> {
  const out = new Map<string, { id: string; since: string }>();
  const linked = await import('./suziTaskTrail').then(({ threadTaskLinks }) => threadTaskLinks(clientNumber, userId)).catch(() => new Map<string, { id: string; since: string }>());
  for (const [k, v] of linked) out.set(k, v);
  for (const c of cards) {
    const thread = c?.threadId ?? c?.feedEventId;
    if (thread && c?.openItem?.id && !out.has(thread)) out.set(thread, { id: c.openItem.id, since: c.openItem.createdAt ?? new Date(0).toISOString() });
  }
  return out;
}

export async function buildDayPack(clientNumber: string, userId: number, opts: { timezone?: string; now?: Date; phase2?: boolean } = {}): Promise<DayPack> {
  const tz = safeTimezone(opts.timezone);
  const now = opts.now ?? new Date();
  const today = localDate(now, tz);

  const t0 = Date.now();
  const times: Record<string, number | string> = {};
  const facts = await timed(times, 'brief', () => buildDayBriefFacts(clientNumber, userId, { timezone: tz, now }));

  let events: RawPackEvent[] = [];
  // DEF-500 (16 Nov): his live Google Calendar first. The synced copy (feed_events) never learns of a cancel, so a
  // meeting he cancelled stayed in the pack and Suzi tried to cancel it again ("not_found"). Feed copy = fallback only.
  const live = facts.sources.calendar ? await capped(times, 'calendar', () => livePackEvents(userId, today), null) : null;
  if (live) events = live;
  else if (facts.sources.calendar) {
    const rows = await prisma.$queryRawUnsafe<Array<{ p: RawPackEvent }>>(
      `SELECT raw_payload AS p FROM feed_events
        WHERE client_number = $1 AND user_id = $2
          AND source_type IN ('gcal', 'outlook_calendar')
          AND (raw_payload->>'start') >= $3 AND (raw_payload->>'start') < $4
        ORDER BY created_at DESC`,
      clientNumber, userId, addDays(today, -1), addDays(endOfWeek(today), 2),
    ).catch(() => [] as Array<{ p: RawPackEvent }>);
    events = rows.map((r) => r.p);
  }
  const prep = events.length ? await prepNotes(clientNumber, userId) : new Map<string, string>();
  // Slice 2: attendee names from his contacts and his own addresses. A read that fails gives readable names only.
  const addrs = events.flatMap((e) => (Array.isArray(e.attendees) ? e.attendees : []).map((a: any) => String(a?.email ?? a ?? '')));
  const people = await packPeople(clientNumber, userId, addrs).catch(() => ({ own: new Set<string>(), names: new Map<string, string>() }));
  // T34: his calendar notices placed on their events (a read that fails places nothing).
  const notices = await noticeLinks(clientNumber, userId, events, tz, people.names, people.own, now).catch((): NoticeLinks => ({ updates: new Map(), threads: new Map() }));

  const { actions } = await timed(times, 'actions', () => listPendingActions(clientNumber, userId, { limit: 500, timezone: tz, now }));
  // D-323 (T47): a read that fails leaves the list out, never the pack.
  const levelProposals = await import('./proposals').then((m) => m.packLevelProposals(clientNumber, userId, new Set(actions.map((a) => a.id)))).catch(() => []);
  // The brief already waited up to the cap on this same list; a second wait would double it.
  const stillLoading = facts.missing.some((m) => m.source === 'email' && m.status === 'loading');
  const attention: Awaited<ReturnType<typeof loadAttentionEmails>> = !facts.sources.email ? { items: [], loading: false, fyi: [] }
    : stillLoading ? { items: [], loading: true, fyi: [] }
    : await capped(times, 'emails', () => loadAttentionEmails(clientNumber, userId), { items: [], loading: true, fyi: [] }, ATTENTION_CAP_MS);
  const kpiBlock = facts.blocks.find((b): b is Extract<BriefBlock, { type: 'kpis' }> => b.type === 'kpis');

  const opt = <T>(name: string, work: () => Promise<T>) => capped(times, name, work, {} as T);
  const [phase2, drafts, meeting, recorded, profile, risks, operator, decisions, advisorParts, jobs] = await Promise.all([
    (opts.phase2 ?? PHASE2_IN_PACK) ? opt('phase2', () => phase2Fields(clientNumber, userId)) : Promise.resolve({}),
    // T32 (both AGREE 17 Nov): how many drafts wait (Suzi's and his own Gmail drafts); left out when Gmail is unreadable.
    opt('drafts', () => import('./suziDrafts').then(({ draftsCount }) => draftsCount(clientNumber, userId)).then((n) => (n === null ? {} : { drafts_count: n })).catch(() => ({}))),
    opt('meeting', () => import('../meetings/meetingSwitch').then(({ isOn }) => isOn(userId)).then(async (on) => ({ meeting_assistant: { on, ...((await import('../meetings/meetingRecordStore')).PUSH_STATUS.on ? { status_push: true as const } : {}) } })).catch(() => ({}))),
    opt('recorded', () => meetingsRecorded(clientNumber, userId, now, tz).then((m) => ({ meetings_recorded: m })).catch(() => ({}))),
    // Suzi 25 Nov 15:36: his own address as profile.email, so Suzi never guesses which address is his.
    opt('profile', () => Promise.all([
      import('./suziW1').then(({ profileOf }) => profileOf(clientNumber, userId)).catch(() => null),
      prisma.user.findFirst({ where: { id: userId, clientNumber } as any, select: { email: true } as any }).then((u: any) => (typeof u?.email === 'string' ? u.email.toLowerCase() : null)).catch(() => null),
    ]).then(([p, email]) => (p || email ? { profile: { ...(p ?? {}), ...(email ? { email } : {}) } } : {}))),
    // T38: a radar that can't be read leaves `risks` out (never an empty list that says "no risks").
    opt('risks', () => import('../brain/riskRadarService').then(({ getLatestForUser }) => getLatestForUser(clientNumber, userId)).then((d: any) => ({ risks: toPackRisks(d) })).catch(() => ({}))),
    // T41 (both AGREE 18 Nov): consent, his permissions, limits and this month's use for the computer operator.
    opt('operator', () => import('./suziOperator').then(({ packOperator }) => packOperator(clientNumber, userId, now)).then((o) => ({ operator: o })).catch(() => ({}))),
    // D-327: a read that fails leaves `decisions` out, so Suzi keeps her last copy.
    opt('decisions', () => import('./decisions').then(({ packDecisions }) => packDecisions(clientNumber, userId, tz)).then((d) => ({ decisions: d })).catch(() => ({}))),
    // D-328/D-329: the advisor's stored advice, review and scorecard, and when he last looked. Each read stands alone.
    opt('advisor', async () => {
      const A = await import('./advisor');
      const outlook = await import('./outlook').then((m) => m.packOutlook(clientNumber, userId, now)).catch(() => null);
      const [advice, review, scorecard, seen] = await Promise.all([
        A.packAdvice(clientNumber, userId).catch(() => null),
        A.packReview(clientNumber, userId, now).catch(() => null),
        A.packScorecard(clientNumber, userId, now).catch(() => null),
        prisma.$queryRawUnsafe<Array<{ at: string | null }>>(
          `SELECT result->'item'->>'at' AS at FROM suzi_act_log WHERE client_number = $1 AND user_id = $2 AND op = 'seen.update' AND status = 'ok' ORDER BY created_at DESC LIMIT 1`,
          clientNumber, userId,
        ).then((r) => r[0]?.at ?? null).catch(() => null),
      ]);
      return { advice, review, scorecard, seen, outlook };
    }),
    opt('jobs', () => import('./scheduledJobs').then((m) => m.packJobs(clientNumber, userId, now, tz)).then((j) => ({ jobs: j })).catch(() => ({}))),
  ]);
  const attendFor = await capped(times, 'attend', () => attendOfFor(clientNumber, userId), undefined);
  const withRulesOut = await withRules(clientNumber, userId, attention.items.map((i) => ({ email: { ...toPackEmail(i, tz), replied_at: i.reply.replied_at, reply_checked: i.reply.reply_checked }, address: (i as any).fromEmail ?? i.from, feedEventId: i.feedEventId })), now, tz);
  const threadTasks = await taskOfThread(clientNumber, userId, attention.items);
  // D-326: a read that fails leaves the FYI list as it was, without the new facts.
  const plainFyi = attention.fyi.slice(0, PACK_FYI_MAX * 2).map((i) => ({ fyi: toPackFyi(i, tz), address: String((i as any).fromEmail ?? i.from ?? '') }));
  const fyiOut = plainFyi.length
    ? await capped(times, 'fyi', async () => {
        const [recips, replies, rules] = await Promise.all([
          recipientsOf(clientNumber, plainFyi.map((x) => x.fyi.email_id)).catch(() => new Map<string, { to: string[]; cc: string[] }>()),
          import('./suziReplied').then((m) => m.replyStates(userId, plainFyi.map((x) => x.fyi.thread_id))).catch(() => new Map()),
          import('./suziEmailRules').then((m) => m.suziEmailRules(clientNumber, userId).then((rs) => ({ rs, ruleFor: m.ruleFor }))).catch(() => null),
        ]);
        return fyiWithFacts(plainFyi, {
          recips, replies: replies as any, own: people.own, at: toZonedIso(now, tz),
          ruleOf: (e) => (rules && rules.rs.length ? rules.ruleFor(rules.rs, e) as any : null),
          autoForward: (await import('../../jobs/ruleForwardJob')).RULE_FORWARD_ENABLED,
        });
      }, { fyi: plainFyi.map((x) => x.fyi), ignored: 0, answered: 0 })
    : { fyi: [] as PackFyi[], ignored: 0, answered: 0 };
  const handled = leaveHandled(withRulesOut, threadTasks, notices.threads, now);
  // D-328: one picture from the parts above. Anything that throws leaves `situation` out, never the pack.
  const ap = advisorParts as { advice?: { advice: any[]; goals: Map<string, string> } | null; review?: any; scorecard?: any; seen?: string | null; outlook?: import('./outlook').Outlook | null };
  const jobList = ((jobs as any).jobs ?? []) as import('./scheduledJobs').PackJob[];
  let situation: import('./situation').Situation | null = null;
  try {
    const { buildSituation } = await import('./situation');
    const seenMs = Date.parse(String(ap.seen ?? ''));
    situation = buildSituation({
      now, asOf: toZonedIso(now, tz), today, seenAt: Number.isFinite(seenMs) ? new Date(seenMs) : null,
      actions, emails: handled.emails, fyi: fyiOut.fyi, proposals: levelProposals, recorded: ((recorded as any).meetings_recorded ?? []) as any,
      decisions: ((decisions as any).decisions ?? []) as any, advice: ap.advice?.advice ?? [], goals: ap.advice?.goals,
      jobs: jobList.filter((j) => j.last?.summary && j.runs_on === 'nexeo').map((j) => ({ at: j.last!.at, job_id: j.id, what: j.last!.summary })),
    });
  } catch (e: any) { log.warn('situation not built', { userId, error: String(e?.message ?? e).slice(0, 200) }); }
  const total = Date.now() - t0;
  (total > PACK_SLOW_MS ? log.warn : log.info).call(log, total > PACK_SLOW_MS ? 'day pack slow' : 'day pack timed', { userId, totalMs: total, parts: times });

  return {
    version: DAY_PACK_VERSION,
    generated_at: toZonedIso(now, tz),
    cursor: now.toISOString(),
    tz,
    date: today,
    calendar: withUpdates(packCalendar(events, today, tz, prep, people, attendFor), notices),
    actions,
    ...(levelProposals.length ? { proposals: levelProposals } : {}),
    // T23: answered threads are already left out, so replied_at is null here; reply_checked says whether Gmail was asked.
    emails: handled.emails,
    emails_hidden: { ...handled.emails_hidden, ignored: handled.emails_hidden.ignored + fyiOut.ignored, answered: fyiOut.answered },
    emails_loading: attention.loading,
    ...(fyiOut.fyi.length ? { fyi: fyiOut.fyi.slice(0, PACK_FYI_MAX) } : {}),
    kpis: toDeviceKpis(kpiBlock?.items ?? []),
    brief: { blocks: toDeviceBlocks(facts) },
    missing: facts.missing,
    ...phase2, ...drafts, ...meeting, ...recorded, ...profile, ...risks, ...operator, ...decisions, ...jobs,
    ...(situation ? { situation } : {}),
    ...(ap.review ? { review: ap.review } : {}),
    ...(ap.scorecard ? { scorecard: ap.scorecard } : {}),
    ...(ap.outlook ? { outlook: ap.outlook } : {}),
  };
}

/**
 * F-4.2 per-event attend (charter, agreed 13 Nov; sent since Way A can switch transcription on, 16 Nov): only on his
 * hosted Meets, only while his Meeting Assistant switch is on. always = the space is really on (his single choice, or
 * an always rule already applied by the meet poll); never = a never rule; otherwise ask. Undefined when off or unread.
 */
export async function attendOfFor(clientNumber: string, userId: number): Promise<AttendOf | undefined> {
  try {
    const { isOn } = await import('../meetings/meetingSwitch');
    if (!(await isOn(userId))) return undefined;
    const { meetingAttendRules } = await import('./suziMeetingRules');
    const { chosenEvents } = await import('../meetings/meetAttend');
    const { meetingCodeOf } = await import('../meetings/meetTranscripts');
    const [rules, chosen] = await Promise.all([meetingAttendRules(clientNumber, userId), chosenEvents(clientNumber, userId)]);
    return attendOf(rules, chosen, meetingCodeOf);
  } catch { return undefined; }
}

export function attendOf(rules: MeetingAttendRule[], chosen: Map<string, 'always' | 'never'>, codeOf: (l?: string | null) => string | null): AttendOf {
  return (e, id, organizerSelf, link) => {
    if (!organizerSelf || !codeOf(link)) return undefined;
    const d = meetingAttendFor(rules, { title: e.title, organizer: addrOf(e.organizer), attendees: (e.attendees ?? []).map(addrOf), hasJoinLink: true });
    const choice = chosen.get(id); // his single-meeting choice beats both rules
    if (choice === 'never') return { decision: 'never' };
    if (choice === 'always') return { decision: 'always', ...(d.decision === 'always' && d.rule_id ? { rule_id: d.rule_id } : {}) };
    if (d.decision === 'never') return { decision: 'never', ...(d.rule_id ? { rule_id: d.rule_id } : {}) };
    return { decision: 'ask' };
  };
}

/** His live Google Calendar for the pack's window (yesterday to two days past the week's end), or null when it cannot
 *  be read (not Google, not connected, an API error): the caller then uses the synced copy. */
export async function livePackEvents(
  userId: number, today: string,
  read: (u: number, a: Date, b: Date, n: number) => Promise<{ events: any[]; error?: string }> = async (u, a, b, n) => (await import('../calendarService')).getEvents(u, a, b, n),
): Promise<RawPackEvent[] | null> {
  const DAY = 24 * 3600_000;
  const from = new Date(Date.parse(`${addDays(today, -1)}T00:00:00Z`) - 14 * 3600_000);
  const to = new Date(Date.parse(`${addDays(endOfWeek(today), 2)}T00:00:00Z`) + 14 * 3600_000);
  if (!(to.getTime() - from.getTime() < 21 * DAY)) return null;
  const r = await read(userId, from, to, 250).catch(() => ({ events: [], error: 'read failed' }));
  if (r.error) return null;
  return r.events.filter((e) => e.status !== 'cancelled').map((e) => ({
    eventId: e.id, title: e.title, start: e.start, end: e.end, isAllDay: e.isAllDay, attendees: e.attendees,
    organizer: e.organizer, link: e.link ?? null, location: e.location ?? null, status: e.status,
  }));
}

/** Addresses in a To/Cc header ("A <a@x>, b@y"), lower-case, at most 50. */
export function addressesIn(header: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of String(header ?? '').matchAll(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g)) {
    const a = m[0].toLowerCase();
    if (!out.includes(a)) out.push(a);
    if (out.length >= 50) break;
  }
  return out;
}

async function recipientsOf(clientNumber: string, feedIds: string[]): Promise<Map<string, { to: string[]; cc: string[] }>> {
  const out = new Map<string, { to: string[]; cc: string[] }>();
  if (!feedIds.length) return out;
  // The id is a feed row id, or (emails read from the Wiki) the Gmail message id: both are looked up, the feed first,
  // then the Wiki's own copy of the email.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; sid: string | null; to: string | null; cc: string | null }>>(
    `SELECT id, source_id AS sid, raw_payload->>'to' AS to, raw_payload->>'cc' AS cc FROM feed_events
      WHERE client_number = $1 AND (id = ANY($2::text[]) OR source_id = ANY($2::text[]))`,
    clientNumber, feedIds,
  );
  for (const r of rows) {
    const v = { to: addressesIn(r.to), cc: addressesIn(r.cc) };
    if (feedIds.includes(r.id)) out.set(r.id, v);
    if (r.sid && feedIds.includes(r.sid)) out.set(r.sid, v);
  }
  const missing = feedIds.filter((f) => !out.has(f));
  if (missing.length) {
    const w = await prisma.$queryRawUnsafe<Array<{ ext: string; to: string | null; cc: string | null }>>(
      `SELECT external_id AS ext, details->>'to' AS to, details->>'cc' AS cc FROM wiki_sources
        WHERE client_number = $1 AND kind = 'email' AND external_id = ANY($2::text[])`,
      clientNumber, missing,
    ).catch(() => []);
    for (const r of w) out.set(r.ext, { to: addressesIn(r.to), cc: addressesIn(r.cc) });
  }
  return out;
}
