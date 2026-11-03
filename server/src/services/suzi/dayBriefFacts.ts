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
import prisma from '../../db/prisma';

export type BriefBlock =
  | { type: 'kpis'; id: string; title: string; items: Array<{ label: string; value: number | string; unit?: string; note?: string }> }
  | { type: 'list'; id: string; title: string; connected: boolean; loading?: boolean; items: Array<{ primary: string; secondary?: string; time?: string }> }
  | { type: 'table'; id: string; title: string; columns: string[]; rows: Array<Array<string | number | null>> }
  | { type: 'chart'; id: string; title: string; chart: 'bar'; series: Array<{ label: string; value: number }> };

export interface DayBriefFacts {
  date: string;        // YYYY-MM-DD in the user's timezone
  timezone: string;
  generatedAt: string;
  sources: { calendar: boolean; email: boolean; businessKpis: boolean };
  blocks: BriefBlock[];
}

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

export async function buildDayBriefFacts(clientNumber: string, userId: number, opts: { timezone?: string; now?: Date; attentionTimeoutMs?: number } = {}): Promise<DayBriefFacts> {
  const tz = safeTimezone(opts.timezone);
  const now = opts.now ?? new Date();
  const day = localDate(now, tz);

  const connectors = await prisma.userConnector.findMany({
    where: { userId, clientNumber, status: 'connected' },
    select: { connectorType: { select: { slug: true } } },
  });
  const slugs = new Set(connectors.map((c) => c.connectorType.slug));
  const calendar = slugs.has('google_calendar') || slugs.has('outlook_calendar');
  const email = slugs.has('gmail') || slugs.has('outlook') || slugs.has('imap_smtp');

  // A ±36 h window around now covers "today" in any zone; meetingsForDay keeps the exact day.
  const from = new Date(now.getTime() - 36 * 3600_000).toISOString();
  const to = new Date(now.getTime() + 36 * 3600_000).toISOString();
  const calRows = calendar
    ? await prisma.$queryRawUnsafe<Array<{ p: RawCalEvent }>>(
        `SELECT raw_payload AS p FROM feed_events
          WHERE client_number = $1 AND user_id = $2
            AND source_type IN ('gcal', 'outlook_calendar')
            AND (raw_payload->>'start') >= $3 AND (raw_payload->>'start') < $4`,
        clientNumber, userId, from.slice(0, 10), to,
      )
    : [];
  const meetings = meetingsForDay(calRows.map((r) => r.p), day, tz);

  const actions = await prisma.openItem.findMany({
    where: { clientNumber, userId, status: { in: OPEN }, NOT: { type: 'email' } } as any,
    select: { title: true, priority: true, status: true, dueDate: true },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    take: 200,
  });
  // Emails needing a reply = the email part of My Attention, the same partition the Day Brief
  // page shows (open items of type email are a different, much smaller set).
  // Capped at ATTENTION_TIMEOUT_MS: warm, it is the Day Brief page's cached partition; cold, it can
  // take minutes, and a spoken brief must not wait on that. A timeout reports "loading", not 0.
  let attentionEmails: Array<{ from: string; subject: string; receivedAt: string; critical?: boolean }> = [];
  let emailsLoading = false;
  if (email) {
    try {
      const { computeBriefPartition } = await import('../triage/briefPartitionService');
      const part = await Promise.race([
        computeBriefPartition(clientNumber, userId, 100, 100),
        new Promise<null>((r) => { const t = setTimeout(() => r(null), opts.attentionTimeoutMs ?? ATTENTION_TIMEOUT_MS); (t as any).unref?.(); }),
      ]);
      if (!part) { emailsLoading = true; throw new Error('attention list still loading'); }
      attentionEmails = part.myAttention
        .filter((i) => i.itemType === 'email')
        .map((i) => ({ from: i.fromDisplay || i.from, subject: i.subject, receivedAt: i.receivedAt, critical: i.critical }));
    } catch { attentionEmails = []; }
  }
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
        })),
      },
      { type: 'chart', id: 'actions_by_priority', title: 'Pending actions by priority', chart: 'bar', series: byPriority },
    ],
  };
}
