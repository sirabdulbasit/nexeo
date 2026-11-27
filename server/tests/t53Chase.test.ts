/**
 * T53 (founder 27 Nov 2026): the task's own people are asked one day before the deadline; he is told only when it is
 * off track or unanswered. Pure rules here; the step itself runs with injected send, gate and model.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), exec: vi.fn(), user: vi.fn() }));
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: db.query, $executeRawUnsafe: db.exec, user: { findFirst: db.user } } }));
const trail = vi.hoisted(() => ({ push: vi.fn(async () => undefined) }));
vi.mock('../src/services/suzi/suziTaskTrail', () => ({ trailPush: trail.push }));

import { chaseDay, chasePeople, isWorkingTime, nextWorkingDay, overall, packChase, parseJudge, quietReason, runChaseStep } from '../src/services/suzi/chase';
import { situationNew } from '../src/services/suzi/situation';

describe('T53 when to ask', () => {
  it('asks on the last working day before the deadline', () => {
    expect(chaseDay('2026-11-26', '2026-11-27')).toBe(true);   // Thursday for Friday
    expect(chaseDay('2026-11-27', '2026-11-28')).toBe(true);   // Friday for Saturday
    expect(chaseDay('2026-11-27', '2026-11-29')).toBe(true);   // Friday for Sunday
    expect(chaseDay('2026-11-27', '2026-11-30')).toBe(true);   // Friday for Monday
  });
  it('never on or after the due day, never two days early, never on a weekend', () => {
    expect(chaseDay('2026-11-27', '2026-11-27')).toBe(false);
    expect(chaseDay('2026-11-28', '2026-11-27')).toBe(false);
    expect(chaseDay('2026-11-25', '2026-11-27')).toBe(false);
    expect(chaseDay('2026-11-27', '2026-12-01')).toBe(false);
    expect(chaseDay('2026-11-28', '2026-11-30')).toBe(false);  // Saturday
    expect(chaseDay('2026-11-27', '')).toBe(false);
  });
  it('knows his working hours in PKT', () => {
    expect(isWorkingTime(new Date('2026-11-27T04:00:00Z'))).toBe(true);   // Fri 09:00
    expect(isWorkingTime(new Date('2026-11-27T03:59:00Z'))).toBe(false);  // Fri 08:59
    expect(isWorkingTime(new Date('2026-11-27T13:00:00Z'))).toBe(false);  // Fri 18:00
    expect(isWorkingTime(new Date('2026-11-28T06:00:00Z'))).toBe(false);  // Saturday
    expect(nextWorkingDay('2026-11-27')).toBe('2026-11-30');
  });
});

describe('T53 whom to ask', () => {
  it('the Lead and helpers with an email, each once, never him', () => {
    const p = chasePeople({ delegatee_name: 'Yousuf', delegatee_email: 'Y@x.com', metadata: { suziHelpers: [
      { name: 'Asad', email: 'asad@x.com' }, { name: 'Dup', email: 'y@x.com' }, { name: 'Me', email: 'me@x.com' }, { name: 'No mail' }] } }, 'me@x.com');
    expect(p).toEqual([{ name: 'Yousuf', email: 'y@x.com' }, { name: 'Asad', email: 'asad@x.com' }]);
  });
  it('a task of his own has nobody to ask', () => {
    expect(chasePeople({ delegatee_name: null, delegatee_email: null, metadata: {} }, 'me@x.com')).toEqual([]);
  });
  it('is quiet when he followed up or the person wrote in the last 2 days', () => {
    const now = new Date('2026-11-27T06:00:00Z');
    expect(quietReason({ lastFollowupAt: '2026-11-26T06:00:00Z' }, now)).toBe('he_followed_up');
    expect(quietReason({ lastFollowupAt: '2026-11-19T06:00:00Z' }, now)).toBeNull();
    expect(quietReason({ suziTrail: [{ at: '2026-11-26T08:00:00Z', who: 'you, through Suzi', change: 'Followed up: Yousuf' }] }, now)).toBe('he_followed_up');
    expect(quietReason({ suziTrail: [{ at: '2026-11-26T08:00:00Z', who: 'Yousuf, by email', change: 'Email about this' }] }, now)).toBe('person_replied');
    expect(quietReason({ suziTrail: [{ at: '2026-11-20T08:00:00Z', who: 'Yousuf, by email', change: 'Email about this' }] }, now)).toBeNull();
    expect(quietReason({ suziTrail: [{ at: '2026-11-26T08:00:00Z', who: 'you, through Suzi', change: 'Renamed' }] }, now)).toBeNull();
  });
});

describe('T53 reading the answer', () => {
  const reply = 'Hi Basit, testing will be finished by tomorrow evening as planned. Regards';
  it('on track only with their own words behind it', () => {
    expect(parseJudge('{"answer":"on_track","said":"testing will be finished by tomorrow evening","new_date":null}', reply, '2026-11-26'))
      .toEqual({ answer: 'on_track', said: 'testing will be finished by tomorrow evening', new_due: null });
    const invented = parseJudge('{"answer":"on_track","said":"all done and delivered","new_date":null}', reply, '2026-11-26');
    expect(invented.answer).toBe('off_track');
    expect(invented.said.startsWith('Hi Basit')).toBe(true);
  });
  it('unclear, unreadable or late counts as off track; a new date only from today on', () => {
    expect(parseJudge('{"answer":"unclear","said":"Hi Basit","new_date":null}', reply, '2026-11-26').answer).toBe('off_track');
    expect(parseJudge('not json', reply, '2026-11-26').answer).toBe('off_track');
    const late = 'We are blocked on the test data, I need until 2 December.';
    expect(parseJudge('{"answer":"off_track","said":"I need until 2 December","new_date":"2026-12-02"}', late, '2026-11-26'))
      .toEqual({ answer: 'off_track', said: 'I need until 2 December', new_due: '2026-12-02' });
    expect(parseJudge('{"answer":"off_track","said":"I need until 2 December","new_date":"2026-11-01"}', late, '2026-11-26').new_due).toBeNull();
  });
  it('the task takes the worst answer of its people', () => {
    expect(overall([{ name: 'A', email: 'a@x', answer: 'on_track' }, { name: 'B', email: 'b@x', answer: 'off_track', said: 'blocked' }])).toEqual({ answer: 'off_track', by: 'B', said: 'blocked' });
    expect(overall([{ name: 'A', email: 'a@x', answer: 'on_track' }, { name: 'B', email: 'b@x', answer: 'waiting' }])).toEqual({ answer: 'waiting' });
    expect(overall([{ name: 'A', email: 'a@x', answer: 'on_track', said: 'fine' }]).answer).toBe('on_track');
  });
});

describe('T53 what he sees', () => {
  const chase = { due: '2026-11-27', asked_at: '2026-11-26T05:00:00.000Z', to: [{ name: 'Yousuf', email: 'y@x.com', answer: 'off_track' }], answer: 'off_track', by: 'Yousuf', said: 'blocked on data', suggest: 'meet', answered_at: '2026-11-26T09:00:00.000Z' };
  it('the action carries the chase without addresses', () => {
    const c = packChase({ chase }).chase!;
    expect(c).toEqual({ asked_at: chase.asked_at, due: '2026-11-27', to: ['Yousuf'], answer: 'off_track', by: 'Yousuf', said: 'blocked on data', suggest: 'meet', answered_at: chase.answered_at });
    expect(JSON.stringify(c)).not.toContain('@');
    expect(packChase({})).toEqual({});
  });
  const parts = (c: any) => ({ now: new Date('2026-11-26T10:00:00Z'), asOf: '2026-11-26T15:00:00+05:00', today: '2026-11-26', seenAt: new Date('2026-11-26T08:00:00Z'),
    actions: [{ id: 't1', title: 'iMEX testing', owner: 'Yousuf', priority: 'medium', status: 'DELEGATED', due: '2026-11-27', overdue: false, updated_at: null, changed_at: null, chase: c }],
    emails: [], fyi: [], proposals: [], recorded: [], decisions: [] }) as any;
  it('off track and no answer are news; on track and waiting are not', () => {
    const off = situationNew(parts(packChase({ chase }).chase));
    expect(off).toHaveLength(1);
    expect(off[0]).toMatchObject({ kind: 'chase', ref: { task_id: 't1' } });
    expect(off[0].what).toContain('Yousuf says "iMEX testing" is not on track: blocked on data');
    const none = situationNew(parts(packChase({ chase: { ...chase, answer: 'no_reply', said: undefined } }).chase));
    expect(none[0].what).toBe('No answer from Yousuf on "iMEX testing", due 2026-11-27');
    expect(situationNew(parts(packChase({ chase: { ...chase, answer: 'on_track' } }).chase))).toHaveLength(0);
    expect(situationNew(parts(packChase({ chase: { ...chase, answer: 'waiting', answered_at: undefined } }).chase))).toHaveLength(0);
  });
});

describe('T53 the step', () => {
  const task = (meta: any = {}, due = '2026-11-27T12:00:00.000Z') => ({ id: 't1', title: 'iMEX testing', status: 'DELEGATED', due_date: new Date(due), delegatee_name: 'Yousuf', delegatee_email: 'y@x.com', metadata: meta });
  const thursday10 = new Date('2026-11-26T05:00:00Z');
  beforeEach(() => { db.query.mockReset(); db.exec.mockReset(); db.user.mockReset(); trail.push.mockClear(); db.user.mockResolvedValue({ email: 'me@x.com' }); });
  const wire = (tasks: any[], opts: { on?: boolean; replies?: any[] } = {}) => {
    db.query.mockImplementation(async (sql: string) => {
      if (/page_type = 'instruction'/.test(sql)) return opts.on === false ? [] : [{ id: 'rule1' }];
      if (/FROM open_items/.test(sql)) return tasks;
      if (/FROM wiki_sources/.test(sql)) return opts.replies ?? [];
      return [];
    });
    db.exec.mockResolvedValue(1);
  };

  it('does nothing without his standing instruction', async () => {
    wire([task()], { on: false });
    const send = vi.fn(async () => true);
    expect(await runChaseStep('C', 2, { now: thursday10, send, blocked: async () => null })).toEqual({ asked: 0, answered: 0, told: 0, skipped: 0 });
    expect(send).not.toHaveBeenCalled();
  });
  it('asks the Lead once, the day before, and writes the history line', async () => {
    wire([task()]);
    const send = vi.fn(async () => true);
    const r = await runChaseStep('C', 2, { now: thursday10, send, blocked: async () => null });
    expect(r.asked).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toEqual({ name: 'Yousuf', email: 'y@x.com', answer: 'waiting' });
    expect(send.mock.calls[0][2]).toBe('2026-11-27');
    const claim = db.exec.mock.calls[0];
    expect(String(claim[0])).toContain("metadata->'chase'->>'due'");
    expect(JSON.parse(claim[2])).toMatchObject({ due: '2026-11-27', answer: 'waiting' });
    expect(trail.push).toHaveBeenCalledWith('t1', expect.objectContaining({ who: 'Nexeo, by your rule', change: 'Followed up by rule: Yousuf' }));
  });
  it('never twice for the same deadline; again when the deadline moved', async () => {
    const asked = { due: '2026-11-27', asked_at: '2026-11-26T04:30:00.000Z', to: [{ name: 'Yousuf', email: 'y@x.com', answer: 'on_track' }], answer: 'on_track' };
    wire([task({ chase: asked })]);
    const send = vi.fn(async () => true);
    expect((await runChaseStep('C', 2, { now: thursday10, send, blocked: async () => null })).asked).toBe(0);
    wire([task({ chase: { ...asked, due: '2026-11-20' } })]);
    expect((await runChaseStep('C', 2, { now: thursday10, send, blocked: async () => null })).asked).toBe(1);
  });
  it('a lost claim sends nothing', async () => {
    wire([task()]);
    db.exec.mockResolvedValue(0);
    const send = vi.fn(async () => true);
    expect((await runChaseStep('C', 2, { now: thursday10, send, blocked: async () => null })).asked).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('outside working hours, on the due day, with no deadline people or after his own follow-up: nothing goes', async () => {
    const send = vi.fn(async () => true);
    wire([task()]);
    await runChaseStep('C', 2, { now: new Date('2026-11-26T15:00:00Z'), send, blocked: async () => null }); // 20:00 PKT
    await runChaseStep('C', 2, { now: new Date('2026-11-27T05:00:00Z'), send, blocked: async () => null }); // the due day
    wire([{ ...task(), delegatee_email: null }]);
    await runChaseStep('C', 2, { now: thursday10, send, blocked: async () => null });
    wire([task({ lastFollowupAt: '2026-11-25T10:00:00Z' })]);
    const r = await runChaseStep('C', 2, { now: thursday10, send, blocked: async () => null });
    expect(send).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });
  it('a refused gate records not_sent with the reason and sends nothing', async () => {
    wire([task()]);
    const send = vi.fn(async () => true);
    await runChaseStep('C', 2, { now: thursday10, send, blocked: async () => 'google_not_connected' });
    expect(send).not.toHaveBeenCalled();
    expect(JSON.parse(db.exec.mock.calls[0][2])).toMatchObject({ answer: 'not_sent', reason: 'google_not_connected' });
  });
  const mk = () => ({ due: '2026-11-27', asked_at: '2026-11-26T04:30:00.000Z', to: [{ name: 'Yousuf', email: 'y@x.com', answer: 'waiting' }], answer: 'waiting' });
  let waiting = mk();
  beforeEach(() => { waiting = mk(); });
  const reply = (body: string) => [{ external_id: 'm9', occurred_at: new Date('2026-11-26T04:50:00Z'), sender: 'Yousuf <y@x.com>', body, title: 'Re: Following up: iMEX testing' }];
  const saved = () => db.exec.mock.calls.map((c) => { try { return JSON.parse(c[2]); } catch { return null; } }).filter((j) => j && j.asked_at).pop();
  it('on track: a history line, he is not told', async () => {
    wire([task({ chase: waiting, suziThreads: [{ thread_id: 'th1', since: waiting.asked_at }] })], { replies: reply('It is on track, will be done by tomorrow.') });
    const r = await runChaseStep('C', 2, { now: thursday10, blocked: async () => null, send: vi.fn(async () => true), llm: async () => '{"answer":"on_track","said":"will be done by tomorrow","new_date":null}' });
    expect(r).toMatchObject({ answered: 1, told: 0 });
    expect(saved()).toMatchObject({ answer: 'on_track', by: 'Yousuf' });
    expect(saved().suggest).toBeUndefined();
    expect(trail.push).toHaveBeenCalledWith('t1', expect.objectContaining({ change: 'On track', who: 'Yousuf, by email' }));
  });
  it('off track with a new date: he is told and the move is a stored proposal', async () => {
    wire([task({ chase: waiting, suziThreads: [{ thread_id: 'th1', since: waiting.asked_at }] })], { replies: reply('Blocked on test data, I need until 2 December.') });
    const r = await runChaseStep('C', 2, { now: thursday10, blocked: async () => null, send: vi.fn(async () => true), llm: async () => '{"answer":"off_track","said":"I need until 2 December","new_date":"2026-12-02"}' });
    expect(r).toMatchObject({ answered: 1, told: 1 });
    expect(saved()).toMatchObject({ answer: 'off_track', suggest: 'move', new_due: '2026-12-02', said: 'I need until 2 December' });
    const prop = db.exec.mock.calls.map((c) => { try { return JSON.parse(c[2]); } catch { return null; } }).find((j) => j?.change === 'due');
    expect(prop).toMatchObject({ change: 'due', value: '2026-12-02', from: { email_id: 'm9', direction: 'in' } });
  });
  it('off track without a date suggests a meeting; no reply by the deadline is told once', async () => {
    wire([task({ chase: waiting, suziThreads: [{ thread_id: 'th1', since: waiting.asked_at }] })], { replies: reply('Not sure, the vendor has not answered.') });
    await runChaseStep('C', 2, { now: thursday10, blocked: async () => null, send: vi.fn(async () => true), llm: async () => '{"answer":"off_track","said":"the vendor has not answered","new_date":null}' });
    expect(saved()).toMatchObject({ answer: 'off_track', suggest: 'meet' });
    db.exec.mockClear();
    wire([task({ chase: mk() })]);
    const r = await runChaseStep('C', 2, { now: new Date('2026-11-27T05:00:00Z'), blocked: async () => null, send: vi.fn(async () => true), llm: async () => '' });
    expect(r.told).toBe(1);
    expect(saved()).toMatchObject({ answer: 'no_reply', suggest: 'meet', by: 'Yousuf' });
    expect(trail.push).toHaveBeenCalledWith('t1', expect.objectContaining({ change: 'No answer from Yousuf' }));
  });
});
