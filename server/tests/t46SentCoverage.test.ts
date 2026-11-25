/**
 * T46 (founder 25 Nov 2026: "Suzi/Nexeo should have same access of Inbox and Sent"). Pinned:
 *  QUERY  the Sent backfill asks Gmail for `after:<date> in:sent`, and a plain re-scribe keeps its date-only query.
 *  CAP    the feed reads Sent at the same per-poll cap as Inbox.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';

const seen = vi.hoisted(() => ({ q: [] as Array<string | undefined> }));
vi.mock('googleapis', () => ({ google: { gmail: () => ({ users: { messages: { list: async (a: any) => { seen.q.push(a.q); return { data: { messages: [] } }; } } } }) } }));
vi.mock('../src/services/integrationService', () => ({ getAuthenticatedClient: async () => ({ client: {} }) }));
vi.mock('../src/db/prisma', () => ({ default: {} }));

import { pullHistoricalFeed } from '../src/services/knowledge/historicalFeedPull';

describe('T46', () => {
  it('QUERY: Sent backfill adds in:sent to the date filter; plain re-scribe is unchanged', async () => {
    seen.q = [];
    await pullHistoricalFeed('T', 2, 'gmail', { gmailDays: 30, gmailQuery: 'in:sent' });
    await pullHistoricalFeed('T', 2, 'gmail', { gmailDays: 30 });
    await pullHistoricalFeed('T', 2, 'gmail', { gmailDays: 0, gmailQuery: 'in:sent' });
    expect(seen.q[0]).toMatch(/^after:\d{4}\/\d{1,2}\/\d{1,2} in:sent$/);
    expect(seen.q[1]).toMatch(/^after:\d{4}\/\d{1,2}\/\d{1,2}$/);
    expect(seen.q[2]).toBe('in:sent');
  });
  it('CAP: Sent is read at the Inbox cap', () => {
    const src = readFileSync(new URL('../src/services/adapters/impl/gmailFeedAdapter.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/const SENT_CAP = perUserCap;/);
    expect(src).toMatch(/getInbox\(u\.id, SENT_CAP, 'in:sent'\)/);
  });
});

describe('T46 pacing (D-312)', () => {
  it('PACE: a quota error waits and retries the same message; other errors count once', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let quotaLeft = 1;
    const gm = await import('googleapis');
    (gm as any).google.gmail = () => ({ users: { messages: {
      list: async () => ({ data: { messages: [{ id: 'a' }, { id: 'b' }] } }),
      get: async ({ id }: any) => { calls.push(id); if (id === 'a' && quotaLeft-- > 0) throw new Error("Quota exceeded for quota metric 'Queries'"); throw new Error('stop here'); },
    } } });
    const p = pullHistoricalFeed('T', 2, 'gmail', { gmailDays: 1, gmailCap: 2, gmailDelayMs: 10 });
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    expect(calls).toEqual(['a', 'a', 'b']);
    expect(r.errors).toBe(2);
  });
});
