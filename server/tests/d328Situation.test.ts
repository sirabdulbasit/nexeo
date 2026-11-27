/**
 * D-328 (T48, Suzi-Builder 26 Nov 12:51; AGREE in T49). Founder: "Suzi/Nexeo should know everything: what is new, what
 * has been done/sent and what should be done."
 * Pinned (situation.ts, pure):
 *  1. NEW: only after his last look; with no look on record, the last day; his own changes are not news; newest first.
 *  2. DONE: today and yesterday only, with who did it, the kind mapped, and `to` from the person.
 *  3. TO DO: ranked on one scale: his overdue task > a critical reply > his task due today > someone's overdue task >
 *     a normal reply > due tomorrow > no deadline; each with why and risk; an item serving a goal rises and says which.
 *  4. ADVICE: at most 3, passed through as stored.
 *  5. seen.update and advice.feedback are internal ops in ACT_OPS.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/db/prisma', () => ({ default: {} }));
import { buildSituation, situationNew, situationDone, situationToDo, type SituationParts } from '../src/services/suzi/situation';
import { ACT_OPS } from '../src/services/suzi/suziAct';

const now = new Date('2026-11-27T06:00:00Z'); // 11:00 PKT
const act = (id: string, o: any = {}): any => ({ id, title: `Task ${id}`, owner: 'me', priority: 'medium', status: 'TRIAGED', due: null, overdue: false, updated_at: null, changed_at: null, ...o });
const mail = (id: string, o: any = {}): any => ({ thread_id: id, from: 'Ali', subject: `S ${id}`, preview: '', received_at: '2026-11-27T09:00:00+05:00', urgency: 'normal', ...o });
const P = (o: Partial<SituationParts> = {}): SituationParts => ({ now, asOf: '2026-11-27T11:00:00+05:00', today: '2026-11-27', seenAt: null, actions: [], emails: [], fyi: [], proposals: [], recorded: [], decisions: [], ...o });

describe('D-328 situation', () => {
  it('NEW: after his last look only; his own change is not news; newest first', () => {
    const p = P({
      seenAt: new Date('2026-11-27T04:30:00Z'), // 09:30 PKT
      emails: [mail('old', { received_at: '2026-11-27T09:00:00+05:00' }), mail('fresh', { received_at: '2026-11-27T10:15:00+05:00' })],
      actions: [
        act('t1', { last_update: { change: 'Replied', who: 'Sofia Rana', at: '2026-11-27T10:40:00+05:00' } }),
        act('t2', { last_update: { change: 'Renamed', who: 'you, through Suzi', at: '2026-11-27T10:50:00+05:00' } }),
      ],
      recorded: [{ meeting_id: 'm1', title: 'PMO sync', start: null, end: null, outcome: 'record_ready', action_items_proposed: 2, updated_at: '2026-11-27T10:00:00+05:00' }],
    });
    const n = situationNew(p);
    expect(n.map((x) => `${x.kind}:${x.ref.task_id ?? x.ref.thread_id ?? x.ref.meeting_id}`)).toEqual(['reply:t1', 'email:fresh', 'meeting_record:m1']);
    expect(n[2].what).toBe('The record of "PMO sync" is ready, 2 action items proposed');
  });
  it('NEW: never looked → the last day, not everything', () => {
    const n = situationNew(P({ emails: [mail('a', { received_at: '2026-11-26T12:00:00+05:00' }), mail('b', { received_at: '2026-11-24T12:00:00+05:00' })] }));
    expect(n.map((x) => x.ref.thread_id)).toEqual(['a']);
  });
  it('DONE: today and yesterday, who did it, kind mapped, to = the person', () => {
    const d = situationDone(P({ decisions: [
      { at: '2026-11-27T09:00:00+05:00', kind: 'replied', by: 'him', about: { id: '3666', person: 'sofia@x.com' }, what: 'Sent "X" to sofia@x.com' },
      { at: '2026-11-26T15:00:00+05:00', kind: 'rule_delegated', by: 'nexeo', about: { thread_id: 'th', person: 'Ali' }, what: 'Forwarded "Y" to Ali, by your rule' },
      { at: '2026-11-26T10:00:00+05:00', kind: 'rule_set', by: 'him', about: { rule_id: 'r1' }, what: 'New rule' },
      { at: '2026-11-25T10:00:00+05:00', kind: 'done', by: 'him', about: { task_id: 't' }, what: 'older' },
    ] }));
    expect(d.map((x) => `${x.by}:${x.kind}`)).toEqual(['him:sent', 'nexeo:delegated', 'him:decided']);
    expect(d[0]).toMatchObject({ to: 'sofia@x.com', ref: { id: '3666' } });
    expect(d[1].ref).toEqual({ thread_id: 'th' });
  });
  it('TO DO: one scale, with why and risk', () => {
    const t = situationToDo(P({
      actions: [
        act('nodue'), act('tomorrow', { due: '2026-11-28' }), act('today', { due: '2026-11-27' }),
        act('late', { due: '2026-11-24', overdue: true }), act('theirs', { owner: 'Sofia Rana', due: '2026-11-20', overdue: true }),
        act('theirs-ok', { owner: 'Ali', due: '2026-12-05' }),
      ],
      emails: [mail('norm'), mail('crit', { urgency: 'critical', received_at: '2026-11-23T09:00:00+05:00', point: 'Approve the budget' }), mail('ruled', { by_rule: { action: 'ignored', rule_id: 'r', at: 'x' } })],
    }));
    expect(t.map((x) => x.ref.task_id ?? x.ref.thread_id)).toEqual(['late', 'crit', 'today', 'theirs', 'norm', 'tomorrow', 'nodue']);
    expect(t.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(t[0]).toMatchObject({ why: 'Yours, due 2026-11-24, 3 days overdue', risk: 'overdue', due: '2026-11-24' });
    expect(t[1]).toMatchObject({ what: 'Reply to Ali: S crit', why: 'Approve the budget. Waiting 4 days', risk: 'waiting_long' });
    expect(t[3]).toMatchObject({ what: 'Follow up with Sofia Rana: Task theirs', risk: 'slipping' });
    expect(t[6].risk).toBe('no_owner');
  });
  it('TO DO: an item that serves a goal rises and says which', () => {
    const base = { actions: [act('today', { due: '2026-11-27' }), act('late1', { owner: 'Ali', due: '2026-11-26', overdue: true })] };
    expect(situationToDo(P(base)).map((x) => x.ref.task_id)).toEqual(['today', 'late1']);
    const g = situationToDo(P({ ...base, goals: new Map([['task:late1', 'Close the PMO backlog']]) }));
    expect(g[0]).toMatchObject({ ref: { task_id: 'late1' }, goal: 'Close the PMO backlog' });
  });
  it('ADVICE: at most 3, as stored; the whole picture has its five parts', () => {
    const adv = [1, 2, 3, 4].map((n) => ({ id: `a${n}`, what: `w${n}`, why: 'y', rests_on: ['task:t'] }));
    const s = buildSituation(P({ advice: adv, seenAt: new Date('2026-11-27T04:30:00Z') }));
    expect(s.advice.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    expect(Object.keys(s)).toEqual(['as_of', 'seen_at', 'new', 'done', 'to_do', 'advice']);
    expect(s.seen_at).toBe('2026-11-27T04:30:00.000Z');
  });
  it('OPS: seen.update, advice.feedback and job.run_now are known ops', () => {
    for (const op of ['seen.update', 'advice.feedback', 'job.run_now']) expect(ACT_OPS as readonly string[]).toContain(op);
  });
});
