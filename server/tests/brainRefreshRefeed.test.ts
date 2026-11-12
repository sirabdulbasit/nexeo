/**
 * Owner, 11-12 ("how can i refresh the user's memory?", "so everything will feed newly", then "fix and update in
 * Settings-Brain"). Pinned:
 *  REFEED    Brain Refresh and Full Reset start the re-feed (30 days of mail and calendar, people pages rebuilt);
 *            Quick Reset does not.
 *  MEMORY    a re-read event is stored for memory only: status 'skipped', so the item-making sweep (status 'new')
 *            never turns old mail into Action Center items.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const warmUp = vi.fn();
const feedUpdate = vi.fn();
const tx = {
  brainPendingAction: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
  $executeRawUnsafe: async () => 0,
};
vi.mock('../src/db/prisma', () => ({ default: {
  $transaction: async (fn: any) => fn(tx),
  feedEvent: { update: (...a: any[]) => feedUpdate(...a) },
  brainReset: { create: async () => ({}) },
  $executeRawUnsafe: async () => 0,
} }));
vi.mock('../src/services/knowledge/historicalFeedPull', async (orig) => ({
  ...(await (orig as any)()),
  warmUpBrainFromSources: (...a: any[]) => warmUp(...a),
}));

import router from '../src/routes/brainResetRoutes';
import { markHistoryOnly } from '../src/services/knowledge/historicalFeedPull';

const app = express().use(express.json()).use((req: any, _res, next) => { req.user = { id: 2, clientNumber: 'T' }; next(); }).use('/', router);

beforeEach(() => { warmUp.mockReset(); warmUp.mockResolvedValue({ pulls: [], wikiBackfill: {} }); feedUpdate.mockReset(); feedUpdate.mockResolvedValue({}); });
const flush = () => new Promise((r) => setTimeout(r, 20));

describe('Brain Refresh feeds Brain anew', () => {
  it('refresh starts the re-feed for this user and says so', async () => {
    const r = await request(app).post('/brain/reset').send({ tier: 'refresh', confirmation: 'BRAIN REFRESH' });
    expect(r.status).toBe(200);
    expect(r.body.refeed).toBe('started');
    await flush();
    expect(warmUp).toHaveBeenCalledWith('T', 2);
  });
  it('quick reset does not', async () => {
    const r = await request(app).post('/brain/reset').send({ tier: 'quick', confirmation: 'QUICK RESET' });
    expect(r.body.refeed).toBe('none');
    await flush();
    expect(warmUp).not.toHaveBeenCalled();
  });
});

describe('re-read mail is memory only', () => {
  it('marks the event skipped, never new', async () => {
    await markHistoryOnly('fe_1');
    expect(feedUpdate.mock.calls[0][0]).toMatchObject({ where: { id: 'fe_1' }, data: { status: 'skipped' } });
  });
});
