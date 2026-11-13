/**
 * CL-092 / DEF-477 (owner 13 Nov: "Watch, not mine"): a task made from an email that asked someone else carries
 * metadata.watch {person}. It is never chased (lifecycle worker, prompt queue) and is not in his pending-task list.
 */
import { describe, it, expect, vi } from 'vitest';

const rows = [
  { id: 'mine', title: 'Make the Vision Metric Qlik sync run daily', priority: 'high', status: 'TRIAGED', dueDate: null, updatedAt: new Date(), metadata: {} },
  { id: 'watched', title: 'Watch (Nabeel): Resolve pending delivery issue', priority: 'high', status: 'NEW', dueDate: new Date('2026-11-13T12:00:00Z'), updatedAt: new Date(), metadata: { watch: { person: 'Mirza Nabeel Hassan', email: 'mirza.nabeel@tmcltd.com' } } },
];
vi.mock('../src/db/prisma', () => ({ default: { openItem: { findMany: async () => rows }, $queryRawUnsafe: async () => [] } }));
vi.mock('../src/services/suzi/taskHistory', () => ({ statusRowsFor: async () => new Map(), historyOf: () => [], changedAt: () => null, HISTORY_SELECT: {} }));

import { isWatchOnly } from '../src/services/openItems/brainOwnership';
import { listPendingActions } from '../src/services/suzi/suziActions';

describe('CL-092 watch, not mine', () => {
  it('isWatchOnly reads metadata.watch.person', () => {
    expect(isWatchOnly(rows[1])).toBe(true);
    expect(isWatchOnly(rows[0])).toBe(false);
    expect(isWatchOnly({ metadata: { watch: { person: '  ' } } })).toBe(false);
    expect(isWatchOnly({})).toBe(false);
  });
  it('a watched task is not in his pending list (Suzi actions[])', async () => {
    const r = await listPendingActions('TMC-0001', 2, { timezone: 'Asia/Karachi', now: new Date('2026-11-13T14:00:00Z') });
    expect(r.actions.map((a) => a.id)).toEqual(['mine']);
    expect(r.overdue).toBe(0); // the watched one was overdue; it no longer counts against him
  });
});
