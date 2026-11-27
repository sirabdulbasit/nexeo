/**
 * D-339c (founder 27 Nov, "keep it simple"): Settings -> Open Items offers one cleanup choice, "finished items".
 * Pinned: finished = closed/done/archived + CANCELLED + stale, for this user only; the old scopes still mean what
 * they meant (closed never takes CANCELLED); "all" stays the only way to touch active items.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/middleware/auth', () => ({ requireAuth: (_q: any, _r: any, n: any) => n() }));
vi.mock('../src/services/userProfileService', () => ({ getUserProfile: vi.fn(), updateUserProfile: vi.fn() }));

import { buildPurgeWhereAndPhrase } from '../src/routes/profileRoutes';

describe('finished items', () => {
  it('takes closed, cancelled and stale items of this user only, never active ones', () => {
    const r = buildPurgeWhereAndPhrase(2, 'TMC-0001', false, { finished: true });
    expect(r.isNuclear).toBe(false);
    expect(r.where.userId).toBe(2);
    expect(r.where.clientNumber).toBeUndefined();
    const statuses = r.where.OR.find((c: any) => c.status)?.status.in;
    expect(statuses).toEqual(expect.arrayContaining(['CLOSED', 'DONE', 'ARCHIVED', 'CANCELLED', 'cancelled']));
    for (const active of ['NEW', 'TRIAGED', 'DELEGATED', 'DRAFT']) expect(statuses).not.toContain(active);
    expect(r.where.OR).toContainEqual({ metadata: { path: ['stale'], equals: true } });
    expect(r.phrase(374)).toBe('PURGE 374 ITEMS');
  });
  it('the old "closed" scope still never takes cancelled items', () => {
    const r = buildPurgeWhereAndPhrase(2, 'T', false, { closed: true });
    expect(r.where.OR[0].status.in).not.toContain('CANCELLED');
  });
  it('nothing chosen chooses nothing; "all" is the only scope with active items', () => {
    expect(buildPurgeWhereAndPhrase(2, 'T', false, {}).where.OR).toEqual([]);
    const all = buildPurgeWhereAndPhrase(2, 'T', false, { all: true });
    expect(all.isNuclear).toBe(true);
    expect(all.where).toEqual({ userId: 2 });
  });
});
