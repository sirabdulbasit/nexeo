/**
 * T50, the instruction ops that carry a job (both AGREE 27 Nov). Pinned:
 *  O1 ADD      a scheduled instruction gets its job part: Suzi's runs_on is kept; with none, Nexeo decides once and
 *              answers with the choice; no schedule → no job part.
 *  O2 AUTO     send "auto" only with `said` (his words), confirmed back; without them it is refused and nothing is written.
 *  O3 ONCE     a one-off in the past is refused.
 *  O4 UPDATE   one change per call: schedule | runs_on | paused | send(+said); anything else, or two at once, is refused.
 *  O5 PAUSE    paused true/false goes through the one status writer; a removed or finished instruction is not brought back.
 *  O6 CONFIRM  every change needs his confirmation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let pageStatus: string | null = 'active';
vi.mock('../src/db/prisma', () => ({ default: { user: { findFirst: async () => ({ userType: 'SA' }) }, wikiPage: { findFirst: async () => (pageStatus ? { metadata: { status: pageStatus } } : null) } } }));
vi.mock('../src/services/suzi/suziPeople', () => ({ personById: async () => null }));
vi.mock('../src/services/suzi/suziRules', () => ({ rulesDocument: async () => ({ rules_version: 7 }) }));
const create = vi.fn(async (_c: string, _u: number, t: string, scope: string, ..._r: any[]) => ({ id: 'ins_1', structured: { title: t.slice(0, 20) }, scope }));
const status = vi.fn(async (..._a: any[]) => ({ ok: true }));
const setSchedule = vi.fn(async (..._a: any[]) => ({ ok: true }));
const setJob = vi.fn(async (_c: string, _u: number, _id: string, ch: any) => ({ ok: true, job: { runs_on: ch.runs_on ?? 'nexeo', send: ch.send ?? 'ask', ...(ch.said ? { said: ch.said } : {}) } } as any));
vi.mock('../src/services/knowledge/instructionService', () => ({
  createInstructionFromText: (...a: any[]) => (create as any)(...a), updateInstructionStatus: (...a: any[]) => (status as any)(...a),
  setInstructionSchedule: (...a: any[]) => (setSchedule as any)(...a), setInstructionJob: (...a: any[]) => (setJob as any)(...a),
}));
const decide = vi.fn(async (..._a: any[]) => 'nexeo' as const);
vi.mock('../src/services/suzi/scheduledJobs', () => ({ decideRunsOn: (...a: any[]) => (decide as any)(...a) }));

import { runDelegationOp } from '../src/services/suzi/suziDelegations';
const gate = { signatureVerified: false, voiceScore: null } as any;
const monday = { every: 'week', on: 'mon', at: '09:00' };
const op = (name: string, a: any, confirmed = true) => runDelegationOp('T', 2, name, a, confirmed, gate) as Promise<any>;

beforeEach(() => { pageStatus = 'active'; for (const f of [create, status, setSchedule, setJob, decide]) f.mockClear(); });

describe('O1 ADD', () => {
  it('Suzi\'s runs_on is kept and no model is asked', async () => {
    const r = await op('instruction.add', { text: 'Tidy my Downloads', schedule: monday, runs_on: 'mac' });
    expect(r.item).toMatchObject({ runs_on: 'mac', send: 'ask', schedule: monday });
    expect(create.mock.calls[0][5]).toEqual({ runs_on: 'mac', send: 'ask' });
    expect(decide).not.toHaveBeenCalled();
  });
  it('with none, Nexeo decides once and answers with the choice', async () => {
    const r = await op('instruction.add', { text: 'Send me the overdue tasks', schedule: monday });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(r.item).toMatchObject({ runs_on: 'nexeo', send: 'ask' });
  });
  it('no schedule → no job part; runs_on or send without a schedule is refused', async () => {
    await op('instruction.add', { text: 'Always copy Salman' });
    expect(create.mock.calls[0][5]).toBeNull();
    expect(await op('instruction.add', { text: 'x', runs_on: 'nexeo' })).toMatchObject({ error: 'bad_args' });
    expect(await op('instruction.add', { text: 'x', schedule: monday, runs_on: 'cloud' })).toMatchObject({ error: 'bad_args' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('O2 AUTO', () => {
  it('only with his words, confirmed back', async () => {
    expect(await op('instruction.add', { text: 'Send Ali the status', schedule: monday, send: 'auto' })).toMatchObject({ error: 'bad_args' });
    expect(create).not.toHaveBeenCalled();
    const r = await op('instruction.add', { text: 'Send Ali the status', schedule: monday, send: 'auto', said: 'send it without asking me' });
    expect(r.item).toMatchObject({ send: 'auto', said: 'send it without asking me' });
    expect(create.mock.calls[0][5]).toEqual({ runs_on: 'nexeo', send: 'auto', said: 'send it without asking me' });
    expect(await op('instruction.update', { id: 'ins_1', send: 'auto' })).toMatchObject({ error: 'bad_args' });
    expect(setJob).not.toHaveBeenCalled();
    expect((await op('instruction.update', { id: 'ins_1', send: 'auto', said: 'yes send it yourself' })).item).toMatchObject({ send: 'auto', said: 'yes send it yourself' });
    expect((await op('instruction.update', { id: 'ins_1', send: 'ask' })).item.send).toBe('ask');
  });
});

describe('O3 ONCE', () => {
  it('a future one-off is kept, a past one refused', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect((await op('instruction.add', { text: 'Remind me to call Ali', schedule: { once: future } })).item.schedule).toEqual({ once: future });
    expect(await op('instruction.add', { text: 'Remind me', schedule: { once: '2020-01-01T10:00:00Z' } })).toMatchObject({ error: 'bad_schedule' });
    expect(await op('instruction.update', { id: 'ins_1', schedule: { once: '2020-01-01T10:00:00Z' } })).toMatchObject({ error: 'bad_schedule' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('O4 UPDATE + O5 PAUSE + O6 CONFIRM', () => {
  it('one change per call; unknown fields refused; nothing sent is refused', async () => {
    expect(await op('instruction.update', { id: 'ins_1', runs_on: 'mac', paused: true })).toMatchObject({ error: 'bad_args' });
    expect(await op('instruction.update', { id: 'ins_1', text: 'new words' })).toMatchObject({ error: 'bad_args' });
    expect(await op('instruction.update', { id: 'ins_1', runs_on: 'mac', said: 'x' })).toMatchObject({ error: 'bad_args' });
    expect(await op('instruction.update', { id: 'ins_1' })).toMatchObject({ error: 'bad_schedule' });
    expect(setJob).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled(); expect(setSchedule).not.toHaveBeenCalled();
  });
  it('runs_on is corrected through the job writer', async () => {
    expect((await op('instruction.update', { id: 'ins_1', runs_on: 'mac' })).item).toMatchObject({ id: 'ins_1', runs_on: 'mac', rules_version: 7 });
    expect(setJob.mock.calls[0].slice(2, 4)).toEqual(['ins_1', { runs_on: 'mac' }]);
  });
  it('pause and resume go through the status writer; a removed or finished one is not brought back', async () => {
    expect((await op('instruction.update', { id: 'ins_1', paused: true })).item).toMatchObject({ paused: true });
    pageStatus = 'paused';
    expect((await op('instruction.update', { id: 'ins_1', paused: false })).item).toMatchObject({ paused: false });
    expect(status.mock.calls.map((c) => c[3])).toEqual(['paused', 'active']);
    for (const gone of ['fulfilled', 'archived', null]) { pageStatus = gone; expect(await op('instruction.update', { id: 'ins_1', paused: false })).toMatchObject({ error: 'not_found' }); }
    expect(status).toHaveBeenCalledTimes(2);
    expect(await op('instruction.update', { id: 'ins_1', paused: 'yes' })).toMatchObject({ error: 'bad_args' });
  });
  it('every change needs his confirmation', async () => {
    for (const a of [{ runs_on: 'mac' }, { paused: true }, { send: 'ask' }, { schedule: monday }]) expect(await op('instruction.update', { id: 'ins_1', ...a }, false)).toMatchObject({ error: 'needs_confirmation' });
    expect(await op('instruction.add', { text: 'x', schedule: monday, runs_on: 'mac' }, false)).toMatchObject({ error: 'needs_confirmation' });
    expect(setJob).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled(); expect(setSchedule).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
});
