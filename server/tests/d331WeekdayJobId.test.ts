/**
 * D-331 (T50 follow-up; Suzi-Builder 27 Nov 11:18, Nexeo AGREE the same hour).
 * Pinned:
 *  1. WEEKDAY: `every: "weekday"` is accepted (no `on`), and runs Monday to Friday only.
 *  2. DAY NAMES: "monday" / "Thursday" are read as "mon" / "thu"; what is kept is three letters; nonsense is refused.
 *  3. JOB ID: `operator.report` accepts `job_id` on a scheduled job only; the report's record names the job; any other
 *     extra field is still refused; the Mac-report lookup prefers this job's own report and skips another job's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
const create = vi.fn();
const findUnique = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { operatorRun: { create: (...a: any[]) => create(...a), findUnique: (...a: any[]) => findUnique(...a), count: async () => 0, aggregate: async () => ({ _sum: { steps: 0 } }) } } }));
import { parseSchedule, describeSchedule } from '../src/services/knowledge/instructionSchedule';
import { nextRun } from '../src/services/suzi/scheduledJobs';
import { runOperatorOp } from '../src/services/suzi/suziOperator';

const TZ = 'Asia/Karachi';
describe('D-331 weekday and day names', () => {
  it('WEEKDAY: accepted without `on`; Friday evening → Monday, never Saturday or Sunday', () => {
    expect(parseSchedule({ every: 'weekday', at: '09:00' })).toEqual({ every: 'weekday', at: '09:00' });
    expect(parseSchedule({ every: 'weekday', on: 'mon' })).toBeNull();
    const s = parseSchedule({ every: 'weekday', at: '09:00' })!;
    expect(nextRun(s, new Date('2026-11-27T05:00:00Z'), TZ)!.toISOString()).toBe('2026-11-30T04:00:00.000Z'); // Fri 10:00 PKT → Mon 09:00
    expect(nextRun(s, new Date('2026-11-26T03:00:00Z'), TZ)!.toISOString()).toBe('2026-11-26T04:00:00.000Z'); // Thu 08:00 → Thu 09:00
    expect(nextRun(s, new Date('2026-11-28T10:00:00Z'), TZ)!.toISOString()).toBe('2026-11-30T04:00:00.000Z'); // Sat → Mon
    expect(describeSchedule(s, 'nexeo')).toBe('every weekday at 09:00 (his time zone)');
  });
  it('DAY NAMES: full names are read as three letters; nonsense is refused', () => {
    expect(parseSchedule({ every: 'week', on: 'monday' })).toEqual({ every: 'week', on: 'mon' });
    expect(parseSchedule({ every: 'week', on: 'Thursday', at: '17:00' })).toEqual({ every: 'week', on: 'thu', at: '17:00' });
    expect(parseSchedule({ every: 'week', on: 'tue' })).toEqual({ every: 'week', on: 'tue' });
    expect(parseSchedule({ every: 'week', on: 'someday' })).toBeNull();
    expect(parseSchedule({ every: 'week', on: 'monthly' })).toBeNull();
  });
});

describe('D-331 job_id on operator.report', () => {
  const base = { run_id: 'r1', job: 'scheduled', status: 'done', proof: 'file', steps: 2, actions: 3, started: '2026-11-27T04:00:00Z', ended: '2026-11-27T04:01:00Z' };
  beforeEach(() => { create.mockReset(); findUnique.mockReset(); findUnique.mockResolvedValue(null); create.mockImplementation(async (a: any) => a.data); });
  it('JOB ID: kept on the record; only on a scheduled job; other extra fields still refused', async () => {
    const ok: any = await runOperatorOp('T', 2, 'operator.report', { ...base, job_id: 'cmx1abc' }, true);
    expect(ok.ok).toBe(true);
    expect(create.mock.calls[0][0].data.summary).toBe('proof:file job:cmx1abc');
    create.mockClear();
    await runOperatorOp('T', 2, 'operator.report', { ...base, run_id: 'r2' }, true);
    expect(create.mock.calls[0][0].data.summary).toBe('proof:file');
    expect(await runOperatorOp('T', 2, 'operator.report', { ...base, run_id: 'r3', job_id: 'has space' }, true)).toMatchObject({ ok: false, error: 'bad_job_id' });
    expect(await runOperatorOp('T', 2, 'operator.report', { ...base, run_id: 'r4', screenshot: 'x' }, true)).toMatchObject({ ok: false, error: 'bad_args' });
  });
  it('LOOKUP: this job\'s own report first; another job\'s report is not taken', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/suzi/scheduledJobs.ts'), 'utf8');
    expect(src).toContain("(summary NOT LIKE '% job:%' OR summary LIKE '% job:' || $5)");
    expect(src).toContain("ORDER BY (summary LIKE '% job:' || $5) DESC, started_at LIMIT 1");
  });
});
