/**
 * The LEARN pass runs inside the server, daily at 02:30 UTC (07:30 PKT).
 * Owner, 2026-11-03: stop the nightly self-improvement build, keep learning.
 * Before this, nexeo-loop.sh was the only runner of nexeoLearnSweep, so
 * removing the cron line would have silently stopped learning.
 *
 * Pinned:
 *  1. due exactly once per UTC day, inside the 10-minute window from 02:30 UTC;
 *  2. not due before or after the window, or a second time the same day;
 *  3. server.ts schedules it through protectedJob and records the day before running;
 *  4. the CLI script is a thin wrapper over the same pass (one implementation).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { learnSweepDue, LEARN_SWEEP_UTC } from '../src/services/learning/learnSweep';

const at = (iso: string) => new Date(iso);

describe('daily LEARN pass in the server', () => {
  it('slot is 02:30 UTC (07:30 PKT), the nightly build\'s old slot', () => {
    expect(LEARN_SWEEP_UTC).toEqual({ hour: 2, minute: 30 });
  });

  it('is due inside the window and only once per UTC day', () => {
    expect(learnSweepDue(at('2026-11-04T02:30:00Z'), null)).toBe(true);
    expect(learnSweepDue(at('2026-11-04T02:39:59Z'), '2026-11-03')).toBe(true);
    expect(learnSweepDue(at('2026-11-04T02:31:00Z'), '2026-11-04')).toBe(false);
  });

  it('is not due outside the window', () => {
    expect(learnSweepDue(at('2026-11-04T02:29:59Z'), null)).toBe(false);
    expect(learnSweepDue(at('2026-11-04T02:40:00Z'), null)).toBe(false);
    expect(learnSweepDue(at('2026-11-04T14:30:00Z'), null)).toBe(false);
  });

  it('server.ts schedules it through protectedJob, marking the day before it runs', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/server.ts'), 'utf8');
    const block = src.slice(src.indexOf('let lastLearnDay'), src.indexOf('MyOS wiki lint'));
    expect(block).toContain("learnSweepDue(now, lastLearnDay)");
    expect(block).toContain("protectedJob('learn_sweep'");
    expect(block.indexOf('lastLearnDay = now')).toBeLessThan(block.indexOf("protectedJob('learn_sweep'"));
  });

  it('the CLI script runs the same pass (one implementation)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/scripts/nexeoLearnSweep.ts'), 'utf8');
    expect(src).toContain("import { runLearnSweep } from '../services/learning/learnSweep'");
    expect(src).not.toContain('sweepQualifyingMemories(');
  });
});
