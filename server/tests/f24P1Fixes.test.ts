/**
 * F-2.4 outside review P1-1..5 (Wiki session check, 13 Nov 17:40). Auto-forward stays OFF until these are proven.
 *  P1-1  "internal" = the client's own users' domains, never a shared provider (gmail.com is not his company);
 *  P1-2  the To line is parsed into exact mailboxes (no substring match: "xbasit@tmc.com" is not "basit@tmc.com");
 *  P1-3  a daily count that cannot be read holds forwarding (fail closed, never reopens the cap);
 *  P1-4  "today" is his own day, in his time zone (the zone is passed to the count; no zone = hold);
 *  P1-5  a 7-day window, and only email newer than the rule (a held or capped email does not age out in 24 h).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let companyUsers: any[] = [];
let sentToday: any = [{ n: 0 }];
let tz: string | null = 'Asia/Karachi';
let feed: any[] = [];
const queries: Array<{ sql: string; args: any[] }> = [];
const delegated: any[] = [];
const RULE_BORN = new Date('2026-11-10T00:00:00Z');

vi.mock('../src/db/prisma', () => ({
  default: {
    user: { findMany: async (q: any) => (q.where.clientNumber ? companyUsers : [{ id: 2, clientNumber: 'T', email: 'basit@tmc.com', integrationEmail: null }]) },
    $queryRawUnsafe: async (sql: string, ...args: any[]) => {
      queries.push({ sql, args });
      if (sql.includes('count(*)')) { if (sentToday instanceof Error) throw sentToday; return sentToday; }
      if (sql.includes('FROM user_action_rules')) return [{ id: 'r1', created_at: RULE_BORN }];
      return feed;
    },
  },
}));
vi.mock('../src/services/suzi/suziEmailRules', () => ({
  suziEmailRules: async () => [{ id: 'r1', kind: 'email_delegate', person_id: 'p1' }],
  ruleFor: (rules: any[]) => rules[0],
}));
vi.mock('../src/services/suzi/suziSend', () => ({ maySendForReal: async () => true }));
vi.mock('../src/services/notifications/brainOutboundService', () => ({ outsideOfficeHoursFor: async () => false }));
let person: any = { id: 'p1', name: 'Ali', email: 'ali@tmc.com' };
vi.mock('../src/services/suzi/suziPeople', () => ({ personById: async () => person }));
vi.mock('../src/services/suzi/suziDelegate', () => ({ emailDelegate: async (...a: any[]) => { delegated.push(a[2]); return { ok: true, item: { state: 'held' } }; } }));
vi.mock('../src/services/userTimezoneService', () => ({ resolveUserTimezone: async () => { if (!tz) throw new Error('no tz'); return tz; } }));

import { runRuleForward, mailboxes, companyDomains, eligible, PUBLIC_PROVIDERS } from '../src/jobs/ruleForwardJob';

const mail = (x: any = {}) => ({ id: 'f1', source_id: 'm1', created_at: new Date('2026-11-12T09:00:00Z'), p: { threadId: 't1', from: 'Vendor <v@vendor.com>', to: 'Basit <basit@tmc.com>', subject: 'Quote', ...x } });
beforeEach(() => {
  companyUsers = [{ email: 'basit@tmc.com' }, { email: 'ali@tmc.com' }];
  sentToday = [{ n: 0 }]; tz = 'Asia/Karachi'; feed = [mail()]; person = { id: 'p1', name: 'Ali', email: 'ali@tmc.com' };
  queries.length = 0; delegated.length = 0;
});

describe('P1-2 exact mailboxes', () => {
  it('parses names, angle brackets and lists', () => {
    expect([...mailboxes('"Basit, A" <Basit@TMC.com>, ali@tmc.com; Sara <sara@x.org>')]).toEqual(['basit@tmc.com', 'ali@tmc.com', 'sara@x.org']);
  });
  it('a lookalike address is not his', () => {
    const own = new Set(['basit@tmc.com']);
    const c = { feedId: 'f', messageId: 'm', threadId: 't', from: 'v@vendor.com', cc: '', subject: 's', repliedThread: false };
    expect(eligible({ ...c, to: 'xbasit@tmc.com' }, own)).toBe(false);
    expect(eligible({ ...c, to: 'basit@tmc.com.evil.io' }, own)).toBe(false);
    expect(eligible({ ...c, to: 'Basit <basit@tmc.com>' }, own)).toBe(true);
  });
});

describe('P1-1 his company domain, never a shared provider', () => {
  it('a gmail.com user gives no company domain', async () => {
    companyUsers = [{ email: 'basit@gmail.com' }, { email: 'x@outlook.com' }];
    expect([...(await companyDomains('T'))]).toEqual([]);
    expect(PUBLIC_PROVIDERS.has('gmail.com')).toBe(true);
  });
  it('no company domain: nothing is forwarded', async () => {
    companyUsers = [{ email: 'basit@gmail.com' }];
    const r = await runRuleForward(new Date('2026-11-13T10:00:00Z'));
    expect(r.forwarded).toBe(0); expect(r.skipped.no_company_domain).toBe(1); expect(delegated).toEqual([]);
  });
  it('a recipient on gmail.com is refused even when he is on gmail.com', async () => {
    companyUsers = [{ email: 'basit@tmc.com' }, { email: 'ali@gmail.com' }]; person = { id: 'p1', name: 'Ali', email: 'ali@gmail.com' };
    const r = await runRuleForward(new Date('2026-11-13T10:00:00Z'));
    expect(r.skipped.recipient_not_internal).toBe(1); expect(delegated).toEqual([]);
  });
  it('an internal recipient is forwarded once, with the message id', async () => {
    const r = await runRuleForward(new Date('2026-11-13T10:00:00Z'));
    expect(r.forwarded).toBe(1); expect(delegated[0]).toMatchObject({ message_id: 'm1', rule_id: 'r1', person_id: 'p1' });
  });
});

describe('P1-3 / P1-4 the daily count: his day, fail closed', () => {
  it('a count that cannot be read forwards nothing', async () => {
    sentToday = new Error('db down');
    const r = await runRuleForward(new Date('2026-11-13T10:00:00Z'));
    expect(r.skipped.count_unreadable).toBe(1); expect(delegated).toEqual([]);
  });
  it('the count uses his time zone', async () => {
    await runRuleForward(new Date('2026-11-13T10:00:00Z'));
    const q = queries.find((x) => x.sql.includes('count(*)'))!;
    expect(q.sql).toContain('AT TIME ZONE $3'); expect(q.args[2]).toBe('Asia/Karachi');
  });
  it('no time zone: nothing is forwarded', async () => {
    tz = null;
    const r = await runRuleForward(new Date('2026-11-13T10:00:00Z'));
    expect(r.skipped.timezone_unreadable).toBe(1); expect(delegated).toEqual([]);
  });
  it('the cap reached: nothing more today', async () => {
    sentToday = [{ n: 20 }];
    const r = await runRuleForward(new Date('2026-11-13T10:00:00Z'));
    expect(r.skipped.day_cap).toBe(1); expect(delegated).toEqual([]);
  });
});

describe('P1-5 held or capped email does not age out', () => {
  it('the window is 7 days', async () => {
    const now = new Date('2026-11-13T10:00:00Z');
    await runRuleForward(now);
    const q = queries.find((x) => x.sql.includes('FROM feed_events'))!;
    expect(now.getTime() - new Date(q.args[2]).getTime()).toBe(7 * 24 * 60 * 60_000);
  });
  it('a 3-day-old email (capped yesterday) still forwards', async () => {
    feed = [mail({}), { ...mail(), created_at: new Date('2026-11-10T12:00:00Z') }];
    feed[1].source_id = 'm0';
    const r = await runRuleForward(new Date('2026-11-13T10:00:00Z'));
    expect(r.forwarded).toBe(2);
  });
  it('email older than the rule is never forwarded', async () => {
    feed = [{ ...mail(), created_at: new Date('2026-11-09T12:00:00Z') }];
    const r = await runRuleForward(new Date('2026-11-13T10:00:00Z'));
    expect(r.forwarded).toBe(0); expect(delegated).toEqual([]);
  });
});
