/**
 * Canonical view: Day Brief.
 *
 * The ONE function that returns the user's Day Brief data — used by
 * the Page (briefRoutes), the WhatsApp dispatch job (dayBriefDispatchJob),
 * and the Brain chat composer when intent='day_brief'.
 *
 * Per Basit 2026-05-25 "brief on chat (whatsapp and UI) and brief page
 * should have same data". Before this, the Page used computeBriefPartition
 * directly (returning structured cards) and the chat path used the LLM
 * composer with separate sub-blocks (open items + calendar + attention).
 * The sources were aligned (both routed through the views layer) but the
 * LLM could re-rank / drop items in narration, producing chat briefs
 * inconsistent with what the Page showed.
 *
 * This view returns the SAME structured object both surfaces consume:
 *   - Page renders the object as tiles directly (no LLM in the loop).
 *   - Chat injects a deterministic Markdown rendering of the object as
 *     a dataBlock, and reasoning narrates ONLY from that block under
 *     anti-fabrication rules. The block lists every item in order;
 *     reasoning is forbidden from re-ranking, dropping, or inventing.
 *
 * Caching: each underlying view (openItems / attention / calendar) has
 * its own TTL. getDayBrief doesn't add a wrapping cache — composes them
 * fresh per call. The partition cache (90s TTL on attention) is the
 * main savings for back-to-back calls.
 */
import { formatTimeInZone } from '../userTimezoneService';
import prisma from '../../db/prisma';
import { getOpenItems, type OpenItemRow } from './openItems';
import { getAttentionSurface, type AttentionRow } from './attention';
import { getTodayCalendar, type CalendarEventRow } from './calendar';
import { getFollowUps, type FollowUps } from './followUps';
import { masterLinesForBrief } from '../suzi/masterNotice';

export interface DayBriefData {
  /** When this brief was assembled — useful for stale-data hints. */
  generatedAt: Date;
  /** Today's date in user's local tz, ISO YYYY-MM-DD. */
  localDate: string;
  localTimezone: string;
  /** Calendar events for today. Sorted by start time. */
  calendar: CalendarEventRow[];
  /** Open items sorted by priority then due-date. Capped at 20 for
   *  the brief surface — the Action Center shows the full list. */
  openItems: OpenItemRow[];
  /** My Attention surface — items where Brain needs the user's call.
   *  Already sorted by the partition service's canonical ranking. */
  attention: AttentionRow[];
  /** DEF-435 (CL-075): My Attention under the agreed Action Center definition — addressed to him (not copied,
   *  not a system alert), not from himself, not a plain invite, and not a thread already in his open items. */
  asks?: AttentionRow[];
  /** His own addresses, so the brief never lists him as an attendee or a sender to answer. */
  ownEmails?: string[];
  /** Recent inbound emails (last 24h, capped 10). Quick "what came in"
   *  without scrolling Gmail. */
  recentEmails: Array<{
    fromName: string;
    fromEmail: string;
    subject: string;
    snippet: string;
    receivedAt: Date;
  }>;
  /** Recent inbound WhatsApp (last 24h, capped 10), with known-contact
   *  resolution. Unknown senders labelled. */
  /** DEF-412 (CL-069/CL-070): what used to arrive as separate nudges during the day, as facts. Null when it
   *  couldn't be read, so the brief says so instead of reporting "nothing". */
  followUps: FollowUps | null;
  /** Link T30, D3: what Suzi Master fixed for everyone since yesterday. null = could not be read. */
  suziUpdates?: string[] | null;
  recentWhatsApp: Array<{
    fromName: string;          // resolved contact title or '(not in contacts)'
    fromPhone: string;
    body: string;
    receivedAt: Date;
    knownContact: boolean;
  }>;
}

export interface GetDayBriefOpts {
  /** Override timezone (default: user's brain_channel timezone or PKT). */
  timezone?: string;
  /** Cap openItems count for the brief surface. Default 20. */
  openItemsCap?: number;
  /** Cap attention count. Default 30. */
  attentionCap?: number;
}

export async function getDayBrief(args: {
  clientNumber: string;
  userId: number;
  opts?: GetDayBriefOpts;
}): Promise<DayBriefData> {
  const { clientNumber, userId, opts } = args;
  const { resolveUserTimezone, formatLocalDate } = await import('../userTimezoneService');
  const timezone = opts?.timezone ?? await resolveUserTimezone(userId);
  const generatedAt = new Date();
  const localDate = formatLocalDate(timezone, generatedAt);

  const suziUpdates = await masterLinesForBrief(clientNumber, userId, generatedAt).catch(() => null);
  const [calendar, openItems, attention, emails, waMsgs, followUps] = await Promise.all([
    getTodayCalendar({ clientNumber, userId, opts: { timezone } }).catch(() => [] as CalendarEventRow[]),
    getOpenItems({ clientNumber, userId, opts: { limit: opts?.openItemsCap ?? 20 } }).catch(() => [] as OpenItemRow[]),
    getAttentionSurface({ clientNumber, userId, opts: { limit: opts?.attentionCap ?? 30 } }).catch(() => [] as AttentionRow[]),
    prisma.$queryRawUnsafe<Array<{
      sender_name: string | null; sender_email: string | null;
      raw_payload: any; created_at: Date;
    }>>(
      `SELECT sender_name, sender_email, raw_payload, created_at
         FROM feed_events
        WHERE client_number = $1 AND user_id = $2 AND source_type='gmail'
          AND created_at >= NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC LIMIT 10`,
      clientNumber, userId,
    ).catch(() => [] as any[]),
    prisma.$queryRawUnsafe<Array<{
      sender_phone: string | null; sender_name: string | null;
      raw_payload: any; created_at: Date;
    }>>(
      `SELECT sender_phone, sender_name, raw_payload, created_at
         FROM feed_events
        WHERE client_number = $1 AND user_id = $2 AND source_type='whatsapp'
          AND COALESCE((raw_payload->>'fromMe')::boolean, FALSE) = FALSE
          AND created_at >= NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC LIMIT 10`,
      clientNumber, userId,
    ).catch(() => [] as any[]),
    getFollowUps({ clientNumber, userId, timezone, now: generatedAt }).catch(() => null),
  ]);

  // Resolve WA phones to known-contact names.
  const phones = Array.from(new Set(waMsgs.map((m) => (m.sender_phone ?? '').replace(/[^\d+]/g, '')).filter(Boolean)));
  const known = new Map<string, string>();
  if (phones.length > 0) {
    const rows = await prisma.$queryRawUnsafe<Array<{ title: string; phone: string }>>(
      `SELECT title, regexp_replace(coalesce(metadata->>'phone',''), '[^0-9+]','','g') AS phone
         FROM wiki_pages
        WHERE client_number = $1 AND page_type='entity_person'
          AND user_id = $2
          AND status NOT IN ('archived','inactive','deleted','contradicted')
          AND regexp_replace(coalesce(metadata->>'phone',''), '[^0-9+]','','g') = ANY($3::text[])`,
      clientNumber, userId, phones,
    ).catch(() => [] as any[]);
    for (const r of rows) known.set(r.phone, r.title);
  }

  const owner = await prisma.user.findFirst({ where: { id: userId, clientNumber } as any, select: { name: true, email: true, integrationEmail: true } as any }).catch(() => null) as any;
  const ownEmails = [owner?.email, owner?.integrationEmail].filter(Boolean).map((e: string) => e.toLowerCase());
  const threads = openItems.length === 0 ? [] : await prisma.$queryRawUnsafe<Array<{ t: string | null }>>(
    `SELECT metadata->'derivedFrom'->>'threadId' AS t FROM open_items WHERE id = ANY($1::text[])`,
    openItems.map((o) => o.id),
  ).catch(() => [] as Array<{ t: string | null }>);
  const asks = briefAsks(attention, {
    ownEmails, ownName: String(owner?.name ?? ''),
    openThreadIds: new Set(threads.map((r) => r.t).filter((t): t is string => !!t)),
  });

  return {
    generatedAt,
    localDate,
    localTimezone: timezone,
    calendar,
    openItems,
    attention,
    asks,
    ownEmails,
    followUps,
    suziUpdates,
    recentEmails: emails.map((r) => {
      const unwrap = r.sender_email?.match(/<([^>]+)>/)?.[1] ?? r.sender_email ?? '';
      return {
        fromName: r.sender_name?.trim() || '',
        fromEmail: unwrap.toLowerCase(),
        subject: String(r.raw_payload?.subject ?? '').slice(0, 200) || '(no subject)',
        snippet: String(r.raw_payload?.snippet ?? '').replace(/\s+/g, ' ').slice(0, 200),
        receivedAt: r.created_at,
      };
    }),
    recentWhatsApp: waMsgs.map((m) => {
      const phone = (m.sender_phone ?? '').replace(/[^\d+]/g, '');
      const knownName = known.get(phone);
      return {
        fromName: knownName ?? m.sender_name?.trim() ?? '(not in contacts)',
        fromPhone: phone,
        body: String(m.raw_payload?.body ?? m.raw_payload?.text ?? '').replace(/\s+/g, ' ').slice(0, 200),
        receivedAt: m.created_at,
        knownContact: !!knownName,
      };
    }),
  };
}

/** DEF-435: My Attention, filtered by the agreed Action Center definition for the brief. */
export function briefAsks(
  attention: AttentionRow[],
  ctx: { ownEmails: string[]; ownName: string; openThreadIds: Set<string> },
): AttentionRow[] {
  const name = ctx.ownName.trim().toLowerCase();
  return attention.filter((a) => {
    const x = a as any;
    if (x.itemType === 'meeting') return false; // an invitation: the calendar covers it
    if (x.addressing === 'cc' || x.addressing === 'none') return false; // copied, or not addressed to him (alerts)
    const from = String(x.fromEmail || x.from || '').toLowerCase();
    const shown = String(x.fromDisplay || x.from || '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim().toLowerCase();
    if (ctx.ownEmails.some((e) => e && from.includes(e)) || (name && shown === name)) return false; // his own
    if (x.threadId && ctx.openThreadIds.has(String(x.threadId))) return false; // already an open item
    return true;
  });
}

const DAY_MS = 86_400_000;
const dayNum = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / DAY_MS;

/** Late, due within 3 days, or high/critical first; the rest is counted. Order kept from the caller. */
export function splitDoFirst(items: OpenItemRow[], today: string): { first: OpenItemRow[]; rest: OpenItemRow[] } {
  const first: OpenItemRow[] = [];
  const rest: OpenItemRow[] = [];
  for (const it of items) {
    const due = it.dueDate ? dayNum(new Date(it.dueDate).toISOString().slice(0, 10)) : null;
    const soon = due !== null && due - dayNum(today) <= 3;
    const high = ['critical', 'high'].includes(String(it.priority).toLowerCase());
    (soon || high ? first : rest).push(it);
  }
  const key = (it: OpenItemRow) => (it.dueDate ? new Date(it.dueDate).getTime() : Infinity);
  first.sort((a, b) => key(a) - key(b));
  return { first, rest };
}

/** "overdue since Fri 16 Oct" / "due today" / "due Sat 14 Nov" / "no date". */
export function duePhrase(dueDate: Date | null, today: string, timezone: string): string {
  if (!dueDate) return 'no date';
  const d = new Date(dueDate);
  const ymd = d.toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: timezone }).format(d);
  const diff = dayNum(ymd) - dayNum(today);
  if (diff < 0) return `overdue since ${label}`;
  if (diff === 0) return 'due today';
  return `due ${label}`;
}

/**
 * Render the Day Brief as a Markdown dataBlock for reasoning to narrate.
 * The chat path uses this as a single block and reasoning is forbidden
 * (per anti-fabrication rules) from adding/removing/re-ranking items.
 *
 * The Page does NOT use this — it consumes the structured DayBriefData
 * directly and renders tiles.
 */
export function renderDayBriefBlock(data: DayBriefData): string {
  const parts: string[] = [];
  const own = new Set((data.ownEmails ?? []).map((e) => e.toLowerCase()));
  parts.push(`# Day Brief for ${data.localDate} (timezone ${data.localTimezone})`);
  parts.push('STRICT RULE: name every line under "Today\'s calendar", "Do first" and "New asks" in the order shown, one line each. For "Other open items" give its exact count only. Do NOT add, drop or re-rank items, and never mention an item twice. Empty sections are said in a few words, never hidden.');

  parts.push(`\n## Today's calendar (${data.calendar.length})`);
  if (data.calendar.length === 0) parts.push('- (no meetings scheduled today)');
  else for (const e of data.calendar) {
    const people = e.attendees.filter((a) => !own.has(a.toLowerCase()));
    const att = people.length > 0
      ? ` — with ${people.slice(0, 4).join(', ')}${people.length > 4 ? ` +${people.length - 4}` : ''}`
      : '';
    // DEF-434: an all-day event is "all day", never a clock time.
    parts.push(e.isAllDay ? `- all day: ${e.title}${att}` : `- ${e.localTime} ${e.title}${att}`);
  }

  // The open items under the agreed definition: what is late, due within 3 days, or high comes first, by name.
  const { first, rest } = splitDoFirst(data.openItems, data.localDate);
  parts.push(`\n## Do first (${first.length})`);
  if (first.length === 0) parts.push('- (nothing late, due soon or high)');
  else for (const it of first) parts.push(`- ${it.title} · ${duePhrase(it.dueDate, data.localDate, data.localTimezone)}${it.delegateeName ? ` · with ${it.delegateeName}` : ''}`);
  parts.push(`\n## Other open items (${rest.length})`);
  parts.push(rest.length === 0 ? '- (none)' : `- ${rest.length} more in the Action Center`);

  // DEF-435: new asks of him that are not already open items.
  const asks = data.asks ?? data.attention;
  parts.push(`\n## New asks (${asks.length})`);
  if (asks.length === 0) parts.push('- (no new asks)');
  else for (const a of asks.slice(0, 8)) {
    const x = a as any;
    const who = String(x.fromDisplay || x.from || '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || 'someone';
    // A chat's "subject" is its space id; what was said is the preview.
    const what = String((x.itemType === 'whatsapp' ? (x.preview || x.subject) : (x.subject || x.preview)) || x.title || 'a message').replace(/^((re|fw|fwd)\s*:\s*)+/i, '').slice(0, 120);
    parts.push(`- ${who}: ${what} (${x.itemType === 'whatsapp' ? 'chat' : x.itemType || 'email'})`);
  }
  if (asks.length > 8) parts.push(`- +${asks.length - 8} more new asks`);

  parts.push(...renderFollowUps(data.followUps));
  parts.push(...renderSuziUpdates(data.suziUpdates));

  parts.push(`\n## Recent emails — last 24h (${data.recentEmails.length})`);
  if (data.recentEmails.length === 0) parts.push('- (no emails in the last 24 hours)');
  else for (const e of data.recentEmails.slice(0, 5)) {
    // DEF-387: the user's own zone, never UTC.
    const t = formatTimeInZone(data.localTimezone, new Date(e.receivedAt));
    parts.push(`- ${t} · ${e.fromName ? `${e.fromName} <${e.fromEmail}>` : e.fromEmail}: ${e.subject}`);
  }
  if (data.recentEmails.length > 5) parts.push(`- … and ${data.recentEmails.length - 5} more emails`);

  parts.push(`\n## Recent WhatsApp — last 24h (${data.recentWhatsApp.length})`);
  if (data.recentWhatsApp.length === 0) parts.push('- (no WhatsApp messages in the last 24 hours)');
  else for (const m of data.recentWhatsApp.slice(0, 5)) {
    const t = formatTimeInZone(data.localTimezone, new Date(m.receivedAt));
    const tag = m.knownContact ? '' : ' [not in contacts]';
    parts.push(`- ${t} · ${m.fromName}${tag}: ${m.body.slice(0, 120)}`);
  }
  if (data.recentWhatsApp.length > 5) parts.push(`- … and ${data.recentWhatsApp.length - 5} more messages`);

  return parts.join('\n');
}

/**
 * DEF-412: the follow-ups that no longer go out one by one during the day (overdue reminders, items that
 * need his decision, memory proposals). Facts only; the composer words them. Each overdue line carries what a
 * real assistant would say: when it was due, how late, who has it, and when it last really changed.
 */
/** Link T30, D3: shown only when there is something, so a quiet day adds nothing to the brief. */
export function renderSuziUpdates(lines: string[] | null | undefined): string[] {
  if (!lines?.length) return [];
  return ['\n## Suzi updates (since yesterday)', ...lines.map((l) => `- ${l}`)];
}

export function renderFollowUps(f: FollowUps | null): string[] {
  const out: string[] = ['\n## Follow-ups'];
  if (!f) { out.push('- (follow-ups could not be read just now: say so)'); return out; }
  out.push(`### Overdue (${f.overdue.length})`);
  if (!f.overdue.length) out.push('- (nothing overdue)');
  for (const o of f.overdue) {
    out.push(`- ${o.title} · due ${o.due} (${o.daysOverdue} day${o.daysOverdue === 1 ? '' : 's'} overdue) · ${o.withWhom === 'you' ? 'with you' : `with ${o.withWhom}`} · ${o.lastChange ? `last real change ${o.lastChange}` : 'no change recorded'}`);
  }
  if (f.overdueTotal > f.overdue.length) out.push(`- … and ${f.overdueTotal - f.overdue.length} more overdue`);
  out.push(`### Needs your decision (${f.needsDecision.length})`);
  if (!f.needsDecision.length) out.push('- (nothing waiting on a decision)');
  for (const d of f.needsDecision) out.push(`- ${d.title}${d.reason ? ` · ${d.reason}` : ''}`);
  if (f.memoryProposalsWaiting !== null && f.memoryProposalsWaiting > 0) {
    out.push(`### Memory proposals waiting for approval: ${f.memoryProposalsWaiting} (Settings → Brain Memories)`);
  }
  return out;
}
