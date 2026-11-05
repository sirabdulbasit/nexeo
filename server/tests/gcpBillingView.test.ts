/**
 * Actual GCP cost. Pinned: net includes credits; Pacific days; unfinished days never in an average;
 * an empty export wipes nothing; a bad key is never echoed; every route is super admin only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const exec = vi.fn();
const query = vi.fn();
const transaction = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: {
  $executeRawUnsafe: (...a: any[]) => exec(...a),
  $queryRawUnsafe: (...a: any[]) => query(...a),
  $transaction: (...a: any[]) => transaction(...a),
} }));

import { completeAverage, dailySql, isIncomplete, labelSql, markDays, pacificDay, readCredentials, syncBilling } from '../src/services/gcpBilling/gcpBillingService';
import gcpRouter from '../src/routes/admin/gcpBillingRoutes';
import { requireSuperAdmin } from '../src/middleware/auth';

beforeEach(() => { exec.mockReset(); query.mockReset(); transaction.mockReset(); exec.mockResolvedValue(1); transaction.mockResolvedValue([]); });

describe('the billing queries', () => {
  it.each([['daily', dailySql], ['label', labelSql]])('%s keeps gross and credits, unrounded, on Pacific days', (_n, sql) => {
    const s = (sql as (d: string) => string)('2026-11-01');
    expect(s).toContain('SUM(CAST(t.cost AS NUMERIC)) AS gross');
    expect(s).toContain('FROM UNNEST(t.credits) c');
    expect(s).toContain("DATE(t.usage_start_time, 'America/Los_Angeles')");
    expect(s).toContain('t.invoice.month');
    expect(s).not.toContain('ROUND');
  });
  it('labels come from the row labels', () => { expect(labelSql('2026-11-01')).toContain('UNNEST(t.labels) l'); });
});

describe('unfinished days', () => {
  it('uses the Pacific date', () => { expect(pacificDay(new Date('2026-11-05T05:00:00Z'))).toBe('2026-11-04'); });
  it('marks the latest three days only', () => {
    expect(isIncomplete('2026-11-10', '2026-11-10')).toBe(true);
    expect(isIncomplete('2026-11-08', '2026-11-10')).toBe(true);
    expect(isIncomplete('2026-11-07', '2026-11-10')).toBe(false);
  });
  it('leaves them and the first export day out of the average', () => {
    const days = markDays([
      { day: '2026-11-05', gross: 1, net: 1 }, { day: '2026-11-06', gross: 4, net: 4 }, { day: '2026-11-07', gross: 6, net: 6 },
      { day: '2026-11-10', gross: 0.1, net: 0.1 },
    ], '2026-11-10', '2026-11-05');
    expect(completeAverage(days)).toBe(5);
  });
  it('has no average when no day is finished', () => {
    expect(completeAverage(markDays([{ day: '2026-11-10', gross: 1, net: 1 }], '2026-11-10', null))).toBeNull();
  });
});

describe('loading', () => {
  it('an empty export deletes nothing and records the failure', async () => {
    await expect(syncBilling(new Date('2026-11-10T00:00:00Z'), async () => [])).rejects.toThrow('no rows');
    expect(transaction).not.toHaveBeenCalled();
    expect(exec.mock.calls[0][0]).toContain('last_error');
  });
  it('a good load replaces the window, carrying credits as given', async () => {
    const run = async (sql: string) => sql.includes('UNNEST(t.labels)') ? [] : [{ day: '2026-11-06', invoice_month: '202611', project_id: 'p', project_name: 'P', service: 's', sku: 'k', gross: '2.5', credits: '-1' }];
    await syncBilling(new Date('2026-11-10T00:00:00Z'), run);
    expect(transaction).toHaveBeenCalledOnce();
    const insert = exec.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO gcp_billing_daily'))!;
    expect(JSON.parse(insert[1])[0]).toMatchObject({ gross: '2.5', credits: '-1' });
  });
  it('a broken key is never quoted in the error', () => {
    process.env.GCP_BILLING_SA_JSON = '{"private_key": SECRET-VALUE';
    try { expect(() => readCredentials()).toThrow(/^The billing key could not be read$/); }
    finally { delete process.env.GCP_BILLING_SA_JSON; }
  });
});

describe('access', () => {
  it('the router is gated by super admin before any route', () => {
    const stack = (gcpRouter as any).stack;
    const firstRoute = stack.findIndex((l: any) => l.route);
    const gate = stack.findIndex((l: any) => l.handle === requireSuperAdmin);
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(gate).toBeLessThan(firstRoute);
  });
});
