/**
 * D-324 (T49; Suzi-Builder 26 Nov 09:59, Nexeo AGREE 27 Nov):
 *  1. task.update {update: "describe", context}: his own task, one line ≤300, old and new kept in the history;
 *     an empty context clears it; a missing context is bad_update; a finished task must be reopened first.
 *  2. Every action carries `context` when the task has one.
 *  3. A due-date suggestion before today is never stored (parseSteps), never shown (packProposals) and a Do it on
 *     one already shown answers stale (checkProposal). The prompt says a meeting's own date is not a deadline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn();
const update = vi.fn();
const exec = vi.fn(async (..._a: any[]) => 1);
vi.mock('../src/db/prisma', () => ({ default: { openItem: { findFirst: (...a: any[]) => findFirst(...a), update: (...a: any[]) => update(...a) }, $executeRawUnsafe: (...a: any[]) => exec(...a), $queryRawUnsafe: vi.fn(async () => []) } }));
vi.mock('../src/services/openItemsService', () => ({ changeStatus: vi.fn(), delegateItem: vi.fn() }));
vi.mock('../src/services/openItems/actionLifecycleService', () => ({ recordActionLifecycleReply: vi.fn() }));
vi.mock('../src/services/suzi/suziPeople', () => ({ personById: vi.fn() }));
const trailPush = vi.fn(async (..._a: any[]) => undefined);
vi.mock('../src/services/suzi/suziTaskTrail', async () => ({ ...(await vi.importActual<any>('../src/services/suzi/suziTaskTrail')), trailPush: (...a: any[]) => trailPush(...a) }));

import { applyFollowUp } from '../src/services/suzi/suziActions';
import { parseSteps, SYSTEM } from '../src/services/suzi/assistantReasoner';
import { packProposals, checkProposal } from '../src/services/suzi/proposals';

const item = (status: string, metadata: any = {}) => findFirst.mockResolvedValue({ id: 'a1', title: 'T', priority: 'high', status, dueDate: null, notes: [], metadata });

beforeEach(() => { for (const f of [findFirst, update, exec, trailPush]) f.mockReset(); });

describe('D-324 describe', () => {
  it('SETS: the description is written, history keeps old and new', async () => {
    item('NEW', { context: 'old words' });
    const r = await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'describe', context: '  Vision Metrics   with PMO ' });
    expect(r.ok).toBe(true);
    expect((r as any).action.context).toBe('old words'); // the card's context comes from metadata.context
    expect(exec).toHaveBeenCalledWith(expect.stringContaining("'{context}'"), 'a1', 'Vision Metrics with PMO');
    expect(trailPush).toHaveBeenCalledWith('a1', { who: 'you, through Suzi', change: 'Description changed', note: 'old words → Vision Metrics with PMO' });
  });
  it('CLEARS and CUTS: empty clears, longer than 300 is cut; the same text writes nothing', async () => {
    item('NEW', { context: 'x' });
    await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'describe', context: '' });
    expect(exec).toHaveBeenCalledWith(expect.stringContaining("- 'context'"), 'a1', '');
    exec.mockReset(); item('NEW', {});
    await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'describe', context: 'y'.repeat(400) });
    expect(exec.mock.calls[0][2]).toHaveLength(300);
    exec.mockReset(); trailPush.mockReset(); item('NEW', { context: 'same' });
    await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'describe', context: 'same' });
    expect(exec).not.toHaveBeenCalled(); expect(trailPush).not.toHaveBeenCalled();
  });
  it('REFUSES: no context is bad_update; a finished task is bad_state; not his is not_found', async () => {
    item('NEW');
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'describe' })).toMatchObject({ ok: false, error: 'bad_update' });
    item('CLOSED');
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'describe', context: 'x' })).toMatchObject({ ok: false, error: 'bad_state' });
    findFirst.mockResolvedValue(null);
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'zz', update: 'describe', context: 'x' })).toEqual({ ok: false, error: 'not_found' });
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('D-324 no past due dates', () => {
  const ids = new Set(['t1']);
  const raw = (value: string) => JSON.stringify({ steps: [{ act: 'propose', task_id: 't1', change: 'due', value, why: 'Sofia wrote' }] });
  it('NOT STORED: a past date is dropped, today and later are kept', () => {
    expect(parseSteps(raw('2026-11-16'), ids, false, '2026-11-26')).toEqual([]);
    expect(parseSteps(raw('2026-11-26'), ids, false, '2026-11-26')).toHaveLength(1);
    expect(parseSteps(raw('2026-12-01'), ids, false, '2026-11-26')).toHaveLength(1);
  });
  it('PROMPT: a meeting date is not a deadline; never before today', () => {
    expect(SYSTEM).toMatch(/meeting's or an invitation's own date is NOT a task's deadline/);
    expect(SYSTEM).toMatch(/never a date before today/);
  });
  it('NOT SHOWN: the 16 Nov suggestion of 25 Nov is withdrawn on 26 Nov; done is unaffected', () => {
    const meta = { proposals: [
      { id: 'p16', change: 'due', value: '2026-11-16', why: 'w', from: { email_id: 'e', direction: 'in' }, at: '2026-11-25T11:58:11Z' },
      { id: 'pd', change: 'done', value: null, why: 'w', from: { email_id: 'e', direction: 'in' }, at: '2026-11-25T10:00:00Z' },
    ] };
    expect(packProposals('t1', 'DELEGATED', meta, '2026-11-26').map((p) => p.id)).toEqual(['pd']);
    expect(packProposals('t1', 'DELEGATED', meta, '2026-11-10').map((p) => p.id)).toEqual(['p16', 'pd']);
  });
  it('STALE: Do it on a due date that has passed changes nothing', () => {
    const it = { id: 't1', status: 'TRIAGED', dueDate: null, metadata: { proposals: [{ id: 'p', change: 'due', value: '2020-01-01', why: 'w', from: { email_id: 'e', direction: 'in' }, at: 'x' }] } };
    expect(checkProposal(it, 'p', 'move')).toBe('stale');
  });
});
