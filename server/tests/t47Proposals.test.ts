/**
 * D-322, T47 proposals under Suzi-Builder's six conditions (AGREE 25 Nov 14:28). Pinned:
 *  WHY     names who, the date and the subject, with the quote ("You" for his own mail).
 *  SHOWN   open tasks only; done and due only; dismissed/done hidden; newest first; at most 3; args carry proposal_id.
 *  CHECK   go / replay (already done) / stale (task closed, or already on that date, or dismissed) / unknown.
 *  LEARNT  a dismissed change on a task is never proposed again.
 */
import { describe, it, expect } from 'vitest';
import { evidenceWhy, packProposals, checkProposal, wasDismissed } from '../src/services/suzi/proposals';

const P = (id: string, change: string, value: string | null, at: string, state?: string) => ({ id, change, value, why: `w${id}`, from: { email_id: 'm', direction: 'in' }, at, ...(state ? { state } : {}) });

describe('D-322 proposals', () => {
  it('WHY: who, date, subject and quote', () => {
    expect(evidenceWhy({ sent: false, fromRaw: '"Sofia Rana" <sofia@x.com>', subject: 'Re: Q4 deck', date: new Date('2026-11-24T06:00:00Z'), quote: 'done, sent the deck' }))
      .toBe('Sofia Rana wrote on 24 Nov "done, sent the deck" (Re: Q4 deck)');
    expect(evidenceWhy({ sent: true, fromRaw: 'me@x.com', subject: null, date: null, quote: '"moving to Monday"' }))
      .toBe('You wrote "moving to Monday"');
  });
  it('SHOWN: open only, done/due only, hidden when handled, newest first, max 3, proposal_id in args', () => {
    const meta = { proposals: [
      P('a', 'done', null, '2026-11-25T01:00:00Z'), P('b', 'due', '2026-12-01', '2026-11-25T05:00:00Z'),
      P('c', 'lead', 'Ali', '2026-11-25T06:00:00Z'), P('d', 'due', 'soon', '2026-11-25T07:00:00Z'),
      P('e', 'done', null, '2026-11-25T08:00:00Z', 'dismissed'), P('f', 'due', '2026-12-02', '2026-11-25T03:00:00Z'),
      P('g', 'due', '2026-12-03', '2026-11-25T02:00:00Z'),
    ] };
    const shown = packProposals('t1', 'TRIAGED', meta);
    expect(shown.map((x) => x.id)).toEqual(['b', 'f', 'g']);
    expect(shown[0]).toMatchObject({ op: 'task.update', args: { id: 't1', update: 'move', due: '2026-12-01', proposal_id: 'b' } });
    expect(packProposals('t1', 'TRIAGED', { proposals: [P('a', 'done', null, 'x')] })[0].args).toEqual({ id: 't1', update: 'done', proposal_id: 'a' });
    expect(packProposals('t1', 'COMPLETED', meta)).toEqual([]);
  });
  it('CHECK: go, replay, stale and unknown', () => {
    const item = (status: string, due: string | null, ps: any[]) => ({ id: 't1', status, dueDate: due ? new Date(`${due}T12:00:00Z`) : null, metadata: { proposals: ps } });
    expect(checkProposal(item('TRIAGED', null, [P('a', 'done', null, 'x')]), 'a', 'done')).toBe('go');
    expect(checkProposal(item('TRIAGED', null, [P('a', 'done', null, 'x', 'done')]), 'a', 'done')).toBe('replay');
    expect(checkProposal(item('COMPLETED', null, [P('a', 'done', null, 'x')]), 'a', 'done')).toBe('stale');
    expect(checkProposal(item('TRIAGED', '2026-12-01', [P('b', 'due', '2026-12-01', 'x')]), 'b', 'move')).toBe('stale');
    expect(checkProposal(item('TRIAGED', null, [P('a', 'done', null, 'x', 'dismissed')]), 'a', 'done')).toBe('stale');
    expect(checkProposal(item('TRIAGED', null, [P('a', 'done', null, 'x')]), 'a', 'move')).toBe('unknown');
    expect(checkProposal(item('TRIAGED', null, []), 'zz', 'done')).toBe('unknown');
  });
  it('LEARNT: a dismissed change is not proposed again on that task', () => {
    expect(wasDismissed({ proposals: [P('a', 'done', null, 'x', 'dismissed')] }, 'done')).toBe(true);
    expect(wasDismissed({ proposals: [P('a', 'done', null, 'x', 'dismissed')] }, 'due')).toBe(false);
    expect(wasDismissed({}, 'done')).toBe(false);
  });
});
