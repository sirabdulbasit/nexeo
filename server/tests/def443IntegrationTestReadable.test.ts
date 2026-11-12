/**
 * DEF-443 — owner 11-12 on Test & turn on: "unable to understand Test Run data". 192 flat
 * rows each repeated the KPI, the period, the breakdown and the recipe. summariseReadings
 * regroups the same changes: one entry per KPI, periods newest first × breakdown values,
 * new vs changed counts and the range — the shape the screen renders as one table per KPI.
 */
import { describe, it, expect } from 'vitest';
import { summariseReadings, periodWords } from '../../client/src/pages/admin/integrations/integrationLogic.js';

const row = (period: string, unit: string, after: string, before: string | null = null) => ({
  subjectKey: `new_hires_by_business_unit|${period}|businessUnit=${unit}`,
  subjectLabel: `New Hires by Business Unit · ${period} · businessUnit=${unit}`,
  sourceKey: 'recipe › New hires per month by business unit',
  beforeValue: before,
  afterValue: after,
});
const changes = [
  row('2010-12-01', 'TallyMarks IT Consulting LLC', '1'),
  row('2010-12-01', 'TMC Private Limited', '2'),
  row('2015-02-01', 'TMC Private Limited', '2'),
  row('2015-02-01', 'Xnrel Pvt Limited', '1', '3'),
  { subjectKey: 'context:people|p1', targetKind: 'context', op: 'create', subjectLabel: 'A page' },
];

describe('DEF-443 the test, readable', () => {
  const [k, ...rest] = summariseReadings(changes);

  it('one entry per KPI, named by its label and how it is worked out', () => {
    expect(rest).toHaveLength(0);
    expect(k.label).toBe('New Hires by Business Unit');
    expect(k.how).toBe('New hires per month by business unit');
  });

  it('months newest first, breakdown values as columns, the dimension named', () => {
    expect(k.periods).toEqual(['2015-02-01', '2010-12-01']);
    expect(k.dimName).toBe('businessUnit');
    expect(k.dims).toEqual(['TallyMarks IT Consulting LLC', 'TMC Private Limited', 'Xnrel Pvt Limited']);
    expect(k.first).toBe('2010-12-01');
    expect(k.last).toBe('2015-02-01');
  });

  it('counts new and changed figures and keeps the before value of a changed one', () => {
    expect(k.added).toBe(3);
    expect(k.updated).toBe(1);
    expect(k.total).toBe(4);
    expect(k.cells.get('2015-02-01|Xnrel Pvt Limited')).toEqual({ after: '1', before: '3' });
    expect(k.cells.get('2010-12-01|TMC Private Limited')).toEqual({ after: '2', before: null });
    expect(k.cells.has('2010-12-01|Xnrel Pvt Limited')).toBe(false);
  });

  it('a KPI with no breakdown has one Total column', () => {
    const [t] = summariseReadings([{ subjectKey: 'headcount|2026-10-01|', subjectLabel: 'Headcount · 2026-10-01', sourceKey: 'recipe › Count', beforeValue: null, afterValue: '9' }]);
    expect(t.dims).toEqual(['']);
    expect(t.dimName).toBe('');
  });

  it('months in words', () => {
    expect(periodWords('2015-02-01')).toBe('Feb 2015');
    expect(periodWords('2026-Q3')).toBe('2026-Q3');
  });

  it('knowledge-page changes and junk are not KPI figures', () => {
    expect(summariseReadings([{ subjectKey: 'nopipes' }, null as any])).toEqual([]);
  });
});
