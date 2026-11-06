/**
 * Link T25 (both AGREE, 6 Nov 2026): a task's history, and `changed_at` on pack actions. Pinned:
 *  1. history comes from status changes, assigns, due moves, notes, replies and Nexeo's follow-ups,
 *     newest first, at most 20, with who did it;
 *  2. `changed_at` is the latest REAL change: Nexeo's own follow-ups never move it (DEF-406, the 14:13:30 case);
 *  3. only his own task (404 otherwise), status history read for this tenant and user;
 *  4. no model.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import path from 'path';

const query = vi.fn();
const itemFind = vi.fn();
const userFindUnique = vi.fn();
vi.mock('../src/db/prisma', () => ({
  default: {
    $queryRawUnsafe: (...a: any[]) => query(...a),
    openItem: { findFirst: (...a: any[]) => itemFind(...a) },
    user: { findUnique: (...a: any[]) => userFindUnique(...a) },
  },
}));
vi.mock('../src/services/suzi/gatewayAdminClient', () => ({ verifyGatewaySecret: async (t: any) => t === 'right-secret' }));

import { historyOf, changedAt, taskHistory, HISTORY_MAX } from '../src/services/suzi/taskHistory';
import router from '../src/routes/suziGatewayRoutes';

const item = {
  createdAt: new Date('2026-11-01T08:00:00Z'),
  delegateeName: 'Ali',
  delegationTrail: [{ delegatedTo: 'Ali', delegatedToEmail: 'a@x', delegatedAt: '2026-11-03T09:00:00Z', note: 'The owner delegated it through Suzi' }],
  notes: [
    { text: 'call him first', at: '2026-11-02T10:00:00Z', by: 'user:2', source: 'suzi' },
    { text: 'status note', at: '2026-11-03T09:00:00Z', action: 'status_changed_to_DELEGATED' },
    { at: '2026-11-04T10:00:00Z', by: 'action_lifecycle', source: 'user', outcome: 'in_progress', summary: 'not yet', delayReason: 'waiting on bank' },
    { at: '2026-11-05T10:00:00Z', source: 'whatsapp_delegatee_reply', from: 'Ali', body: 'Done by Friday' },
  ],
  metadata: { actionLifecycle: {
    commitmentHistory: [{ at: '2026-11-04T10:00:00Z', dueDate: '2026-11-10T12:00:00.000Z', reason: 'waiting on bank', source: 'user' }],
    followUpHistory: [
      { at: '2026-11-06T09:13:30Z', event: 'owner_follow_up', channel: 'brain_prompt', summary: 'asked for status' },
      { at: '2026-11-04T10:00:00Z', event: 'response_received', summary: 'not yet' },
    ],
  } },
};
const status = [{ at: new Date('2026-11-03T09:00:00Z'), from: 'IN_PROGRESS', to: 'DELEGATED', actor: 'user:2', reason: 'Delegating to Ali' }];

beforeEach(() => {
  for (const f of [query, itemFind, userFindUnique]) f.mockReset();
  userFindUnique.mockResolvedValue({ clientNumber: 'TMC-0001', isActive: true });
});

describe('history', () => {
  it('every source, newest first, with who', () => {
    const h = historyOf(item, status, 2);
    expect(h.map((e) => [e.at.slice(0, 16), e.who, e.change])).toEqual([
      ['2026-11-06T09:13', 'Nexeo', 'Nexeo followed up (brain_prompt)'],
      ['2026-11-05T10:00', 'Ali', 'Replied'],
      ['2026-11-04T10:00', 'you', 'Due moved to 2026-11-10'],
      ['2026-11-04T10:00', 'you', 'Answered: in progress'],
      ['2026-11-03T09:00', 'you', 'Status: in progress → delegated'],
      ['2026-11-03T09:00', 'you', 'Assigned to Ali'],
      ['2026-11-02T10:00', 'you, through Suzi', 'Note'],
      ['2026-11-01T08:00', 'Nexeo', 'Created'],
    ].map(([a, b, c]) => [a, b, c]).sort((x, y) => (x[0] < y[0] ? 1 : x[0] > y[0] ? -1 : 0)) as any);
    expect(h.find((e) => e.change === 'Replied')?.note).toBe('Done by Friday');
    // The `action` note repeats the status change and the `response_received` event repeats the answer: neither appears twice.
    expect(h.filter((e) => e.at.startsWith('2026-11-03T09:00'))).toHaveLength(2);
    expect(h.filter((e) => e.at.startsWith('2026-11-04T10:00'))).toHaveLength(2);
  });
  it('someone else\'s actor is "a colleague", a system actor is Nexeo', () => {
    const h = historyOf({ createdAt: null }, [
      { at: new Date('2026-11-03T09:00:00Z'), from: 'NEW', to: 'TRIAGED', actor: 'user:9', reason: null },
      { at: new Date('2026-11-03T10:00:00Z'), from: 'TRIAGED', to: 'IN_PROGRESS', actor: 'agent:lifecycle', reason: null },
    ], 2);
    expect(h.map((e) => e.who)).toEqual(['Nexeo', 'a colleague']);
  });
  it('at most 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ text: `n${i}`, at: new Date(Date.UTC(2026, 10, 1, i % 24, i)).toISOString(), by: 'user:2' }));
    expect(historyOf({ notes: many }, [], 2)).toHaveLength(HISTORY_MAX);
  });
});

describe('Nexeo\'s repeats', () => {
  it('the same Nexeo step is one line with a count, so real events still show', () => {
    const escalations = Array.from({ length: 30 }, (_, i) => ({ at: new Date(Date.UTC(2026, 10, 5, i % 24, i)).toISOString(), event: 'owner_escalated' }));
    const h = historyOf({ createdAt: new Date('2026-11-01T08:00:00Z'), notes: [{ text: 'mine', at: '2026-11-02T10:00:00Z', by: 'user:2' }], metadata: { actionLifecycle: { followUpHistory: escalations } } }, [], 2);
    expect(h.map((e) => e.change)).toEqual(['Nexeo escalated it (30 times)', 'Note', 'Created']);
    expect(h[0].at).toBe(new Date(Math.max(...escalations.map((e) => Date.parse(e.at)))).toISOString());
  });
});

describe('changed_at', () => {
  it('Nexeo\'s own follow-up at 14:13:30 PKT does not move it; the delegate\'s reply does', () => {
    expect(changedAt(item, status, 2)?.toISOString()).toBe('2026-11-05T10:00:00.000Z');
  });
  it('with nothing but Nexeo\'s bookkeeping, it is the creation time', () => {
    const only = { createdAt: new Date('2026-11-01T08:00:00Z'), metadata: { actionLifecycle: { followUpHistory: item.metadata.actionLifecycle.followUpHistory } } };
    expect(changedAt(only, [], 2)?.toISOString()).toBe('2026-11-01T08:00:00.000Z');
  });
});

describe('his own task only', () => {
  it('not found when it is not his; status history read for this tenant and user', async () => {
    itemFind.mockResolvedValue(null);
    expect(await taskHistory('T', 2, 'x')).toMatchObject({ ok: false, error: 'not_found' });
    expect(itemFind.mock.calls[0][0].where).toEqual({ id: 'x', clientNumber: 'T', userId: 2 });
    itemFind.mockResolvedValue(item);
    query.mockResolvedValue([]);
    const r: any = await taskHistory('T', 2, 'x');
    expect(r.checked).toBe(true);
    expect(query.mock.calls[0][0]).toContain('client_number = $1 AND user_id = $2');
    expect(query.mock.calls[0].slice(1)).toEqual(['T', 2, ['x']]);
  });
  it('a status history that can\'t be read: checked false, the rest still shown', async () => {
    itemFind.mockResolvedValue(item);
    query.mockRejectedValue(new Error('db'));
    const r: any = await taskHistory('T', 2, 'x');
    expect(r.checked).toBe(false);
    expect(r.history.length).toBeGreaterThan(0);
  });
});

describe('the route', () => {
  const app = express();
  app.use(express.json());
  app.use('/g', router);
  const q = 'user_id=2&tenant_id=TMC-0001';
  it('the agreed shape; 404 as {error: {code, message}}; no id is 400', async () => {
    itemFind.mockResolvedValue(item);
    query.mockResolvedValue([]);
    const r = await request(app).get(`/g/task-history?${q}&id=x`).set('Authorization', 'Bearer right-secret');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['checked', 'history']);
    expect(Object.keys(r.body.history[0]).sort()).toEqual(['at', 'change', 'note', 'who']);
    itemFind.mockResolvedValue(null);
    const nf = await request(app).get(`/g/task-history?${q}&id=x`).set('Authorization', 'Bearer right-secret');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('not_found');
    expect((await request(app).get(`/g/task-history?${q}`).set('Authorization', 'Bearer right-secret')).status).toBe(400);
  });
});

describe('no model', () => {
  it('taskHistory.ts calls no LLM', () => {
    expect(readFileSync(path.join(__dirname, '../src/services/suzi/taskHistory.ts'), 'utf8')).not.toMatch(/callLLM|llmRouter|gemini/i);
  });
});
