/**
 * DEF-385 — the day brief as FACTS for Suzi to present.
 *
 * Owner on Suzi, 2026-11-03 12:47 PKT: "Brief my day" → "I can't access your
 * calendar right now". His Google Calendar was connected in Nexeo; Suzi's
 * calendar tool was a stub. This is Nexeo's half of the fix. Suzi's server
 * asks for the brief and gets it back as present_report-shaped blocks:
 *
 *   kpis  — key figures (business KPIs from Integrations, then today's counts)
 *   list  — today's meetings
 *   table — pending actions (Action Center)
 *   list  — emails needing a reply
 *   chart — pending actions by priority
 *
 * There is no wording here. No `say` line, no greeting, no summary sentence.
 * Suzi's model writes those in the user's language (owner rule: replies always
 * through the model). Every block says whether its source is connected, so a
 * missing calendar is reported as missing, never as an empty day.
 */
import { emailGist } from './emailGist';
import prisma from '../../db/prisma';

export type BriefBlock =
  | { type: 'kpis'; id: string; title: string; items: Array<{ label: string; value: number | string; unit?: string; note?: string }> }
  | { type: 'list'; id: string; title: string; connected: boolean; loading?: boolean; items: Array<{ detail?: string; primary: string; secondary?: string; time?: string }> }
  | { type: 'table'; id: string; title: string; columns: string[]; rows: Array<Array<string | number | null>> }
  | { type: 'chart'; id: string; title: string; chart: 'bar'; series: Array<{ label: string; value: number }> };

export interface DayBriefFacts {
  date: string;        // YYYY-MM-DD in the user's timezone
  timezone: string;
  generatedAt: string;
  sources: { calendar: boolean; email: boolean; businessKpis: boolean };
  /** Sources the brief could not use, and how the user can reconnect them. Facts, not wording. */
  missing: Array<{ source: 'calendar' | 'email' | 'actions'; status: 'not_connected' | 'expired' | 'error' | 'loading'; reconnect?: string }>;
  blocks: BriefBlock[];
}

const RECONNECT = {
  calendar: 'Nexeo web → Connectors → Google Calendar (or Outlook Calendar) → Connect',
  email: 'Nexeo web → Connectors → Gmail (or Outlook) → Connect',
} as const;

export const ATTENTION_TIMEOUT_MS = 8000;
const OPEN = ['NEW', 'TRIAGED', 'IN_PROGRESS', 'WAITING_INFO', 'DELEGATED'];
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** A real IANA zone, or the default. Never throws. */
export function safeTimezone(tz: unknown, fallback = 'Asia/Karachi'): string {
  if (typeof tz !== 'string' || !tz) return fallback;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return fallback; }
}

/** YYYY-MM-DD of `d` in `tz`. */
export function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** HH:MM of `d` in `tz`. */
function localTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export interface RawCalEvent { eventId?: string; title?: string; start?: string; end?: string; isAllDay?: boolean; attendees?: unknown[] }

/**
 * Today's meetings from synced calendar events: dedup by eventId (the poller can store an
 * event twice), keep the ones that fall on `day` in `tz`, all-day first, then by start.
 */
export function meetingsForDay(events: RawCalEvent[], day: string, tz: string): Array<{ title: string; time: string; attendees: number; allDay: boolean; sortKey: string }> {
  const seen = new Set<string>();
  const out: Array<{ title: string; time: string; attendees: number; allDay: boolean; sortKey: string }> = [];
  for (const e of events) {
    if (!e?.start) continue;
    const key = e.eventId || `${e.start}|${e.title ?? ''}`;
    if (seen.has(key)) continue;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(e.start);
    const allDay = !!e.isAllDay || dateOnly;
    let onDay: boolean; let time: string; let sortKey: string;
    if (dateOnly) {
      onDay = e.start === day; time = 'all day'; sortKey = '0';
    } else {
      const s = new Date(e.start);
      if (isNaN(s.getTime())) continue;
      onDay = localDate(s, tz) === day;
      time = allDay ? 'all day' : localTime(s, tz);
      sortKey = allDay ? '0' : `1${s.toISOString()}`;
    }
    if (!onDay) continue;
    seen.add(key);
    out.push({ title: (e.title || '(no title)').slice(0, 200), time, attendees: Array.isArray(e.attendees) ? e.attendees.length : 0, allDay, sortKey });
  }
  return out.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

/**
 * Emails needing a reply = the email part of My Attention, the same partition the Day Brief
 * page shows (open items of type email are a different, much smaller set).
 * Capped at ATTENTION_TIMEOUT_MS: warm, it is the Day Brief page's cached partition; cold, it can
 * take minutes, and a spoken brief must not wait on that. A timeout reports "loading", not 0.
 */
export async function loadAttentionEmails(clientNumber: string, userId: number, timeoutMs: number = ATTENTION_TIMEOUT_MS) {
  // DEF-465, W-1.E (Suzi Master AGREE 13 Nov): emails and fyi come from the Wiki's marked email sources. If the Wiki
  // cannot be read, the triage partition below answers as before (nothing he must answer can disappear).
  try {
    const { loadWikiEmails } = await import('./wikiEmails');
    const w = await Promise.race([
      loadWikiEmails(clientNumber, userId),
      new Promise<null>((r) => { const t = setTimeout(() => r(null), timeoutMs); (t as any).unref?.(); }),
    ]);
    if (w) {
      const { replyStates, UNCHECKED } = await import('./suziReplied');
      const states = await replyStates(userId, w.emails.map((i) => i.threadId));
      const open = w.emails
        .map((i) => ({ ...i, reply: (i.threadId && states.get(i.threadId)) || UNCHECKED }))
        .filter((i) => !i.reply.replied_at);
      const { cardTruth } = await import('../triage/cardTruth'); // DEF-474/475: the task's priority and line; answered invitations out
      const items = await cardTruth(open as any[], clientNumber, userId);
      return { items: items as any[], loading: false, fyi: w.fyi as any[] };
    }
  } catch { /* fall through to the partition */ }
  try {
    const { computeBriefPartition } = await import('../triage/briefPartitionService');
    const part = await Promise.race([
      computeBriefPartition(clientNumber, userId, 100, 100),
      new Promise<null>((r) => { const t = setTimeout(() => r(null), timeoutMs); (t as any).unref?.(); }),
    ]);
    if (!part) return { items: [], loading: true, fyi: [] };
    // Link T23: Gmail itself says what he has already answered, from any address or app. Those
    // are left out; the rest carry whether that could be checked. Copies, since the triage cache
    // shares these objects.
    const emails = part.myAttention.filter((i) => i.itemType === 'email');
    const { replyStates, UNCHECKED } = await import('./suziReplied');
    const states = await replyStates(userId, emails.map((i) => i.threadId));
    const { cardTruth } = await import('../triage/cardTruth'); // DEF-474/475 (copies, so the triage cache is untouched)
    const items = await cardTruth(emails
      .map((i) => ({ ...i, criticality: i.criticality ? { ...i.criticality } : i.criticality, reply: (i.threadId && states.get(i.threadId)) || UNCHECKED }))
      .filter((i) => !i.reply.replied_at) as any[], clientNumber, userId);
    // DEF-459: emails that need nothing from him but he should know (same partition).
    return { items, loading: false, fyi: part.forYourKnowledge ?? [] };
  } catch {
    return { items: [], loading: false, fyi: [] };
  }
}

export async function buildDayBriefFacts(clientNumber: string, userId: number, opts: { timezone?: string; now?: Date; attentionTimeoutMs?: number } = {}): Promise<DayBriefFacts> {
  const tz = safeTimezone(opts.timezone);
  const now = opts.now ?? new Date();
  const day = localDate(now, tz);

  // DEF-385 (CL-063): one source down never fails the brief. Each source is read on its own,
  // and what could not be used is listed in `missing` with how to reconnect it.
  const missing: DayBriefFacts['missing'] = [];
  const connectors = await prisma.userConnector.findMany({
    where: { userId, clientNumber },
    select: { status: true, connectorType: { select: { slug: true } } },
  }).catch(() => [] as Array<{ status: string; connectorType: { slug: string } }>);
  const statusOf = (slugList: string[]) => {
    const rows = connectors.filter((c) => slugList.includes(c.connectorType.slug));
    if (rows.some((r) => r.status === 'connected')) return 'connected';
    return rows.some((r) => r.status === 'expired') ? 'expired' : 'not_connected';
  };
  const calStatus = statusOf(['google_calendar', 'outlook_calendar']);
  const mailStatus = statusOf(['gmail', 'outlook', 'imap_smtp']);
  let calendar = calStatus === 'connected';
  const email = mailStatus === 'connected';
  if (!calendar) missing.push({ source: 'calendar', status: calStatus as 'not_connected' | 'expired', reconnect: RECONNECT.calendar });
  if (!email) missing.push({ source: 'email', status: mailStatus as 'not_connected' | 'expired', reconnect: RECONNECT.email });

  // A ±36 h window around now covers "today" in any zone; meetingsForDay keeps the exact day.
  const from = new Date(now.getTime() - 36 * 3600_000).toISOString();
  const to = new Date(now.getTime() + 36 * 3600_000).toISOString();
  let calRows: Array<{ p: RawCalEvent }> = [];
  if (calendar) {
    try {
      calRows = await prisma.$queryRawUnsafe<Array<{ p: RawCalEvent }>>(
        `SELECT raw_payload AS p FROM feed_events
          WHERE client_number = $1 AND user_id = $2
            AND source_type IN ('gcal', 'outlook_calendar')
            AND (raw_payload->>'start') >= $3 AND (raw_payload->>'start') < $4`,
        clientNumber, userId, from.slice(0, 10), to,
      );
    } catch {
      calendar = false;
      missing.push({ source: 'calendar', status: 'error' });
    }
  }
  const meetings = meetingsForDay(calRows.map((r) => r.p), day, tz);

  const actions = await prisma.openItem.findMany({
    where: { clientNumber, userId, status: { in: OPEN }, NOT: { type: 'email' } } as any,
    select: { id: true, title: true, priority: true, status: true, dueDate: true },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    take: 200,
  }).catch(() => { missing.push({ source: 'actions', status: 'error' }); return [] as Array<{ id: string; title: string; priority: string; status: string; dueDate: Date | null }>; });
  const attention = email ? await loadAttentionEmails(clientNumber, userId, opts.attentionTimeoutMs) : { items: [], loading: false };
  const emailsLoading = attention.loading;
  if (emailsLoading) missing.push({ source: 'email', status: 'loading' });
  const attentionEmails = attention.items.map((i) => ({ detail: [emailGist(i).summary, emailGist(i).point].filter(Boolean).join(' '), from: i.fromDisplay || i.from, subject: i.subject, receivedAt: i.receivedAt, critical: i.critical }));
  const emailsNeedingReply = attentionEmails.length;

  const sortedActions = [...actions].sort((a, b) =>
    (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
    || (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));
  const overdue = actions.filter((a) => a.dueDate && localDate(a.dueDate, tz) < day).length;
  const dueToday = actions.filter((a) => a.dueDate && localDate(a.dueDate, tz) === day).length;

  // Business KPIs (Integrations → kpi_readings): the latest total per active KPI.
  const kpiRows = await prisma.$queryRawUnsafe<Array<{ label: string; unit: string | null; value: string; period: Date }>>(
    `SELECT DISTINCT ON (d.kpi_key) d.label, d.unit, r.value::text AS value, r.period_start AS period
       FROM kpi_definitions d
       JOIN kpi_readings r ON r.client_number = d.client_number AND r.kpi_key = d.kpi_key AND r.dimension_key = ''
      WHERE d.client_number = $1 AND d.is_active
      ORDER BY d.kpi_key, r.period_start DESC
      LIMIT 6`,
    clientNumber,
  ).catch(() => [] as Array<{ label: string; unit: string | null; value: string; period: Date }>);

  const kpiItems: Array<{ label: string; value: number | string; unit?: string; note?: string }> = kpiRows.map((k) => ({
    label: k.label, value: Number(k.value), ...(k.unit ? { unit: k.unit } : {}), note: `period ${new Date(k.period).toISOString().slice(0, 10)}`,
  }));
  kpiItems.push(
    { label: 'Meetings today', value: calendar ? meetings.length : 'not connected' },
    { label: 'Pending actions', value: actions.length },
    { label: 'Due today', value: dueToday },
    { label: 'Overdue', value: overdue },
    { label: 'Emails needing a reply', value: !email ? 'not connected' : emailsLoading ? 'still loading' : emailsNeedingReply },
  );

  const byPriority = ['critical', 'high', 'medium', 'low'].map((p) => ({ label: p, value: actions.filter((a) => a.priority === p).length }));

  return {
    date: day,
    timezone: tz,
    generatedAt: now.toISOString(),
    sources: { calendar, email, businessKpis: kpiRows.length > 0 },
    missing,
    blocks: [
      { type: 'kpis', id: 'key_figures', title: 'Key figures', items: kpiItems },
      {
        type: 'list', id: 'meetings', title: 'Meetings today', connected: calendar,
        items: meetings.map((m) => ({ primary: m.title, time: m.time, ...(m.attendees ? { secondary: `${m.attendees} attendees` } : {}) })),
      },
      {
        type: 'table', id: 'pending_actions', title: 'Pending actions',
        columns: ['Action', 'Priority', 'Status', 'Due'],
        rows: sortedActions.slice(0, 10).map((a) => [a.title.slice(0, 200), a.priority, a.status, a.dueDate ? localDate(a.dueDate, tz) : null]),
      },
      {
        type: 'list', id: 'emails', title: 'Emails needing a reply', connected: email, ...(emailsLoading ? { loading: true } : {}),
        items: attentionEmails.slice(0, 8).map((e) => ({
          primary: (e.subject || '(no subject)').slice(0, 200),
          secondary: `${e.from}${e.critical ? ' · critical' : ''}`.slice(0, 200),
          time: localDate(new Date(e.receivedAt), tz),
          // For the words the model says; the board keeps the subject and the sender.
          ...(e.detail ? { detail: e.detail } : {}),
        })),
      },
      { type: 'chart', id: 'actions_by_priority', title: 'Pending actions by priority', chart: 'bar', series: byPriority },
    ],
  };
}
