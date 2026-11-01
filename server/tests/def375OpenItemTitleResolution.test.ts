/**
 * DEF-375 — the owner's answer must not die on duplicate titles
 * (`guard-destroys-the-answer`; the executor half of DEF-333's
 * `pending-prompt-eats-command` family).
 *
 * Measured live (B04 re-measure, iteration 83): the model bound "Priority
 * high." correctly with `update_open_item`, and DEF-103's lookup found TWO
 * rows with the byte-identical title — two "Define rules for Brain's
 * responsiveness to new vs. existing contacts" drafts (2026-09-08 and
 * 2026-10-28, both real rows in TMC-0001). `exact.length === 2` resolved
 * nothing, the dispatch reported "could not find" (false — it found two), and
 * the sanitizer shipped "I couldn't put together an answer I trust".
 *
 * The decision now lives in resolveOpenItemByTitle: unique exact wins; N>1
 * exact are indistinguishable duplicates, so the NEWEST wins (no clarifying
 * question can be phrased between identical titles); DIFFERENT-titled partial
 * matches stay null — a question, never a fuzzy guess. These tests pin the
 * decision on the real failing data, and the wiring pins keep the dispatch
 * building through it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import { resolveOpenItemByTitle } from '../src/services/knowledge/openItemTitleResolution';

const B04_TITLE = "Define rules for Brain's responsiveness to new vs. existing contacts";

const row = (id: string, title: string, createdAt?: string) => ({ id, title, createdAt });

describe('DEF-375 — duplicate exact titles resolve to the newest, not to a dead turn', () => {
  it('THE LIVE CASE: the two real same-titled drafts resolve to the 10-28 row', () => {
    const older = row('cmtsnivmx0007', B04_TITLE, '2026-09-08T12:34:22.761Z');
    const newer = row('cmvrkjfmw0017', B04_TITLE, '2026-10-28T03:42:28.329Z');
    expect(resolveOpenItemByTitle([older, newer], B04_TITLE)).toBe(newer);
    // Order of candidates must not matter — the pick is by date, not position.
    expect(resolveOpenItemByTitle([newer, older], B04_TITLE)).toBe(newer);
  });

  it('a dated duplicate always beats one with no createdAt', () => {
    const undated = row('a', B04_TITLE);
    const dated = row('b', B04_TITLE, '2026-01-01T00:00:00.000Z');
    expect(resolveOpenItemByTitle([undated, dated], B04_TITLE)).toBe(dated);
  });

  it('case and whitespace variants count as the same exact title', () => {
    const a = row('a', `  ${B04_TITLE.toUpperCase()}  `, '2026-09-08T00:00:00.000Z');
    const b = row('b', B04_TITLE, '2026-10-28T00:00:00.000Z');
    expect(resolveOpenItemByTitle([a, b], B04_TITLE)?.id).toBe('b');
  });
});

describe('DEF-375 — the DEF-103 ladder is unchanged everywhere else', () => {
  it('a unique exact match wins over longer contains-matches', () => {
    const exact = row('a', 'Vision Metric Integration', '2026-01-01T00:00:00.000Z');
    const superset = row('b', 'Vision Metric Integration — phase 2', '2026-06-01T00:00:00.000Z');
    expect(resolveOpenItemByTitle([superset, exact], 'Vision Metric Integration')).toBe(exact);
  });

  it('a single contains-only candidate is a resolution', () => {
    const only = row('a', 'Vision Metric Integration — phase 2');
    expect(resolveOpenItemByTitle([only], 'Vision Metric')).toBe(only);
  });

  it('DIFFERENT-titled partial matches stay a question — never a newest-first guess', () => {
    // The mutation this exists to kill: extending the newest-first pick to
    // contains-matches would silently update the wrong item (target grounding).
    const a = row('a', 'Chase Hamna about the Q3 plan', '2026-10-01T00:00:00.000Z');
    const b = row('b', 'Chase Hamna about the invoice', '2026-10-20T00:00:00.000Z');
    expect(resolveOpenItemByTitle([a, b], 'Chase Hamna')).toBeNull();
  });

  it('zero candidates and a blank lookup both resolve to nothing', () => {
    expect(resolveOpenItemByTitle([], B04_TITLE)).toBeNull();
    expect(resolveOpenItemByTitle([row('a', B04_TITLE)], '   ')).toBeNull();
  });
});

describe('DEF-375 — the wiring: the dispatch decides through this module', () => {
  const composer = fs.readFileSync(
    path.join(__dirname, '../src/services/knowledge/brainComposer.ts'), 'utf8',
  );

  it('the update_open_item title lookup resolves via resolveOpenItemByTitle', () => {
    expect(composer).toContain('existing = resolveOpenItemByTitle(byTitle, lookupTitle);');
    expect(composer).toMatch(/import \{ resolveOpenItemByTitle \} from '\.\/openItemTitleResolution'/);
  });

  it('the lookup fetches createdAt — without it the newest-duplicate pick is blind', () => {
    const site = composer.indexOf('existing = resolveOpenItemByTitle(byTitle, lookupTitle);');
    expect(site).toBeGreaterThan(-1);
    const windowBefore = composer.slice(Math.max(0, site - 700), site);
    expect(windowBefore).toContain('createdAt: true');
  });
});
