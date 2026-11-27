/**
 * D-327 (T49; Suzi-Builder 26 Nov 12:50 + 12:58). Founder: Suzi thinks from Knowledge, Actions, Rules, Delegations,
 * Past Decisions, Instructions. `rules.delegations` was empty and there were no decisions.
 * Pinned:
 *  1. DECISION: each act becomes one line with its kind, who, and what, from the record only.
 *  2. NOT A DECISION: a held send, a note, a rename, an unknown op → nothing.
 *  3. SUGGESTIONS: Do it with proposal_id is proposal_done with the evidence as why; Dismiss is proposal_dismissed.
 *  4. MERGE: newest first, no line twice, at most the limit.
 *  5. PAGE: grouped by day, He / Suzi / Nexeo.
 *  6. DELEGATIONS: his own delegate rules are in rules.delegations with person, source "rule" and match;
 *     company rows keep their four keys and gain person and source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
const query = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: (...a: any[]) => query(...a) } }));
vi.mock('../src/services/knowledge/instructionService', () => ({ getActiveInstructions: vi.fn(async () => []) }));
const emailRules = vi.fn();
vi.mock('../src/services/suzi/suziEmailRules', () => ({ suziEmailRules: (...a: any[]) => emailRules(...a) }));
import { decisionOf, mergeDecisions, decisionsPageBody, type DecisionContext, type PackDecision } from '../src/services/suzi/decisions';
import { rulesContent, rulesMarkdown } from '../src/services/suzi/suziRules';

const ctx: DecisionContext = {
  subjects: new Map([['th1', 'Tridorian payment reminder']]),
  drafts: new Map([['3666', { to: 'sofia.rana@tmcltd.com', subject: 'Following up: Vision Metrics session' }]]),
  proposals: new Map([['p1', { task_id: 't9', title: 'Implement TMC Systems Catalogue', why: 'Numair wrote on 24 Nov "done"' }]]),
};
const at = new Date('2026-11-25T08:15:00Z');
const D = (op: string, args: any, item: any = {}, confirmed = true) => decisionOf({ op, args, result: { ok: true, item }, at, confirmed }, ctx, 'Asia/Karachi');

describe('D-327 decisions', () => {
  it('DECISION: kind, who and what come from the record', () => {
    expect(D('task.update', { id: 't1', update: 'assign' }, { title: 'Pay Tridorian Invoice', owner: 'Salman Sohail' })).toMatchObject({ kind: 'delegated', by: 'him', about: { task_id: 't1', person: 'Salman Sohail' }, what: 'Gave "Pay Tridorian Invoice" to Salman Sohail' });
    expect(D('task.update', { id: 't1', update: 'move', due: '2026-11-27' }, { title: 'iMEX testing' })!.what).toBe('Moved "iMEX testing" to 2026-11-27');
    expect(D('task.update', { id: 't1', update: 'done' }, { title: 'X' })).toMatchObject({ kind: 'done', at: '2026-11-25T13:15:00+05:00' });
    expect(D('email.send', { draft_id: '3666' }, { sent: true })).toMatchObject({ kind: 'replied', what: 'Sent "Following up: Vision Metrics session" to sofia.rana@tmcltd.com' });
    expect(D('email.forward', { to: 'salman@x.com', thread_id: 'th1' }, { to: 'salman@x.com' })).toMatchObject({ kind: 'delegated', about: { thread_id: 'th1', person: 'salman@x.com' }, what: 'Forwarded "Tridorian payment reminder" to salman@x.com' });
    expect(D('rule.set', { kind: 'email_ignore', match: { by: 'to', value: 'vm@tmcltd.com' } }, { rule_id: 'uar_1' })).toMatchObject({ kind: 'rule_set', about: { rule_id: 'uar_1' }, what: 'New rule: ignore emails sent to vm@tmcltd.com' });
    expect(D('calendar.create', { title: 'ECP Payroll', start: '2026-11-18T17:00:00+05:00' }, { event_id: 'e1' })).toMatchObject({ kind: 'booked', what: 'Booked "ECP Payroll" for 2026-11-18 17:00' });
    expect(D('task.create', { title: 'Complete testing' }, { id: 't5', title: 'Complete testing', owner: 'Muhammad Yousuf' })).toMatchObject({ kind: 'delegated', what: 'Gave Muhammad Yousuf a task: "Complete testing"' });
    expect(D('task.update', { id: 't1', update: 'done' }, { title: 'X' }, false)!.by).toBe('suzi');
  });
  it('NOT A DECISION: held send, note, rename, unknown op', () => {
    expect(D('email.send', { draft_id: '3666' }, { sent: false, held: true })).toBeNull();
    expect(D('email.send', { draft_id: '999' }, { sent: true })).toBeNull(); // nothing on record to say what it was
    expect(D('task.update', { id: 't1', update: 'note', note: 'x' }, { title: 'X' })).toBeNull();
    expect(D('task.update', { id: 't1', update: 'rename', title: 'Y' }, { title: 'Y' })).toBeNull();
    expect(D('meeting.list', {}, {})).toBeNull();
  });
  it('SUGGESTIONS: Do it and Dismiss keep the evidence', () => {
    expect(D('task.update', { id: 't9', update: 'done', proposal_id: 'p1' }, { title: 'Implement TMC Systems Catalogue' })).toMatchObject({ kind: 'proposal_done', why: 'Numair wrote on 24 Nov "done"' });
    expect(D('proposal.dismiss', { id: 'p1' })).toMatchObject({ kind: 'proposal_dismissed', about: { id: 'p1', task_id: 't9' }, what: 'Dismissed a suggestion on "Implement TMC Systems Catalogue"' });
  });
  it('MERGE: newest first, never twice, capped', () => {
    const a: PackDecision = { at: '2026-11-25T10:00:00+05:00', kind: 'done', by: 'him', about: {}, what: 'A' };
    const b: PackDecision = { at: '2026-11-26T10:00:00+05:00', kind: 'done', by: 'nexeo', about: {}, what: 'B' };
    expect(mergeDecisions([[a], [b, { ...a }]]).map((d) => d.what)).toEqual(['B', 'A']);
    expect(mergeDecisions([[a, b]], 1)).toHaveLength(1);
  });
  it('PAGE: by day, with who', () => {
    const body = decisionsPageBody([
      { at: '2026-11-26T10:00:00+05:00', kind: 'rule_delegated', by: 'nexeo', about: { person: 'Ali' }, what: 'Forwarded "X" to Ali, by your rule' },
      { at: '2026-11-25T13:15:00+05:00', kind: 'done', by: 'him', about: {}, what: 'Marked done: "Y"', why: 'he said so' },
    ]);
    expect(body).toContain('## 2026-11-26\n- 10:00 Nexeo: Forwarded "X" to Ali, by your rule');
    expect(body).toContain('## 2026-11-25\n- 13:15 He: Marked done: "Y". Why: he said so');
  });
});

describe('D-327 delegations', () => {
  beforeEach(() => { query.mockReset(); emailRules.mockReset(); });
  it('his delegate rules and the company table, each with person and source', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) return [{ bc: {} }];
      if (sql.includes('FROM delegation_matrix')) return [{ area: 'Finance', owner_name: 'A', owner_email: 'A@x.com', escalate_to_name: null }];
      if (sql.includes('FROM person_facets')) return [{ email: 'a@x.com', id: 'p-a', name: 'A Khan' }];
      return [];
    });
    emailRules.mockResolvedValue([
      { id: 'uar_1', kind: 'email_delegate', by: 'sender', value: 'invoices@xero.com', person_id: 'p-s', person_name: 'Salman Sohail', person_email: 's@x.com' },
      { id: 'uar_2', kind: 'email_ignore', by: 'to', value: 'vm@tmcltd.com' },
    ]);
    const r = await rulesContent('T', 2);
    expect(r.delegations).toEqual([
      { area: 'Finance', owner: 'A', owner_email: 'A@x.com', escalate_to: null, person: { id: 'p-a', name: 'A Khan' }, source: 'company' },
      { area: 'Emails from invoices@xero.com', owner: 'Salman Sohail', owner_email: 's@x.com', escalate_to: null, person: { id: 'p-s', name: 'Salman Sohail' }, source: 'rule', match: 'from invoices@xero.com', rule_id: 'uar_1' },
    ]);
    expect(rulesMarkdown(r)).toContain('- Emails from invoices@xero.com: Salman Sohail (his own rule)');
  });
  it('rules that cannot be read leave the company rows as they are', async () => {
    query.mockImplementation(async (sql: string) => (sql.includes('FROM users') ? [{ bc: {} }] : []));
    emailRules.mockRejectedValue(new Error('down'));
    expect((await rulesContent('T', 2)).delegations).toEqual([]);
  });
});
