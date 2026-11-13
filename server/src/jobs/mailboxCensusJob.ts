/**
 * DEF-463 (owner, 13 Nov 2026: "all emails should be land in wiki … none of email should be missed"; Wiki-Knowledge
 * §0.12.1, owned by Nexeo-Builder). Every 3 hours, for each user with Google connected, for his today and yesterday
 * (his time zone):
 *   1. ask Gmail for the day's message ids, inbox and sent, separately;
 *   2. compare with what the Wiki holds (sourcesHeld on sourceId(…, 'email', gmailId));
 *   3. land what is missing: an inbox email through the normal feed ingest (which lands it and lets triage judge
 *      it); a sent email through the Wiki's intake (landEmailText, no feed row: nothing to triage), marked
 *      attention {class: 'own'} by 'landing:sent' so the proof can reach 0;
 *   4. save the day's counts as ONE Wiki source of kind 'record' ('mailbox-census:gmail:<day>', re-saved on each run).
 * The founder's proof is two numbers a day: in the mailbox = held, and held = marked (countUnmarked).
 * Bounded: at most 500 ids per box per day and 50 late landings per run; anything left is counted as still missing.
 */
import prisma from '../db/prisma';
import createLogger from '../utils/logger';

const log = createLogger('mailbox-census');
export const CENSUS_EVERY_MS = 3 * 60 * 60_000;
export const MAX_IDS_PER_BOX = 500;
export const MAX_LATE_PER_RUN = 50;
export const SENT_MARK_BY = 'landing:sent';

/** [start, end) of a local day (YYYY-MM-DD) in a zone, as epoch seconds for Gmail's after:/before:. */
export function dayBounds(day: string, tz: string): { start: Date; end: Date } {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Offset of the zone at that instant: format the UTC instant in the zone and compare.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});
  const asLocal = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const offset = asLocal - guess;
  const start = new Date(guess - offset);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60_000) };
}

export interface GmailIds { list(box: 'INBOX' | 'SENT', after: Date, before: Date): Promise<string[]> }

export function gmailIdsFor(gmail: any): GmailIds {
  return {
    async list(box, after, before) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      const q = `after:${Math.floor(after.getTime() / 1000)} before:${Math.floor(before.getTime() / 1000)}`;
      do {
        const r = await gmail.users.messages.list({ userId: 'me', labelIds: [box], q, maxResults: 100, pageToken });
        for (const m of r.data.messages ?? []) if (m.id) ids.push(m.id);
        pageToken = r.data.nextPageToken ?? undefined;
      } while (pageToken && ids.length < MAX_IDS_PER_BOX);
      return ids.slice(0, MAX_IDS_PER_BOX);
    },
  };
}

export interface CensusDeps {
  ids: GmailIds;
  readEmail: (userId: number, id: string) => Promise<{ email?: any; error?: string }>;
}

export interface CensusResult { day: string; inbox: number; sent: number; held: number; fetchedLate: string[]; stillMissing: number; marked: number; unmarked: number; wikiDay: { total: number; unmarked: number } }

export async function censusDay(u: { clientNumber: string; userId: number }, day: string, tz: string, deps: CensusDeps, budget: { late: number; judge?: number }): Promise<CensusResult> {
  const { sourceId, sourcesHeld, saveSource } = await import('../services/wiki/wikiSources');
  const { landEmailText } = await import('../services/wiki/wikiIntake');
  const { markSource, countUnmarked, marksOf } = await import('../services/wiki/wikiStore');
  const { ingest } = await import('../services/feed/feedIngestionService');
  const { start, end } = dayBounds(day, tz);
  const writer = { clientNumber: u.clientNumber, userId: u.userId };
  const [inbox, sent] = await Promise.all([deps.ids.list('INBOX', start, end), deps.ids.list('SENT', start, end)]);
  const sentSet = new Set(sent);
  const all = [...new Set([...inbox, ...sent])];
  const sid = (g: string) => sourceId(u.clientNumber, u.userId, 'email', g);
  const held = await sourcesHeld(u.clientNumber, u.userId, all.map(sid));
  const missing = all.filter((g) => !held.has(sid(g)));
  const fetchedLate: string[] = [];
  for (const g of missing) {
    if (budget.late <= 0) break;
    budget.late -= 1;
    const r = await deps.readEmail(u.userId, g);
    const e = r.email;
    if (!e) { log.warn('a missing email could not be read', { userId: u.userId, id: g, error: r.error }); continue; }
    const receivedAt = e.date && !isNaN(Date.parse(e.date)) ? new Date(e.date) : start;
    // Anything he sent lands through the Wiki's intake, even when it is also in his inbox (a mail to himself, or a
    // thread copy): the feed ingest drops his own outgoing mail (DEF-332 self-echo), so it would never land.
    if (sentSet.has(g)) {
      await landEmailText({ clientNumber: u.clientNumber, userId: u.userId, gmailMessageId: g, threadId: e.threadId, subject: e.subject, from: e.from, to: e.to, cc: e.cc, receivedAt, bodyText: e.body || e.snippet || '', labels: Array.isArray(e.labels) && e.labels.length ? e.labels : ['SENT'] });
    } else {
      // The normal feed path: it lands the email in the Wiki and triage judges it (then marks it).
      await ingest({ clientNumber: u.clientNumber, userId: u.userId, sourceType: 'gmail', sourceId: g, sender: { email: e.from },
        payload: { userId: u.userId, threadId: e.threadId, subject: e.subject, from: e.from, to: e.to, cc: e.cc, snippet: e.snippet, date: e.date } } as any);
    }
    fetchedLate.push(g);
  }
  // His own sent mail has nothing to judge: marked 'own' so the day's proof can reach 0 (no-op when already marked).
  for (const g of sent) {
    if (!held.has(sid(g)) && !fetchedLate.includes(g)) continue;
    await markSource(writer, sid(g), { kind: 'attention', value: { class: 'own' }, by: SENT_MARK_BY }).catch((e: any) =>
      log.warn('sent mail not marked', { userId: u.userId, id: g, error: String(e?.message ?? e).slice(0, 120) }));
  }
  // Landed = marked: an email triage never judged (a calendar reply, an automated notice it skipped or handled on its
  // own) is judged here, so every landed email of the day carries its attention mark. Bounded per run.
  await markUnjudged(u, start, end, budget);
  const held2 = await sourcesHeld(u.clientNumber, u.userId, all.map(sid));
  // ONE unit (Wiki session, 13 Nov): marked and unmarked count the SAME emails as held, the mailbox's own ids.
  const heldIds = all.map(sid).filter((id) => held2.has(id));
  const marks: any = heldIds.length ? await marksOf(u.clientNumber, u.userId, heldIds) : new Map();
  const markList = (id: string): any[] => (marks instanceof Map ? marks.get(id) : marks?.[id]) ?? [];
  const markedN = heldIds.filter((id) => markList(id).some((m: any) => m.kind === 'attention')).length;
  // The Wiki's own count for the day (its emails dated that day, which can include mail Gmail no longer lists in
  // inbox or sent, e.g. archived): reported apart, never mixed into the proof.
  const counts = await countUnmarked(u.clientNumber, u.userId, 'email', 'attention', start, end).catch(() => ({ total: -1, unmarked: -1 }));
  const res: CensusResult = {
    day, inbox: inbox.length, sent: sent.length, held: held2.size, fetchedLate, stillMissing: all.length - held2.size,
    marked: markedN, unmarked: heldIds.length - markedN, wikiDay: { total: counts.total, unmarked: counts.unmarked },
  };
  await saveSource({
    clientNumber: u.clientNumber, userId: u.userId, kind: 'record', externalId: `mailbox-census:gmail:${day}`,
    title: `Mailbox check, ${day}`, occurredAt: start,
    body: [
      `Gmail, ${day} (${tz}): ${res.inbox} in the inbox, ${res.sent} sent.`,
      `Held in the Wiki: ${res.held} of ${all.length}${res.stillMissing ? `; still missing: ${res.stillMissing}` : '; none missing'}.`,
      `Landed late by this check: ${res.fetchedLate.length}.`,
      `Of those held, marked: ${res.marked}; not yet marked: ${res.unmarked}.`,
      `All the Wiki's emails dated that day: ${res.wikiDay.total}, of which not yet marked: ${res.wikiDay.unmarked}.`,
    ].join('\n'),
    details: { type: 'mailbox_census', provider: 'gmail', day, tz, in_mailbox: { inbox: res.inbox, sent: res.sent }, held: res.held, still_missing: res.stillMissing, fetched_late: res.fetchedLate, marked: res.marked, unmarked: res.unmarked, wiki_day: { total: res.wikiDay.total, unmarked: res.wikiDay.unmarked } },
  });
  return res;
}

export const MAX_JUDGE_PER_RUN = 60;

async function markUnjudged(u: { clientNumber: string; userId: number }, start: Date, end: Date, budget: { late: number; judge?: number }): Promise<number> {
  const { listMarkedSources } = await import('../services/wiki/wikiStore');
  const { suggestForFeedEvent } = await import('../services/triage/triageSuggester');
  const { writeAttentionMark } = await import('../services/triage/triageMarks');
  if (budget.judge === undefined) budget.judge = MAX_JUDGE_PER_RUN;
  const rows: any[] = await (listMarkedSources as any)(u.clientNumber, u.userId, { kinds: ['email'], since: start, until: end });
  const unmarked = rows.filter((r) => !(r.marks ?? []).some((m: any) => m.kind === 'attention'));
  let n = 0;
  for (const r of unmarked) {
    if ((budget.judge ?? 0) <= 0) break;
    const fe = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, client_number AS "clientNumber", user_id AS "userId", source_type AS "sourceType", sender_email AS "senderEmail",
              sender_name AS "senderName", raw_payload AS "rawPayload", created_at AS "createdAt"
         FROM feed_events WHERE client_number = $1 AND user_id = $2 AND source_type = 'gmail' AND source_id = $3 LIMIT 1`,
      u.clientNumber, u.userId, r.externalId,
    ).catch(() => [] as any[]);
    if (!fe[0]) continue; // no feed row: landed by intake (his sent mail is marked own above)
    budget.judge = (budget.judge ?? 0) - 1;
    const it = await suggestForFeedEvent(fe[0]).catch(() => null);
    // A skipped or auto-handled email (self, noise, calendar reply) has no needsYou: it needs nothing from him.
    if (!it) continue;
    // The model was down: NOT judged, so no mark (it must stay in view; countUnmarked keeps showing it).
    if (it.needsYou === undefined && /LLM unavailable/i.test(String(it.rationale ?? ''))) continue;
    const res = await writeAttentionMark(fe[0], it.needsYou === undefined ? { needsYou: false, forYourKnowledge: null } : it);
    if (res === 'marked') n += 1;
  }
  return n;
}

/** His today and yesterday, in his zone. */
export function daysToCheck(now: Date, tz: string): string[] {
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return [fmt(new Date(now.getTime() - 24 * 60 * 60_000)), fmt(now)];
}

export async function runMailboxCensus(now = new Date()): Promise<CensusResult[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, integrationProvider: 'google', integrationStatus: 'active' },
    select: { id: true, clientNumber: true },
  });
  const { getAuthenticatedClient } = await import('../services/integrationService');
  const { readEmail } = await import('../services/adapters/gmailAdapter');
  const { resolveUserTimezone } = await import('../services/userTimezoneService');
  const { google } = await import('googleapis');
  const out: CensusResult[] = [];
  const budget = { late: MAX_LATE_PER_RUN };
  for (const u of users) {
    try {
      const { client } = await getAuthenticatedClient(u.id);
      if (!client) continue;
      const tz = await resolveUserTimezone(u.id).catch(() => 'UTC');
      const deps: CensusDeps = { ids: gmailIdsFor(google.gmail({ version: 'v1', auth: client })), readEmail: readEmail as any };
      for (const day of daysToCheck(now, tz)) {
        const r = await censusDay({ clientNumber: u.clientNumber, userId: u.id }, day, tz, deps, budget);
        out.push(r);
        log.info('mailbox census', { userId: u.id, ...r, fetchedLate: r.fetchedLate.length });
      }
    } catch (e: any) {
      log.warn('mailbox census failed for user', { userId: u.id, error: String(e?.message ?? e).slice(0, 160) });
    }
  }
  return out;
}

export function scheduleMailboxCensus(): void {
  const tick = (): void => {
    void import('./jobRunner')
      .then(({ protectedTick }) => protectedTick('mailbox_census', 'important', () => runMailboxCensus()))
      .catch((e: any) => log.warn('mailbox census tick could not run protected', { error: e?.message?.slice(0, 160) }));
  };
  setTimeout(() => { tick(); setInterval(tick, CENSUS_EVERY_MS); }, 10 * 60_000);
  log.info('mailbox census scheduled', { everyMs: CENSUS_EVERY_MS });
}
