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
  /** DEF-459 (owner, 13 Nov): emails that need nothing from him but he should know (escalation, risk, his own thread,
   *  his team), each with the model's one-line reason. Absent or empty = the section is left out. */
  forYourKnowledge?: Array<{ from: string; subject: string; why: string; kind: string }>;
  /** DEF-422: every open item of his, not the length of the capped list. */
  openTotal?: number;
  /** DEF-415: his local clock when the brief was made ("HH:MM"), so the greeting fits the time it is read. */
  nowLocal?: string;
  /** Attendee email -> the person's name, so the brief names people instead of addresses. */
  attendeeNames?: Record<string, string>;
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
  // DEF-459: the same partition My Attention comes from (memoised), so the two never disagree.
  const forYourKnowledge = await (async () => {
    const { computeBriefPartition } = await import('../triage/briefPartitionService');
    const part = await computeBriefPartition(clientNumber, userId, 100, 100);
    return (part.forYourKnowledge ?? []).map((it) => ({
      from: String(it.fromDisplay || it.from || '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || 'someone',
      subject: it.subject || '(no subject)', why: it.forYourKnowledge?.why ?? '', kind: it.forYourKnowledge?.kind ?? '',
    }));
  })().catch(() => undefined);
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
  // DEF-422: the true number of open items (the list above is capped for the lines it names).
  const openTotal = await getOpenItems({ clientNumber, userId, opts: { limit: 1000 } }).then((x) => x.length).catch(() => undefined);
  // DEF-415: the greeting follows the clock at the time of making, not "Good morning" by habit.
  const nowLocal = formatTimeInZone(timezone, generatedAt);
  // Attendee names: one lookup for every address on today's calendar.
  const attendeeEmails = [...new Set(calendar.flatMap((e) => e.attendees ?? []).map((a) => String(a).toLowerCase()).filter(Boolean))];
  const attendeeNames: Record<string, string> = {};
  if (attendeeEmails.length) {
    const nm = await prisma.$queryRawUnsafe<Array<{ email: string; name: string }>>(
      `SELECT DISTINCT ON (lower(f.facet_value)) lower(f.facet_value) AS email, p.display_name AS name
         FROM person_facets f JOIN persons p ON p.id = f.person_id
        WHERE p.client_number = $1 AND p.user_id = $2 AND f.facet_type = 'email' AND lower(f.facet_value) = ANY($3::text[])
        ORDER BY lower(f.facet_value), f.verified DESC`,
      clientNumber, userId, attendeeEmails,
    ).catch(() => [] as Array<{ email: string; name: string }>);
    for (const n of nm) if (n.name) attendeeNames[n.email] = n.name;
  }
  const ownEmails = [owner?.email, owner?.integrationEmail].filter(Boolean).map((e: string) => e.toLowerCase());
  const threads = openItems.length === 0 ? [] : await prisma.$queryRawUnsafe<Array<{ t: string | null }>>(
    `SELECT metadata->'derivedFrom'->>'threadId' AS t FROM open_items WHERE id = ANY($1::text[])`,
    openItems.map((o) => o.id),
  ).catch(() => [] as Array<{ t: string | null }>);
  const candidates = briefAsks(attention, {
    ownEmails, ownName: String(owner?.name ?? ''),
    openThreadIds: new Set(threads.map((r) => r.t).filter((t): t is string => !!t)),
  });
  // Owner, 11-12: read each ask in its conversation, keep it only if it is really an ask of him, and never
  // repeat what his open items, his calendar or another ask already say.
  const asks = await judgeAsks({
    clientNumber, userId, ownEmails, ownName: String(owner?.name ?? ''), candidates,
    openTitles: openItems.map((o) => o.title), calendarTitles: calendar.map((e) => e.title),
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
    openTotal,
    nowLocal,
    attendeeNames,
    followUps,
    suziUpdates,
    forYourKnowledge,
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

/** One candidate ask with the conversation around it, as the judge reads it. */
async function contextOf(clientNumber: string, userId: number, a: any, ownEmails: string[]): Promise<{ text: string; around: string[] }> {
  const mine = (from: string) => ownEmails.some((e) => from.toLowerCase().includes(e));
  const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
  if (a.feedEventId) {
    const fe = await prisma.feedEvent.findFirst({ where: { id: String(a.feedEventId), clientNumber, userId } as any, select: { sourceType: true, rawPayload: true, createdAt: true } as any }).catch(() => null) as any;
    const p = (fe?.rawPayload ?? {}) as any;
    if (fe?.sourceType === 'gchat' && p.spaceName) {
      const rows = await prisma.$queryRawUnsafe<Array<{ d: string | null; t: string | null }>>(
        `SELECT raw_payload->>'senderDisplayName' AS d, coalesce(raw_payload->>'text', raw_payload->>'snippet') AS t FROM feed_events
          WHERE client_number = $1 AND user_id = $2 AND source_type = 'gchat' AND raw_payload->>'spaceName' = $3
          ORDER BY created_at DESC LIMIT 12`,
        clientNumber, userId, String(p.spaceName),
      ).catch(() => [] as Array<{ d: string | null; t: string | null }>);
      return { text: clean(p.text ?? p.snippet), around: rows.reverse().filter((r) => clean(r.t)).map((r) => `${clean(r.d) || 'someone'}: ${clean(r.t).slice(0, 200)}`) };
    }
  }
  if (a.threadId) {
    // Owner, 13 Nov ("Nexeo should see these intelligently"): judge from the real text of the conversation, not
    // 200-character previews. A preview cut his "TMC Context is done" reply down to its first lines about access,
    // so a settled ask came back as new. Quoted history is cut so each message is its own words.
    try {
      const { fetchEmailThreadContext } = await import('../gmailService');
      const msgs = await fetchEmailThreadContext(userId, String(a.threadId), 6);
      if (msgs.length) {
        const own = (t: string) => t.split(/\n\s*On .{5,200}wrote:\s*\n|\n-{2,}\s*Original Message|\n\s*From: .+\n\s*Sent: /i)[0];
        return {
          text: clean(a.preview || a.subject),
          around: msgs.map((m) => `${m.from === 'me' ? 'HIM' : clean(m.fromName) || 'someone'}: ${clean(own(m.text)).slice(0, 700)}`),
        };
      }
    } catch { /* fall back to the stored previews below */ }
    const rows = await prisma.$queryRawUnsafe<Array<{ s: string | null; t: string | null }>>(
      `SELECT sender_email AS s, raw_payload->>'snippet' AS t FROM feed_events
        WHERE client_number = $1 AND user_id = $2 AND raw_payload->>'threadId' = $3 ORDER BY created_at DESC LIMIT 8`,
      clientNumber, userId, String(a.threadId),
    ).catch(() => [] as Array<{ s: string | null; t: string | null }>);
    const seen = new Set<string>();
    const around = rows.reverse().filter((r) => { const k = clean(r.t).slice(0, 80); if (!k || seen.has(k)) return false; seen.add(k); return true; })
      .map((r) => `${mine(String(r.s ?? '')) ? 'HIM' : clean(String(r.s ?? '').replace(/<[^>]*>/g, '')) || 'someone'}: ${clean(r.t).slice(0, 220)}`);
    return { text: clean(a.preview || a.subject), around };
  }
  return { text: clean(a.preview || a.subject), around: [] };
}

/**
 * The brief's "New asks", judged: each candidate read in its conversation; kept only when it is a concrete,
 * still-open ask of him that his open items, today's calendar and the other asks do not already cover; and
 * written in plain words, never copied. When the model cannot answer, the definition-filtered list stands.
 */
export async function judgeAsks(args: {
  clientNumber: string; userId: number; ownEmails: string[]; ownName: string;
  candidates: AttentionRow[]; openTitles: string[]; calendarTitles: string[];
}): Promise<AttentionRow[]> {
  const list = args.candidates.slice(0, 12);
  if (list.length === 0) return [];
  try {
    const ctx = await Promise.all(list.map((a) => contextOf(args.clientNumber, args.userId, a, args.ownEmails)));
    const who = args.ownName || 'the owner';
    const system = [
      `You prepare the "New asks" section of ${who}'s morning brief. Each candidate is a message with the conversation around it (HIM = ${who}).`,
      `Keep a candidate only if it is a concrete ask of ${who} himself that is still open: someone wants him to decide, approve, reply with something specific, provide, review, or meet with a purpose.`,
      'Drop it if it is small talk, a greeting, a thank-you, a confirmation, a link with no request, something asked of someone else, or a matter settled later in the conversation (also by him).',
      `A business system asking ${who} himself to approve or acknowledge something (a timesheet, an invoice, a ticket escalation) IS an ask, not a mere notification.`,
      `It is settled when HIM later says it is done, completed, delivered, shared, sent or answered, even if the asker had asked for a plan or a date to finish it: a finished thing needs no plan.`,
      `Drop it if it is the same matter as one of his open items, a calendar event today, or another kept candidate (keep only the clearest one).`,
      'For each kept candidate write one line in plain English: who wants what from him, in your own words, at most 18 words. No quotes, no links, no raw subject lines.',
      'Answer strict JSON only: {"keep":[{"id":"<candidate id>","line":"..."}]}',
    ].join('\n');
    const user = [
      `His open items: ${args.openTitles.join(' | ') || '(none)'}`,
      `His calendar today: ${args.calendarTitles.join(' | ') || '(none)'}`,
      ...list.map((a: any, i) => [
        `\nCandidate c${i} (${a.itemType === 'whatsapp' ? 'chat' : a.itemType || 'email'}) from ${String(a.fromDisplay || a.from || 'someone').replace(/<[^>]*>/g, '').trim()}, about: ${String(a.subject || '').slice(0, 140)}`,
        `Message: ${ctx[i].text.slice(0, 400) || '(no text)'}`,
        ctx[i].around.length ? `Conversation (oldest first):\n${ctx[i].around.join('\n')}` : 'Conversation: (none stored)',
      ].join('\n')),
    ].join('\n');
    const { callGemini } = await import('../geminiService');
    const raw = await callGemini(system, user, { flash: true, maxTokens: 900, responseMimeType: 'application/json' });
    const parsed = JSON.parse(String(raw)) as { keep?: Array<{ id?: string; line?: string }> };
    if (!Array.isArray(parsed?.keep)) return list;
    const out: AttentionRow[] = [];
    for (const k of parsed.keep) {
      const i = Number(String(k.id ?? '').replace(/^c/, ''));
      const line = String(k.line ?? '').trim();
      if (!Number.isInteger(i) || !list[i] || !line) continue;
      out.push({ ...(list[i] as any), briefLine: line.slice(0, 200) });
    }
    return out;
  } catch {
    return list;
  }
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
  // DEF-415: the greeting must fit this time (morning before 12:00, afternoon to 17:00, evening after); or no greeting.
  if (data.nowLocal) parts.push(`Local time now: ${data.nowLocal}. Any greeting must fit this time of day (never "Good morning" after 12:00).`);
  parts.push('STRICT RULE: name every line under "Today\'s calendar", "Do first" and "New asks" in the order shown, one line each. "For your knowledge" lines are things to KNOW, not to do: say each briefly as news, never as a task. For "Other open items" give its exact count only. Do NOT add, drop or re-rank items, and never mention an item twice. Empty sections are said in a few words, never hidden.');

  parts.push(`\n## Today's calendar (${data.calendar.length})`);
  if (data.calendar.length === 0) parts.push('- (no meetings scheduled today)');
  else for (const e of data.calendar) {
    // Names, not addresses, where we know the person.
    const people = e.attendees.filter((a) => !own.has(a.toLowerCase())).map((a) => data.attendeeNames?.[a.toLowerCase()] ?? a);
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
  // DEF-422: the true remainder, not what is left of a list capped at 20.
  const others = Math.max(rest.length, (data.openTotal ?? data.openItems.length) - first.length);
  parts.push(`\n## Other open items (${others})`);
  parts.push(others === 0 ? '- (none)' : `- ${others} more in the Action Center`);

  // DEF-435: new asks of him that are not already open items.
  const asks = data.asks ?? data.attention;
  parts.push(`\n## New asks (${asks.length})`);
  if (asks.length === 0) parts.push('- (no new asks)');
  else for (const a of asks.slice(0, 8)) {
    const x = a as any;
    const who = String(x.fromDisplay || x.from || '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || 'someone';
    // A chat's "subject" is its space id; what was said is the preview.
    const what = String((x.itemType === 'whatsapp' ? (x.preview || x.subject) : (x.subject || x.preview)) || x.title || 'a message').replace(/^((re|fw|fwd)\s*:\s*)+/i, '').slice(0, 120);
    parts.push(x.briefLine ? `- ${x.briefLine}` : `- ${who}: ${what} (${x.itemType === 'whatsapp' ? 'chat' : x.itemType || 'email'})`);
  }
  if (asks.length > 8) parts.push(`- +${asks.length - 8} more new asks`);

  parts.push(...renderForYourKnowledge(data.forYourKnowledge));
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
/** DEF-459: things to know, not to do. Shown only when there is something. */
export function renderForYourKnowledge(items: DayBriefData['forYourKnowledge']): string[] {
  if (!items?.length) return [];
  const lines = items.slice(0, 5).map((f) => `- ${f.from}: ${f.subject.replace(/^((re|fw|fwd)\s*:\s*)+/i, '').slice(0, 100)}. ${f.why}`);
  if (items.length > 5) lines.push(`- +${items.length - 5} more on the Day Brief page`);
  return ['\n## For your knowledge (nothing needed from you)', ...lines];
}

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
