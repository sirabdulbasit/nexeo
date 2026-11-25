/**
 * DEF-515 (founder, 25 Nov 2026): "every integration should go to wiki as per its run".
 * (1) After every REAL run its system, KPI and business-unit notes are rebuilt;
 *     a dry run (test) never touches the Wiki; a Wiki failure never changes the run.
 * (2) The Wiki screen lists every note type that has notes (none hidden).
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rebuild = vi.fn();
vi.mock('../src/services/wiki/wikiSystems', () => ({ rebuildSystemsForClient: (cn: string) => rebuild(cn) }));
const runIntegration = vi.fn();
vi.mock('../src/services/integrations/engine/runEngine', () => ({ runIntegration: (...a: unknown[]) => runIntegration(...a) }));
vi.mock('../src/config/prisma', () => ({ default: {} }));

import { startRun, refreshWikiAfterRun } from '../src/services/integrations/engine/runJobs';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('DEF-515 the Wiki follows every integration run', () => {
  beforeEach(() => { rebuild.mockReset(); runIntegration.mockReset(); });

  it('a real run rebuilds the client\'s system/KPI/business-unit notes', async () => {
    rebuild.mockResolvedValue({ notes: 3, written: 1, kpis: 1 });
    runIntegration.mockResolvedValue({ runId: 'r1' });
    await startRun('TMC-0001', 'i1', { dryRun: false, trigger: 'manual', triggeredBy: 'u' } as any);
    await flush(); await flush();
    expect(rebuild).toHaveBeenCalledWith('TMC-0001');
  });

  it('a test (dry run) never touches the Wiki', async () => {
    runIntegration.mockResolvedValue({ runId: 'r2' });
    await startRun('TMC-0001', 'i1', { dryRun: true, trigger: 'manual', triggeredBy: 'u' } as any);
    await flush(); await flush();
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('a Wiki failure is swallowed, never thrown into the run', async () => {
    rebuild.mockRejectedValue(new Error('wiki down'));
    await expect(refreshWikiAfterRun('TMC-0001', 'i1')).resolves.toBeUndefined();
  });

  it('the Wiki screen lists every type that has notes, known ones first', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../client/src/pages/WikiPage.jsx'), 'utf8');
    expect(src).toMatch(/NOTE_TYPE_ORDER = \[[^\]]*'system', 'kpi', 'business_unit'/);
    expect(src).toContain("const rest = [...map.keys()].filter((t) => !order.includes(t))");
    expect(src).not.toMatch(/\.filter\(\(t\) => map\.has\(t\)\)\s*\n\s*\.map\(\(t\) => \(\{ pageType: t, n: map\.get\(t\) \}\)\);/);
  });
});
