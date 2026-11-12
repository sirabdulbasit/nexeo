/**
 * DEF-444 — owner 11-12: "seeing records as per fields in column give me exact picture and
 * confident about what is going to be integrated". The test now keeps the records it read
 * (memory only, an hour) and, for every figure, the records it was computed from — taken
 * in the planner's own pass, so a figure and its records can never disagree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

import { readKpiRecipe } from '../src/services/integrations/engine/kpiRecipe';
import { planKpiReadings, readingKey, type PlannerKpiDef } from '../src/services/integrations/engine/planner';
import { keepPreview, getPreview, previewPage, _clearPreviews } from '../src/services/integrations/engine/previewStore';
import type { ApprovedKpiRow, KpiTransform } from '../src/services/integrations/types';

const HEADERS = ['personalNo', 'name', 'businessUnit', 'joiningDate', 'Amount'];
const PEOPLE: Record<string, string>[] = [
  { personalNo: 'E-1', name: 'Ali', businessUnit: 'TMC', joiningDate: '2026-01-05', Amount: '5' },
  { personalNo: 'E-2', name: 'Sara', businessUnit: 'TMC', joiningDate: '2026-01-20', Amount: '7' },
  { personalNo: 'E-3', name: 'Omar', businessUnit: 'Xnrel', joiningDate: '2026-01-11', Amount: '1' },
  { personalNo: 'E-4', name: 'Hina', businessUnit: 'TMC', joiningDate: '2026-02-02', Amount: '2' },
  { personalNo: 'E-5', name: 'Zia', businessUnit: 'TMC', joiningDate: '', Amount: '3' }, // unreadable period: in no figure
  { personalNo: 'E-6', name: 'Now', businessUnit: 'TMC', joiningDate: '2026-05-01', Amount: '3' }, // running month: in no figure
];
const NOW = { year: 2026, month: 5 };
const def = (k: string): PlannerKpiDef => ({ kpiKey: k, label: k, unit: null, isActive: true, sourceIntegrationId: 'i1', grain: 'month' });
const row = (k: string, t: KpiTransform): ApprovedKpiRow => ({ suggestionId: k, sourceField: 'x', targetKey: `kpi:${k}`, transform: t });
const recipe = (r: Record<string, unknown>, dim?: string): KpiTransform => {
  const k = readKpiRecipe(r, HEADERS);
  if (typeof k === 'string') throw new Error(k);
  return { mode: 'recipe', recipe: k, ...(dim ? { dimensionField: dim } : {}) };
};

describe('DEF-444 the planner says which records feed each figure', () => {
  const p = planKpiReadings(PEOPLE, [row('hires', recipe({ measure: 'count', periodField: 'joiningDate', label: 'Hires' }, 'businessUnit'))], [def('hires')], new Map(), 'normal', NOW);
  const rows = (period: string, unit: string) => p.sourceRows!.get(readingKey('hires', period, `businessUnit=${unit}`)) ?? [];

  it('a count figure is exactly as many records as it says, and they are the right ones', () => {
    const jan = p.readings.find((r) => r.periodStart === '2026-01-01' && r.dimensionKey === 'businessUnit=TMC')!;
    expect(jan.value).toBe('2');
    expect(rows('2026-01-01', 'TMC').map((i) => PEOPLE[i].personalNo)).toEqual(['E-1', 'E-2']);
    expect(rows('2026-01-01', 'Xnrel').map((i) => PEOPLE[i].personalNo)).toEqual(['E-3']);
    expect(rows('2026-02-01', 'TMC').map((i) => PEOPLE[i].personalNo)).toEqual(['E-4']);
  });

  it('every planned figure has its records, and their count equals the figure', () => {
    for (const r of p.readings) {
      expect(p.sourceRows!.get(readingKey(r.kpiKey, r.periodStart, r.dimensionKey))!.length).toBe(Number(r.value));
    }
  });

  it('a record with an unreadable or running-month date feeds no figure', () => {
    const all = [...p.sourceRows!.values()].flat();
    expect(all).not.toContain(4);
    expect(all).not.toContain(5);
  });

  it('long layout: each row is the record behind its own figure', () => {
    const q = planKpiReadings(PEOPLE.slice(0, 4), [row('amt', { mode: 'long', valueField: 'Amount', periodField: 'joiningDate', dimensionField: 'personalNo' } as KpiTransform)], [def('amt')], new Map(), 'normal', NOW);
    expect(q.sourceRows!.get(readingKey('amt', '2026-01-01', 'personalNo=E-2'))).toEqual([1]);
  });
});

describe('DEF-444 the kept records, page by page', () => {
  beforeEach(() => _clearPreviews());
  const entry = () => ({
    cn: 'T1', integrationId: 'i1', headers: HEADERS, records: PEOPLE,
    usedFields: ['businessUnit', 'joiningDate'],
    sourceRows: new Map([[readingKey('hires', '2026-01-01', 'businessUnit=TMC'), [0, 1]]]),
  });

  it('all records, the fields the mapping uses first', () => {
    keepPreview('r1', entry());
    const pg = previewPage(getPreview('T1', 'i1', 'r1'), {});
    expect(pg.available).toBe(true);
    expect(pg.total).toBe(6);
    expect(pg.headers).toEqual(['businessUnit', 'joiningDate', 'personalNo', 'name', 'Amount']);
    expect(pg.usedFields).toEqual(['businessUnit', 'joiningDate']);
  });

  it('only the records behind one figure', () => {
    keepPreview('r1', entry());
    const pg = previewPage(getPreview('T1', 'i1', 'r1'), { reading: 'hires|2026-01-01|businessUnit=TMC' });
    expect(pg.rows.map((r) => r.personalNo)).toEqual(['E-1', 'E-2']);
    expect(previewPage(getPreview('T1', 'i1', 'r1'), { reading: 'hires|2030-01-01|' }).total).toBe(0);
  });

  it('search across every field, and paging', () => {
    keepPreview('r1', entry());
    const e = getPreview('T1', 'i1', 'r1');
    expect(previewPage(e, { q: 'xnrel' }).rows.map((r) => r.personalNo)).toEqual(['E-3']);
    const p2 = previewPage(e, { offset: 4, limit: 2 });
    expect(p2.rows.map((r) => r.personalNo)).toEqual(['E-5', 'E-6']);
    expect(previewPage(e, { limit: 100000 }).rows.length).toBe(6);
  });

  it('another tenant or integration never sees them; an unknown run says "not kept"', () => {
    keepPreview('r1', entry());
    expect(getPreview('T2', 'i1', 'r1')).toBeNull();
    expect(getPreview('T1', 'i2', 'r1')).toBeNull();
    expect(previewPage(null, {})).toMatchObject({ available: false, rows: [] });
  });
});
