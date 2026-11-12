/**
 * CL-078 (2026-11-12, his Action Center screenshot: "Updated 0/1 item", 20 open, the Open tab empty).
 *
 *  DEF-439  bulk Done sent 'done'; the lifecycle only knows 'CLOSED', so every bulk Done was refused.
 *           The route now translates the Action Center's words into lifecycle statuses.
 *  DEF-440  the Open tab asked for status NEW only; triaged items and items held for a date vanished.
 *           "open" now means NEW, TRIAGED and DRAFT. Done still means CLOSED and nothing else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const findMany = vi.fn();
const transitionStatus = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { openItem: { findMany: (...a: any[]) => findMany(...a) } } }));
vi.mock('../src/services/itemLifecycle/lifecycleService', () => ({ transitionStatus: (...a: any[]) => transitionStatus(...a) }));
vi.mock('../src/middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 2, clientNumber: 'T' }; next(); },
}));

import { listItems, toLifecycleStatus } from '../src/services/openItemsService';
import router from '../src/routes/openItemsRoutes';

const app = express().use(express.json()).use('/', router);

beforeEach(() => { vi.clearAllMocks(); findMany.mockResolvedValue([]); transitionStatus.mockResolvedValue({ ok: true }); });

describe('DEF-439 bulk Done reaches the lifecycle as CLOSED', () => {
  it('the Action Center words translate', () => {
    expect(toLifecycleStatus('done')).toBe('CLOSED');
    expect(toLifecycleStatus('snoozed')).toBe('SNOOZED');
    expect(toLifecycleStatus('CLOSED')).toBe('CLOSED');
  });
  it('POST /bulk-transition {target: done} asks the lifecycle for CLOSED and is accepted', async () => {
    const r = await request(app).post('/bulk-transition').send({ ids: ['oi_1'], target: 'done', reason: 'bulk_close_from_action_center' });
    expect(r.status).toBe(200);
    expect(transitionStatus.mock.calls[0][1]).toBe('CLOSED');
    expect(r.body).toMatchObject({ attempted: 1, accepted: 1 });
  });
});

describe('DEF-440 the Open tab shows every item still waiting on him', () => {
  it('open = NEW, TRIAGED and DRAFT', async () => {
    await listItems(2, 'T', { status: 'open' as any });
    const st = findMany.mock.calls[0][0].where.status;
    expect(st.in).toEqual(expect.arrayContaining(['NEW', 'TRIAGED', 'DRAFT']));
  });
  it('done stays CLOSED only', async () => {
    await listItems(2, 'T', { status: 'done' as any });
    const st = findMany.mock.calls[0][0].where.status;
    expect(st.in).toEqual(expect.arrayContaining(['CLOSED']));
    expect(st.in).not.toContain('TRIAGED');
  });
});
