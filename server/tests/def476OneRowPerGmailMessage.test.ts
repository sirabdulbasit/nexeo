/**
 * DEF-476 (CL-091): one feed row per Gmail message per user. Before, the dedupe hash covered the whole payload, so
 * a moved field (isUnread) or a second reader's shape (no To/Cc) made a second and third row, and a task from each.
 * Pinned:
 *  - the same message again, with a changed field or another shape, returns `duplicate` with the FIRST row's id;
 *  - address fields the first row lacked are filled in (never overwritten);
 *  - the same message id for ANOTHER user is its own row (per-user mailbox);
 *  - a lookup failure falls through to create (a dropped email is worse than a duplicate).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ rows: [] as any[], updates: [] as any[], throwFind: false }));
vi.mock('../src/db/prisma', () => {
  const feedEvent = {
    findUnique: async () => null,
    findFirst: async ({ where }: any) => {
      if (s.throwFind) throw new Error('db down');
      return s.rows.find((r) => r.clientNumber === where.clientNumber && r.userId === where.userId && r.sourceType === where.sourceType && r.sourceId === where.sourceId) ?? null;
    },
    create: async ({ data }: any) => { const r = { id: `fe${s.rows.length + 1}`, createdAt: new Date(), ...data }; s.rows.push(r); return r; },
    update: async ({ where, data }: any) => { s.updates.push({ where, data }); const r = s.rows.find((x) => x.id === where.id); Object.assign(r, data); return r; },
  };
  const empty = { findMany: async () => [], findFirst: async () => null, findUnique: async () => null, create: async () => ({}), update: async () => ({}), updateMany: async () => ({ count: 0 }), count: async () => 0 };
  const p: any = new Proxy({ feedEvent }, { get: (t: any, k: string) => (k in t ? t[k] : empty) });
  return { __esModule: true, default: p, prisma: p };
});
vi.mock('../src/services/wiki/wikiIntake', () => ({ landFeedItem: async () => ({}) }));

import { ingest } from '../src/services/feed/feedIngestionService';

const thin = { date: 'Tue, 10 Nov 2026 12:47:13 +0500', from: 'muhammad.yousuf@tmcltd.com', fromName: 'Muhammad Yousaf', subject: 'Fwd: REGISTRATION REQUEST FOR GREEN BELT', snippet: 'Dear Basit sb, Please approve the Green Belt.', threadId: 't1', isUnread: true, userRepliedThread: false, userId: 2 };
const full = { ...thin, from: 'Muhammad Yousaf <muhammad.yousuf@tmcltd.com>', to: 'Basit Ahmed <basit.ahmed@tmcltd.com>', cc: '', bcc: '', labels: ['INBOX'] };
const go = (payload: any, userId = 2) => ingest({ clientNumber: 'TMC-0001', sourceType: 'gmail', sourceId: 'm1', userId, payload } as any);

beforeEach(() => { s.rows = []; s.updates = []; s.throwFind = false; });

describe('DEF-476 one row per Gmail message per user', () => {
  it('a second reader with another shape gets the first row, and fills the To it lacked', async () => {
    const a: any = await go(thin);
    const b: any = await go(full);
    expect(a.status).toBe('new');
    expect(b).toMatchObject({ status: 'duplicate', feedEventId: a.feedEventId });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].rawPayload.to).toBe('Basit Ahmed <basit.ahmed@tmcltd.com>');
    expect(s.rows[0].rawPayload.from).toBe('muhammad.yousuf@tmcltd.com'); // never overwritten
  });
  it('a moved field (read now) makes no new row', async () => {
    await go(full);
    const b: any = await go({ ...full, isUnread: false });
    expect(b.status).toBe('duplicate'); expect(s.rows).toHaveLength(1); expect(s.updates.filter((u) => u.data.rawPayload)).toHaveLength(0);
  });
  it('the same message id for another user is that user\'s own row', async () => {
    await go(full, 2);
    const b: any = await go(full, 3);
    expect(b.status).toBe('new'); expect(s.rows).toHaveLength(2);
  });
  it('a failed lookup still stores the email', async () => {
    s.throwFind = true;
    const a: any = await go(full);
    expect(a.status).toBe('new');
  });
});
