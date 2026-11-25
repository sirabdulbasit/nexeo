import { describe, it, expect } from 'vitest';
// @ts-ignore client JS module
import { lastRunCountsText } from '../../client/src/pages/admin/integrations/integrationLogic.js';

const live = (o: any = {}) => ({ dryRun: false, status: 'SUCCESS', trigger: 'manual', triggeredBy: 'user:2',
  result: { recordsRead: 1113, writes: 616, context: { unchanged: 497, failed: 0 } }, ...o });

describe('DEF-516 last run counts on the integration card', () => {
  it('shows read, written, unchanged and failed for the last live run', () => {
    expect(lastRunCountsText([live()])).toBe('Manual (Run now) · read 1,113 records · wrote 616 · 497 unchanged · 0 failed');
  });
  it('says Scheduled for a scheduler run', () => {
    expect(lastRunCountsText([live({ trigger: 'scheduled', triggeredBy: 'scheduler' })])).toMatch(/^Scheduled · /);
  });
  it('skips tests (dry runs) and running rows', () => {
    const t = lastRunCountsText([live({ dryRun: true, result: { recordsRead: 5, writes: 1 } }), live({ status: 'RUNNING', result: null }), live()]);
    expect(t).toContain('read 1,113');
  });
  it('returns null with no finished live run', () => {
    expect(lastRunCountsText([])).toBeNull();
    expect(lastRunCountsText([live({ dryRun: true })])).toBeNull();
  });
});
