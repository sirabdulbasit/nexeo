/**
 * Link T21 (DEF-404): R1 reopen and D1 assign on `task.update`. Pinned:
 *  1. reopen: finished or cancelled → TRIAGED, the owner as actor; an open task is bad_state;
 *  2. the matrix has CLOSED → TRIAGED, owner or agent only; nothing else leaves CLOSED;
 *  3. a finished task refuses done / move / cancel / not_yet / assign until reopened; a note still goes on;
 *  4. assign: only the user's own person, through the matrix from each open state;
 *     no email on record → no_email, and nothing changes;
 *  5. assign tells nobody: no email is sent and `delegation_emailed_at` is never written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const findFirst = vi.fn();
const update = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { openItem: { findFirst: (...a: any[]) => findFirst(...a), update: (...a: any[]) => update(...a) } } }));
const changeStatus = vi.fn();
const delegateItem = vi.fn();
vi.mock('../src/services/openItemsService', () => ({
  changeStatus: (...a: any[]) => changeStatus(...a),
  delegateItem: (...a: any[]) => delegateItem(...a),
}));
const lifecycle = vi.fn();
vi.mock('../src/services/openItems/actionLifecycleService', () => ({ recordActionLifecycleReply: (...a: any[]) => lifecycle(...a) }));
const personById = vi.fn();
vi.mock('../src/services/suzi/suziPeople', () => ({ personById: (...a: any[]) => personById(...a) }));
const sendUserEmail = vi.fn();
vi.mock('../src/services/gmailService', () => ({ sendUserEmail: (...a: any[]) => sendUserEmail(...a) }));

import { applyFollowUp } from '../src/services/suzi/suziActions';
import { allFromTransitions, findTransition } from '../src/services/itemLifecycle/transitionMatrix';

const item = (status: string) => findFirst.mockResolvedValue({ id: 'a1', title: 'T', priority: 'high', status, dueDate: null, notes: [] });

beforeEach(() => {
  for (const f of [findFirst, update, changeStatus, delegateItem, lifecycle, personById, sendUserEmail]) f.mockReset();
  personById.mockResolvedValue({ id: 'p1', name: 'Rafay', email: 'r@x' });
});

describe('R1 reopen', () => {
  it.each(['CLOSED', 'CANCELLED', 'closed'])('%s → TRIAGED, the owner as actor', async (s) => {
    item(s);
    const r = await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'reopen' });
    expect(r.ok).toBe(true);
    expect(changeStatus).toHaveBeenCalledWith('a1', 'TMC-0001', 'TRIAGED', 'The owner reopened it through Suzi', 'user:2');
  });
  it('an open task is bad_state, and nothing changes', async () => {
    item('IN_PROGRESS');
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'reopen' })).toMatchObject({ ok: false, error: 'bad_state' });
    expect(changeStatus).not.toHaveBeenCalled();
  });
  it('another user\'s task is not_found', async () => {
    findFirst.mockResolvedValue(null);
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'x', update: 'reopen' })).toEqual({ ok: false, error: 'not_found' });
  });
  it('the matrix: CLOSED → TRIAGED, owner or agent only, and the only way out of CLOSED', () => {
    expect(findTransition('CLOSED', 'TRIAGED')?.guards).toEqual(['is_owner_or_agent']);
    expect(allFromTransitions('CLOSED').map((t) => t.to)).toEqual(['TRIAGED']);
    expect(findTransition('CLOSED', 'CANCELLED')).toBeUndefined();
  });
});

describe('a finished task', () => {
  it.each(['done', 'cancel', 'not_yet', 'assign'])('refuses %s until reopened', async (u) => {
    item('CLOSED');
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: u, personId: 'p1' })).toMatchObject({ ok: false, error: 'bad_state' });
    expect(changeStatus).not.toHaveBeenCalled();
    expect(lifecycle).not.toHaveBeenCalled();
    expect(delegateItem).not.toHaveBeenCalled();
  });
  it('still takes a note', async () => {
    item('CLOSED');
    expect((await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'note', note: 'it was the other one' })).ok).toBe(true);
    expect(update).toHaveBeenCalled();
  });
});

describe('D1 assign', () => {
  it('only the user\'s own person; an unknown one is not_found and nothing changes', async () => {
    item('TRIAGED');
    personById.mockResolvedValue(null);
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'assign', personId: 'q' })).toMatchObject({ ok: false, error: 'not_found' });
    expect(personById).toHaveBeenCalledWith('TMC-0001', 2, 'q');
    expect(delegateItem).not.toHaveBeenCalled();
  });
  it('no email on record → no_email, and nothing changes', async () => {
    item('TRIAGED');
    personById.mockResolvedValue({ id: 'p1', name: 'Rafay', phone: '+92' });
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'assign', personId: 'p1' })).toMatchObject({ ok: false, error: 'no_email' });
    expect(changeStatus).not.toHaveBeenCalled();
    expect(delegateItem).not.toHaveBeenCalled();
  });
  it.each([
    ['TRIAGED', null], ['IN_PROGRESS', null], ['NEW', 'TRIAGED'], ['SNOOZED', 'TRIAGED'], ['WAITING_INFO', 'IN_PROGRESS'], ['DELEGATED', 'IN_PROGRESS'],
  ])('from %s, through the matrix (first step %s)', async (from, step) => {
    item(from);
    expect((await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'assign', personId: 'p1' })).ok).toBe(true);
    if (step) {
      expect(changeStatus).toHaveBeenCalledWith('a1', 'TMC-0001', step, expect.any(String), 'user:2');
      expect(findTransition(from as any, step as any)).toBeTruthy();
      expect(findTransition(step as any, 'DELEGATED')).toBeTruthy();
    } else {
      expect(changeStatus).not.toHaveBeenCalled();
      expect(findTransition(from as any, 'DELEGATED')).toBeTruthy();
    }
    expect(delegateItem).toHaveBeenCalledWith('a1', 'TMC-0001', null, 'Rafay', 'r@x', 'The owner delegated it through Suzi', 'user:2');
  });
  it('a draft can\'t be delegated here', async () => {
    item('DRAFT');
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'assign', personId: 'p1' })).toMatchObject({ ok: false, error: 'bad_state' });
  });
  it('tells nobody: no email sent, and the "emailed" mark is never written', async () => {
    item('TRIAGED');
    await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'assign', personId: 'p1' });
    expect(sendUserEmail).not.toHaveBeenCalled();
    const code = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const src = code(fs.readFileSync(path.join(__dirname, '../src/services/suzi/suziActions.ts'), 'utf8'));
    expect(src).not.toMatch(/delegationEmailedAt|delegation_emailed_at|sendUserEmail|brainContactsUser/);
    const del = fs.readFileSync(path.join(__dirname, '../src/services/openItemsService.ts'), 'utf8');
    const body = code(del.slice(del.indexOf('export async function delegateItem'), del.indexOf('// ─── Add note')));
    expect(body).not.toMatch(/delegationEmailedAt|sendUserEmail|brainContactsUser/);
  });
});
