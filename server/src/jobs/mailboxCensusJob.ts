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

export interface CensusResult { day: string; inbox: number; sent: number; held: number; fetchedLate: string[]; stillMissing: number; marked: number; unmarked: number }

export async function censusDay(u: { clientNumber: string; userId: number }, day: string, tz: string, deps: CensusDeps, budget: { late: number }): Promise<CensusResult> {
  const { sourceId, sourcesHeld, saveSource } = await import('../services/wiki/wikiSources');
  const { landEmailText } = await import('../services/wiki/wikiIntake');
  const { markSource, countUnmarked } = await import('../services/wiki/wikiStore');
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
    if (sentSet.has(g) && !inbox.includes(g)) {
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
  const held2 = await sourcesHeld(u.clientNumber, u.userId, all.map(sid));
  const counts = await countUnmarked(u.clientNumber, u.userId, 'email', 'attention', start, end).catch(() => ({ total: 0, unmarked: -1 }));
  const res: CensusResult = {
    day, inbox: inbox.length, sent: sent.length, held: held2.size, fetchedLate, stillMissing: all.length - held2.size,
    marked: Math.max(0, counts.total - counts.unmarked), unmarked: counts.unmarked,
  };
  await saveSource({
    clientNumber: u.clientNumber, userId: u.userId, kind: 'record', externalId: `mailbox-census:gmail:${day}`,
    title: `Mailbox check, ${day}`, occurredAt: start,
    body: [
      `Gmail, ${day} (${tz}): ${res.inbox} in the inbox, ${res.sent} sent.`,
      `Held in the Wiki: ${res.held} of ${all.length}${res.stillMissing ? `; still missing: ${res.stillMissing}` : '; none missing'}.`,
      `Landed late by this check: ${res.fetchedLate.length}.`,
      `Marked: ${res.marked}; not yet marked: ${res.unmarked}.`,
    ].join('\n'),
    details: { type: 'mailbox_census', provider: 'gmail', day, tz, in_mailbox: { inbox: res.inbox, sent: res.sent }, held: res.held, still_missing: res.stillMissing, fetched_late: res.fetchedLate, marked: res.marked, unmarked: res.unmarked },
  });
  return res;
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
