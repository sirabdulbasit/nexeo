/**
 * DEF-514 (founder, 25 Nov 2026): "every record from integration should be part of wiki".
 * The per-record page cap was a WORKING limit (500) that silently left 610 of 1110
 * employees out. It is now only a safety ceiling: default = ceiling = 5000, and every
 * fallback agrees, so no copy of the old 500 can come back unnoticed.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { BEHAVIOR_SPECS } from '../src/services/behaviorConfig';

const src = (p: string) => fs.readFileSync(path.resolve(__dirname, '../src', p), 'utf8');

describe('DEF-514 every integration record lands in the Wiki', () => {
  it('the default page cap is the ceiling (5000), not a working limit', () => {
    const spec = (BEHAVIOR_SPECS as any)['integrations.max_context_pages'];
    expect(spec.def).toBe(5000);
    expect(spec.def).toBe(spec.max);
  });
  it('a 1110-record directory fits under the default', () => {
    expect((BEHAVIOR_SPECS as any)['integrations.max_context_pages'].def).toBeGreaterThanOrEqual(1110);
  });
  it('the writer and the proposer fall back to the same 5000', () => {
    expect(src('services/integrations/engine/contextWriter.ts')).toMatch(/max_context_pages', \{ clientNumber: cn \}\)\.catch\(\(\) => 5000\)/);
    expect(src('services/integrations/mapping/aiProposer.ts')).toMatch(/const DEFAULT_MAX_CONTEXT_PAGES = 5000;/);
  });
});
