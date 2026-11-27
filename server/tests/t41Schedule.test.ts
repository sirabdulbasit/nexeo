/**
 * Link T41 round 9 (Suzi proposed 23 Nov 11:56, Nexeo AGREE 13:06, Suzi AGREE 13:07 PKT): a standing instruction can
 * say WHEN it runs on his computer. Pinned:
 *  1. the one reader of a schedule accepts exactly the agreed shapes and nothing else;
 *  2. the schedule is written on the instruction's Wiki page (metadata and a visible line), set and cleared;
 *  3. only its author (or an admin, for a company rule) changes it; an archived one is not found;
 *  4. the pack's rules.standing[] carries `schedule` only on an instruction that has one; a stored schedule that does
 *     not read is no schedule;
 *  5. operator.report takes job `scheduled`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  page: null as any,
  updates: [] as any[],
  instructions: [] as any[],
  runs: new Map<string, any>(),
}));

vi.mock('../src/db/prisma', () => ({
  default: {
    wikiPage: {
      findFirst: async (a: any) => (db.page && db.page.id === a.where.id && db.page.status === a.where.status ? db.page : null),
      update: async (a: any) => { db.updates.push(a); return a; },
    },
    operatorSettings: { findUnique: async () => null },
    operatorRun: {
      findUnique: async (a: any) => db.runs.get(a.where.id) ?? null,
      create: async (a: any) => { db.runs.set(a.data.id, a.data); return a.data; },
      count: async () => db.runs.size,
      aggregate: async () => ({ _sum: { steps: [...db.runs.values()].reduce((n, r) => n + r.steps, 0) } }),
    },
    $queryRawUnsafe: async (sql: string) => {
      if (/FROM wiki_pages/.test(sql)) return db.instructions;
      if (/brain_channel/.test(sql)) return [{ bc: {} }];
      return [];
    },
  },
}));
vi.mock('../src/services/llmRouter', () => ({ callLLM: async () => { throw new Error('no model in this test'); } }));
vi.mock('../src/utils/redisClient', () => ({ invalidate: async () => undefined }));

import { parseSchedule, withScheduleLine } from '../src/services/knowledge/instructionSchedule';
import { setInstructionSchedule, getActiveInstructions } from '../src/services/knowledge/instructionService';
import { rulesContent } from '../src/services/suzi/suziRules';
import { runOperatorOp } from '../src/services/suzi/suziOperator';

const BODY = '# Clear caches\n\n**Scope:** user\n**Kind:** standing_rule\n**Status:** active\n\n## Original text\nClear caches every Friday';
const friday = { every: 'week' as const, on: 'fri' as const, at: '09:00' };

beforeEach(() => {
  db.page = { id: 'ins_1', status: 'active', userId: 2, bodyMarkdown: BODY, metadata: { scope: 'user', status: 'active', originalText: 'Clear caches every Friday' } };
  db.updates = []; db.instructions = []; db.runs.clear();
});

describe('T41 schedule: the one reader', () => {
  it('accepts exactly the agreed shapes', () => {
    expect(parseSchedule({ every: 'day' })).toEqual({ every: 'day' });
    expect(parseSchedule({ every: 'day', at: '23:59' })).toEqual({ every: 'day', at: '23:59' });
    expect(parseSchedule(friday)).toEqual(friday);
    expect(parseSchedule({ every: 'week' })).toEqual({ every: 'week' });
    expect(parseSchedule({ every: 'month', on: 1 })).toEqual({ every: 'month', on: 1 });
    expect(parseSchedule({ every: 'month', on: 28, at: '00:00' })).toEqual({ every: 'month', on: 28, at: '00:00' });
  });
  it('refuses everything else', () => {
    for (const bad of [
      null, 'every friday', [], {}, { every: 'year' }, { every: 'Week' },
      { every: 'day', on: 'mon' }, { every: 'week', on: 'friday' }, { every: 'week', on: 5 },
      { every: 'month', on: 0 }, { every: 'month', on: 29 }, { every: 'month', on: 1.5 }, { every: 'month', on: 'fri' },
      { every: 'day', at: '24:00' }, { every: 'day', at: '9:00' }, { every: 'day', at: '09:60' }, { every: 'day', at: 900 },
      { every: 'day', cron: '0 9 * * 5' },
    ]) expect(parseSchedule(bad), JSON.stringify(bad)).toBeNull();
  });
  it('the page line is put in, replaced and taken off', () => {
    const on = withScheduleLine(BODY, friday);
    expect(on).toContain("**Schedule:** every week on fri at 09:00 (the computer's own time)\n\n## Original text");
    const moved = withScheduleLine(on, { every: 'month', on: 1 });
    expect(moved.match(/\*\*Schedule:\*\*/g)).toHaveLength(1);
    expect(moved).toContain('**Schedule:** every month on day 1');
    expect(withScheduleLine(moved, null)).toBe(BODY);
  });
});

describe('T41 schedule: the store', () => {
  it('his own rule: the schedule goes on the page (metadata and line), other metadata kept', async () => {
    expect(await setInstructionSchedule('T', 2, 'ins_1', friday)).toEqual({ ok: true });
    const d = db.updates[0].data;
    expect(d.metadata).toMatchObject({ schedule: friday, status: 'active', originalText: 'Clear caches every Friday' });
    expect(d.bodyMarkdown).toContain('**Schedule:** every week on fri at 09:00');
  });
  it('null clears it: the key and the line are gone', async () => {
    db.page.metadata.schedule = friday;
    db.page.bodyMarkdown = withScheduleLine(BODY, friday);
    expect(await setInstructionSchedule('T', 2, 'ins_1', null)).toEqual({ ok: true });
    expect(db.updates[0].data.metadata).not.toHaveProperty('schedule');
    expect(db.updates[0].data.bodyMarkdown).toBe(BODY);
  });
  it('another user\'s rule, a company rule without admin, an archived rule: refused, nothing written', async () => {
    expect(await setInstructionSchedule('T', 3, 'ins_1', friday)).toMatchObject({ ok: false, reason: 'not your instruction' });
    db.page.metadata.scope = 'client';
    expect(await setInstructionSchedule('T', 2, 'ins_1', friday)).toMatchObject({ ok: false, reason: 'client-scope instructions require admin' });
    expect(await setInstructionSchedule('T', 3, 'ins_1', friday, { isAdmin: true })).toEqual({ ok: true });
    db.updates = [];
    db.page.metadata.status = 'archived';
    expect(await setInstructionSchedule('T', 2, 'ins_1', friday, { isAdmin: true })).toMatchObject({ ok: false, reason: 'not found' });
    db.page.status = 'deleted';
    expect(await setInstructionSchedule('T', 2, 'ins_1', friday, { isAdmin: true })).toMatchObject({ ok: false, reason: 'not found' });
    expect(db.updates).toHaveLength(0);
  });
});

describe('T41 schedule: what Suzi reads', () => {
  const row = (id: string, schedule: unknown) => ({ id, title: id, kind: 'standing_rule', scope: 'user', originalText: `rule ${id}`, createdAt: '2026-11-23', schedule });
  it('rules.standing carries schedule only where there is one; a stored one that does not read is none', async () => {
    db.instructions = [row('a', null), row('b', friday), row('c', { every: 'fortnight' })];
    expect((await getActiveInstructions('T', 2)).map((r) => r.schedule)).toEqual([null, friday, null]);
    expect((await rulesContent('T', 2)).standing).toStrictEqual([
      { id: 'a', text: 'rule a' },
      { id: 'b', text: 'rule b', schedule: friday, runs_on: 'mac' }, // T50: where it runs; a schedule set before T50 stays a Mac job
      { id: 'c', text: 'rule c' },
    ]);
  });
  it('operator.report takes job "scheduled"', async () => {
    const r: any = await runOperatorOp('T', 2, 'operator.report', {
      run_id: 's-1', job: 'scheduled', status: 'done', proof: 'file', steps: 3, actions: 3,
      started: '2026-11-28T05:00:00Z', ended: '2026-11-28T05:01:00Z', goal: 'Clear caches every Friday',
    }, true);
    expect(r).toMatchObject({ ok: true, item: { status: 'done', verified: true } });
    expect([...db.runs.values()][0]).toMatchObject({ model: 'local:scheduled' });
  });
});
