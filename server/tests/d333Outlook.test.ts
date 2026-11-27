/**
 * D-333 (T52; founder 27 Nov 11:45 PKT: "keep thinking … what is important, what is pending, what are possible risk
 * now and in future, forecasting, predicting"). Suzi-Builder AGREE 11:44 with four conditions.
 * Pinned (outlook.ts):
 *  1. PREDICTION, NEVER FACT (condition 1): a risk ahead needs a likelihood, a date after today within 45 days, and a
 *     counted signal; without any one of them it is not given. The prompt says so.
 *  2. PREVENT (condition 2): a risk without a prevent action is not given.
 *  3. ONLY SHOWN SIGNALS: rests_on is the signal's own words; an invented key is dropped; at most 5 per list;
 *     most likely and soonest first; what he marked not useful is not repeated.
 *  4. HONEST CHECK (condition 3): after the date, came_true when the task is still open or closed late; prevented
 *     only when it did not happen AND he acted on it in between; otherwise did_not; before the date, or with no item
 *     to check, no outcome.
 *  5. COMPUTED: important is the top of the to-do ranking; pending is oldest first with who and since.
 *  6. COUNTS: predictions made and checked in the week.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/db/prisma', () => ({ default: {} }));
import { parseOutlook, checkPrediction, importantOf, pendingOf, predictionCounts, OUTLOOK_SYSTEM, type Signal, type Prediction, type CheckFacts } from '../src/services/suzi/outlook';

const sig: Signal[] = [
  { key: 's:1', text: 'Task "iMEX testing" is with Muhammad Yousuf, due 2026-12-01 (in 4 days); its deadline has moved 2 times; Muhammad Yousuf\'s 5 finished tasks closed 6.2 days late on average, 1 of 5 on time.', ref: { task_id: 't1' } },
  { key: 's:2', text: 'Over the last 8 weeks 24 tasks were finished (3.0 a week). He has 8 open tasks of his own, 6 of them due within 7 days or overdue; 7 open tasks have no deadline.' },
  { key: 's:3', text: 'An email from Finance @ Tridorian, "Invoice reminder", has waited 4 days for his answer.', ref: { thread_id: 'th1' } },
];
const J = (o: any) => JSON.stringify(o);
const ahead = (o: any = {}) => ({ what: 'iMEX testing is likely to miss 1 December', by: '2026-12-01', likelihood: 'likely', why: 'His tasks close 6.2 days late on average and this deadline moved twice', signals: ['s:1'], prevent: 'Basit: ask Muhammad Yousuf on Monday for a date he commits to', ...o });
const TODAY = '2026-11-27';

describe('D-333 outlook: predictions', () => {
  it('PREDICTION, NEVER FACT: likelihood, a date ahead and a counted signal, or no line', () => {
    const r = parseOutlook(J({ risks_ahead: [
      ahead(),
      ahead({ what: 'No likelihood given for this one', likelihood: 'certain' }),
      ahead({ what: 'A date that has already passed', by: '2026-11-20' }),
      ahead({ what: 'A date that is today, not ahead', by: TODAY }),
      ahead({ what: 'A date far beyond the window', by: '2027-03-01' }),
      ahead({ what: 'No counted pattern behind it', signals: [] }),
      ahead({ what: 'Cites a signal never shown', signals: ['s:9'] }),
    ] }), sig, TODAY);
    expect(r.risks_ahead).toHaveLength(1);
    expect(r.risks_ahead[0]).toMatchObject({ by: '2026-12-01', likelihood: 'likely', ref: { task_id: 't1' }, rests_on: [sig[0].text] });
    expect(OUTLOOK_SYSTEM).toMatch(/PREDICTIONS, never facts/);
    expect(OUTLOOK_SYSTEM).toMatch(/If no pattern supports a prediction, do not make one/);
  });
  it('PREVENT: no action, no risk', () => {
    const r = parseOutlook(J({ risks_ahead: [ahead({ prevent: '' })], risks_now: [{ what: 'Tridorian reminder waits 4 days', why: 'It is due 30 Nov', signals: ['s:3'], prevent: '' }] }), sig, TODAY);
    expect(r.risks_ahead).toEqual([]); expect(r.risks_now).toEqual([]);
  });
  it('SHOWN SIGNALS, ORDER, CAP, NOT USEFUL', () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map((n) => ahead({ what: `Possible slip number ${n}`, likelihood: 'possible', by: `2026-12-1${n}` }));
    const r = parseOutlook(J({
      risks_ahead: [...many, ahead({ what: 'The likely one comes first', by: '2026-12-20' })],
      risks_now: [{ what: 'Tridorian reminder has waited 4 days', why: 'Payment is due on the 30th', signals: ['s:3', 's:77'], prevent: 'Basit: ask Salman today whether INV-4770 is paid' }],
      forecast: [{ what: '6 of his own tasks fall due this week against 3.0 finished a week', period: 'this_week', signals: ['s:2'] }, { what: 'No period given here at all', period: 'someday', signals: ['s:2'] }],
    }), sig, TODAY, ['Possible slip number 1']);
    expect(r.risks_ahead).toHaveLength(5);
    expect(r.risks_ahead.some((x) => x.what === 'Possible slip number 1')).toBe(false);
    expect(r.risks_now[0]).toMatchObject({ ref: { thread_id: 'th1' }, rests_on: [sig[2].text] });
    expect(r.forecast).toHaveLength(1);
    expect(r.forecast[0]).toMatchObject({ period: 'this_week', rests_on: [sig[1].text] });
    const mixed = parseOutlook(J({ risks_ahead: [ahead({ what: 'A possible one, sooner', likelihood: 'possible', by: '2026-11-29' }), ahead({ what: 'The likely one, later', by: '2026-12-05' })] }), sig, TODAY);
    expect(mixed.risks_ahead.map((x) => x.likelihood)).toEqual(['likely', 'possible']);
    expect(parseOutlook('not json', sig, TODAY)).toEqual({ risks_now: [], risks_ahead: [], forecast: [] });
  });
});

describe('D-333 outlook: the honest check', () => {
  const P = (o: Partial<Prediction> = {}): Prediction => ({ id: 'p1', what: 'iMEX testing is likely to miss 1 December', by: '2026-12-01', likelihood: 'likely', ref: { task_id: 't1' }, made_at: '2026-11-27T07:00:00Z', ...o });
  const F = (o: Partial<CheckFacts> = {}): CheckFacts => ({ tasks: new Map(), replied: new Map(), acted: () => false, ...o });
  const after = new Date('2026-12-02T06:00:00Z');
  it('CAME TRUE: still open after the date, or closed late', () => {
    expect(checkPrediction(P(), F({ tasks: new Map([['t1', { open: true, closedAt: null }]]) }), after)).toBe('came_true');
    expect(checkPrediction(P(), F({ tasks: new Map([['t1', { open: false, closedAt: new Date('2026-12-02T03:00:00Z') }]]) }), after)).toBe('came_true');
  });
  it('PREVENTED only with his action in between; otherwise DID NOT', () => {
    const closed = new Map([['t1', { open: false, closedAt: new Date('2026-11-30T08:00:00Z') }]]);
    expect(checkPrediction(P(), F({ tasks: closed }), after)).toBe('did_not');
    expect(checkPrediction(P(), F({ tasks: closed, acted: (ref, since, until) => ref.task_id === 't1' && since.toISOString() === '2026-11-27T07:00:00.000Z' && until.getTime() > since.getTime() }), after)).toBe('prevented');
  });
  it('NO OUTCOME: before the date; an item not found; a prediction about no single item; an email by its reply', () => {
    expect(checkPrediction(P(), F({ tasks: new Map([['t1', { open: true, closedAt: null }]]) }), new Date('2026-12-01T10:00:00Z'))).toBeNull();
    expect(checkPrediction(P(), F(), after)).toBeNull();
    expect(checkPrediction(P({ ref: undefined }), F(), after)).toBeNull();
    const mail = P({ ref: { thread_id: 'th1' } });
    expect(checkPrediction(mail, F({ replied: new Map([['th1', null]]) }), after)).toBe('came_true');
    expect(checkPrediction(mail, F({ replied: new Map([['th1', new Date('2026-11-29T05:00:00Z')]]) }), after)).toBe('did_not');
    expect(checkPrediction(P({ outcome: 'prevented' }), F(), after)).toBe('prevented');
  });
  it('COUNTS: made and checked in the week', () => {
    const from = new Date('2026-11-29T19:00:00Z'); const to = new Date('2026-12-06T19:00:00Z');
    expect(predictionCounts([
      P({ made_at: '2026-11-27T07:00:00Z', outcome: 'came_true', checked_at: '2026-12-02T06:00:00Z' }),
      P({ id: 'p2', made_at: '2026-12-01T07:00:00Z' }),
      P({ id: 'p3', made_at: '2026-11-20T07:00:00Z', outcome: 'prevented', checked_at: '2026-11-25T06:00:00Z' }),
    ], from, to)).toEqual({ made: 1, came_true: 1, did_not: 0, prevented: 0, open: 1 });
  });
});

describe('D-333 outlook: computed lists', () => {
  it('IMPORTANT is the top of the to-do ranking, with its goal', () => {
    const todo = [1, 2, 3, 4, 5, 6].map((n) => ({ rank: n, what: `Do ${n}`, why: `why ${n}`, ref: { task_id: `t${n}` }, ...(n === 2 ? { goal: 'Close the PMO backlog' } : {}) }));
    const i = importantOf(todo);
    expect(i.map((x) => x.what)).toEqual(['Do 1', 'Do 2', 'Do 3', 'Do 4', 'Do 5']);
    expect(i[1]).toMatchObject({ ref: { task_id: 't2' }, goal: 'Close the PMO backlog' });
  });
  it('PENDING is oldest first, with who and since', () => {
    const p = pendingOf([
      { id: 't2', title: 'Share the calculation sheet', who: 'Syeda Uzma Shah', since: new Date('2026-11-20T05:00:00Z'), kind: 'ask' },
      { id: 'th1', thread_id: 'th1', title: 'Reply to Finance @ Tridorian: Invoice reminder', who: null, since: new Date('2026-11-23T05:00:00Z'), kind: 'reply_owed' },
      { id: 't1', title: 'iMEX testing', who: 'Muhammad Yousuf', since: new Date('2026-11-12T05:00:00Z'), kind: 'task_other' },
    ]);
    expect(p.map((x) => `${x.with}|${x.since}`)).toEqual(['Muhammad Yousuf|2026-11-12', 'Syeda Uzma Shah|2026-11-20', 'him|2026-11-23']);
    expect(p[2].ref).toEqual({ thread_id: 'th1' });
  });
});
