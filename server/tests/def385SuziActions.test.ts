/**
 * DEF-385 (CL-063) — the Action Center for Suzi, and a brief that never fails over one source.
 *
 * Pinned:
 *  1. only the user's OWN item is touched: another user's or tenant's id is not_found;
 *  2. done goes through recordActionLifecycleReply as the OWNER's answer (source 'user', a
 *     given interpretation, no model): the one implementation of "his done is the approval";
 *     a refused close is reported as rejected, never as done;
 *  3. cancel goes through changeStatus CANCELLED with the user as actor;
 *  4. move needs a real YYYY-MM-DD; not_yet is recorded as a response;
 *  5. the brief lists a source it could not use in `missing`, with how to reconnect, and a
 *     calendar read that throws drops only the calendar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn();
const findMany = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { openItem: { findFirst: (...a: any[]) => findFirst(...a), findMany: (...a: any[]) => findMany(...a) } } }));
const changeStatus = vi.fn();
vi.mock('../src/services/openItemsService', () => ({ changeStatus: (...a: any[]) => changeStatus(...a) }));
const lifecycle = vi.fn();
vi.mock('../src/services/openItems/actionLifecycleService', () => ({ recordActionLifecycleReply: (...a: any[]) => lifecycle(...a) }));

import { applyFollowUp, listPendingActions } from '../src/services/suzi/suziActions';

beforeEach(() => {
  findFirst.mockReset(); findMany.mockReset(); changeStatus.mockReset(); lifecycle.mockReset();
  findFirst.mockResolvedValue({ id: 'a1', title: 'Submit Goals-26', priority: 'critical', status: 'CLOSED', dueDate: null });
  lifecycle.mockResolvedValue({ handled: true, closed: true });
});

describe('DEF-385 Suzi follow-ups', () => {
  it('only the user\'s own item: the lookup is scoped by tenant AND user', async () => {
    findFirst.mockResolvedValueOnce(null);
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'someone-elses', update: 'done' })).toEqual({ ok: false, error: 'not_found' });
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'someone-elses', clientNumber: 'TMC-0001', userId: 2 });
    expect(lifecycle).not.toHaveBeenCalled();
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it('done = the owner\'s own answer through the one lifecycle path, no model guess', async () => {
    const r = await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'done' });
    expect(r.ok).toBe(true);
    const call = lifecycle.mock.calls[0][0];
    expect(call).toMatchObject({ openItemId: 'a1', clientNumber: 'TMC-0001', source: 'user', sourceId: 'suzi' });
    expect(call.interpretation).toMatchObject({ outcome: 'completed', confidence: 1, completionEvidence: 'The owner told Suzi it is done' });
  });

  it('a refused close is reported as rejected, never as done', async () => {
    lifecycle.mockResolvedValueOnce({ handled: true, closed: false, closeBlocked: 'guards failed: resolution_reason' });
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'done' })).toEqual({ ok: false, error: 'rejected', detail: 'guards failed: resolution_reason' });
  });

  it('cancel → changeStatus CANCELLED, the user as actor', async () => {
    await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'cancel', note: 'no longer needed' });
    expect(changeStatus).toHaveBeenCalledWith('a1', 'TMC-0001', 'CANCELLED', expect.stringContaining('no longer needed'), 'user:2');
    expect(lifecycle).not.toHaveBeenCalled();
  });

  it('move needs a real date; not_yet is kept as a response', async () => {
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'move', due: 'Friday' })).toEqual({ ok: false, error: 'bad_date' });
    expect(await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'delete' })).toEqual({ ok: false, error: 'bad_update' });
    await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'move', due: '2026-11-07' });
    expect(lifecycle.mock.calls[0][0].interpretation.newDeadline.toISOString()).toBe('2026-11-07T12:00:00.000Z');
    await applyFollowUp('TMC-0001', 2, { actionId: 'a1', update: 'not_yet' });
    expect(lifecycle.mock.calls[1][0].interpretation).toMatchObject({ outcome: 'in_progress', newDeadline: null, delayReason: 'not yet' });
  });

  it('the pending list is most urgent first, with overdue flagged in the user\'s zone', async () => {
    findMany.mockResolvedValue([
      { id: 'l', title: 'low one', priority: 'low', status: 'NEW', dueDate: null },
      { id: 'c', title: 'critical one', priority: 'critical', status: 'NEW', dueDate: new Date('2026-05-31T00:00:00Z') },
    ]);
    const r = await listPendingActions('TMC-0001', 2, { now: new Date('2026-11-03T08:00:00Z') });
    expect(r.actions.map((a) => a.id)).toEqual(['c', 'l']);
    expect(r).toMatchObject({ total: 2, overdue: 1 });
    expect(findMany.mock.calls[0][0].where).toMatchObject({ clientNumber: 'TMC-0001', userId: 2 });
  });
});

describe('DEF-385 one source down never fails the brief', () => {
  it('missing sources are listed with how to reconnect; a calendar read that throws drops only the calendar', async () => {
    const fs = await import('fs'); const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/services/suzi/dayBriefFacts.ts'), 'utf8');
    expect(src).toContain("if (!calendar) missing.push({ source: 'calendar'");
    expect(src).toContain("calendar: 'Nexeo web → Connectors → Google Calendar (or Outlook Calendar) → Connect'");
    expect(src).toMatch(/catch \{\s*calendar = false;\s*missing\.push\(\{ source: 'calendar', status: 'error' \}\);/);
    expect(src).toContain("missing.push({ source: 'actions', status: 'error' })");
    expect(src).not.toMatch(/\bsay\s*:/);
  });
});
