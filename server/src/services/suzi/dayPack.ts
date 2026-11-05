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
import { rulesDocument, type RulesDocument, type SuziRules } from './suziRules';
import { recentPeople, type SuziPerson } from './suziPeople';
import prisma from '../../db/prisma';
import { buildDayBriefFacts, loadAttentionEmails, localDate, safeTimezone, type BriefBlock, type DayBriefFacts } from './dayBriefFacts';
import { listPendingActions, type SuziAction } from './suziActions';
import { toZonedIso } from './zonedTime';

export const DAY_PACK_VERSION = 1;
export const EMAIL_PREVIEW_MAX = 200;
export const MAX_BRIEF_BLOCKS = 8;

export interface RawPackEvent {
  eventId?: string; id?: string; title?: string; start?: string; end?: string; isAllDay?: boolean;
  attendees?: unknown[]; location?: string | null; link?: string | null; hangoutLink?: string | null; status?: string;
}
export interface PackEvent {
  id: string; start: string; end: string | null; all_day: boolean; title: string;
  attendees: string[]; location: string | null; link: string | null; prep_notes: string | null;
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
export function packCalendar(events: RawPackEvent[], today: string, tz: string, prep: Map<string, string> = new Map()): PackCalendar {
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
    dated.push({
      day,
      sort: allDay ? '0' : `1${start!.toISOString()}`,
      ev: {
        id,
        start: dateOnly ? e.start : toZonedIso(start!, tz),
        end,
        all_day: allDay,
        title: String(e.title || '(no title)').slice(0, 200),
        attendees: Array.isArray(e.attendees) ? e.attendees.map((a: any) => String(a?.email ?? a)).slice(0, 50) : [],
        location: e.location ?? null,
        link: e.hangoutLink ?? e.link ?? null,
        prep_notes: prep.get(id) ?? null,
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

export interface PackEmail { thread_id: string; from: string; subject: string; preview: string; received_at: string; urgency: string }

/** Mail snippets arrive HTML-escaped ("&lt;vm@tmcltd.com&gt;"); Suzi shows and speaks plain text. */
function decodeEntities(t: string): string {
  return t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/** One attention item as a pack email. Never a body: the preview is cut at 200 characters. */
export function toPackEmail(i: { threadId?: string | null; feedEventId: string; fromDisplay?: string; from: string; subject: string; preview?: string; receivedAt: string; critical?: boolean; criticality?: { band?: string } | null }, tz: string): PackEmail {
  const received = new Date(i.receivedAt);
  return {
    thread_id: i.threadId ?? i.feedEventId,
    from: i.fromDisplay || i.from,
    subject: (i.subject || '(no subject)').slice(0, 200),
    preview: decodeEntities(String(i.preview ?? '')).replace(/\s+/g, ' ').trim().slice(0, EMAIL_PREVIEW_MAX),
    received_at: isNaN(received.getTime()) ? String(i.receivedAt) : toZonedIso(received, tz),
    urgency: i.criticality?.band ?? (i.critical ? 'critical' : 'normal'),
  };
}

export interface DayPack {
  version: number; generated_at: string; cursor: string; tz: string; date: string;
  calendar: PackCalendar; actions: SuziAction[]; emails: PackEmail[]; emails_loading: boolean;
  kpis: ReturnType<typeof toDeviceKpis>; brief: { blocks: DeviceBlock[] }; missing: DayBriefFacts['missing'];
  rules_version?: number; rules?: SuziRules; rules_md?: string; people?: SuziPerson[];
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

export async function buildDayPack(clientNumber: string, userId: number, opts: { timezone?: string; now?: Date; phase2?: boolean } = {}): Promise<DayPack> {
  const tz = safeTimezone(opts.timezone);
  const now = opts.now ?? new Date();
  const today = localDate(now, tz);

  const facts = await buildDayBriefFacts(clientNumber, userId, { timezone: tz, now });

  let events: RawPackEvent[] = [];
  if (facts.sources.calendar) {
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

  const { actions } = await listPendingActions(clientNumber, userId, { limit: 500, timezone: tz, now });
  // The brief already waited up to the cap on this same list; a second wait would double it.
  const stillLoading = facts.missing.some((m) => m.source === 'email' && m.status === 'loading');
  const attention = !facts.sources.email ? { items: [], loading: false }
    : stillLoading ? { items: [], loading: true }
    : await loadAttentionEmails(clientNumber, userId);
  const kpiBlock = facts.blocks.find((b): b is Extract<BriefBlock, { type: 'kpis' }> => b.type === 'kpis');

  return {
    version: DAY_PACK_VERSION,
    generated_at: toZonedIso(now, tz),
    cursor: now.toISOString(),
    tz,
    date: today,
    calendar: packCalendar(events, today, tz, prep),
    actions,
    emails: attention.items.map((i) => toPackEmail(i, tz)),
    emails_loading: attention.loading,
    kpis: toDeviceKpis(kpiBlock?.items ?? []),
    brief: { blocks: toDeviceBlocks(facts) },
    missing: facts.missing,
    ...((opts.phase2 ?? PHASE2_IN_PACK) ? await phase2Fields(clientNumber, userId) : {}),
  };
}
