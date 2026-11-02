/**
 * DEF-378 — a paraphrased titleRef against identical-titled duplicates must
 * not die either (`guard-destroys-the-answer`; Codex it-83 finding #1, the
 * completeness gap in DEF-375).
 *
 * DEF-375 resolved N>1 EXACT matches (byte-identical duplicates) to the
 * newest. But the same two duplicates reached by a CONTAINS match — the model
 * truncates or paraphrases the title it is referring to — gave exact=0,
 * candidates=2 → null → the same false "could not find" → distrust fallback.
 * The duplicates are no less indistinguishable because the reference was
 * partial: if EVERY candidate carries one normalized title, they are copies
 * of one item and the newest wins. Any differing title among the candidates
 * is real ambiguity and stays a question (target grounding — never a fuzzy
 * guess).
 */
import { describe, it, expect } from 'vitest';

import { resolveOpenItemByTitle } from '../src/services/knowledge/openItemTitleResolution';

const B04_TITLE = "Define rules for Brain's responsiveness to new vs. existing contacts";

const row = (id: string, title: string, createdAt?: string) => ({ id, title, createdAt });

describe('DEF-378 — contains-matched duplicates of ONE title resolve to the newest', () => {
  const older = row('cmtsnivmx0007', B04_TITLE, '2026-09-08T12:34:22.761Z');
  const newer = row('cmvrkjfmw0017', B04_TITLE, '2026-10-28T03:42:28.329Z');

  it("THE REVIEWER'S SCENARIO: a truncated titleRef against the two real duplicates lands on the newest", () => {
    const resolved = resolveOpenItemByTitle([older, newer], "Define rules for Brain's responsiiveness".replace('iiv', 'iv'));
    expect(resolved).toBe(newer);
  });

  it('order of candidates does not matter — the pick is by date, not position', () => {
    expect(resolveOpenItemByTitle([newer, older], 'responsiveness to new vs. existing')).toBe(newer);
  });

  it('case variants of one title still count as ONE normalized title', () => {
    const shouty = row('a', B04_TITLE.toUpperCase(), '2026-01-01T00:00:00.000Z');
    const plain = row('b', B04_TITLE, '2026-06-01T00:00:00.000Z');
    expect(resolveOpenItemByTitle([shouty, plain], 'Define rules')?.id).toBe('b');
  });
});

describe('DEF-378 — real ambiguity is untouched: differing titles still resolve to nothing', () => {
  it('two duplicates PLUS one differently-titled candidate stay a question', () => {
    // The mutation this kills: relaxing "every candidate shares one title" to
    // "most do" would silently update the wrong item when a genuinely
    // different item also matched the partial reference.
    const dupA = row('a', B04_TITLE, '2026-09-08T00:00:00.000Z');
    const dupB = row('b', B04_TITLE, '2026-10-28T00:00:00.000Z');
    const other = row('c', 'Define rules for escalation emails', '2026-10-01T00:00:00.000Z');
    expect(resolveOpenItemByTitle([dupA, dupB, other], 'Define rules')).toBeNull();
  });

  it('two candidates with different titles stay a question (the DEF-375 pin, unchanged)', () => {
    const a = row('a', 'Chase Hamna about the Q3 plan', '2026-10-01T00:00:00.000Z');
    const b = row('b', 'Chase Hamna about the invoice', '2026-10-20T00:00:00.000Z');
    expect(resolveOpenItemByTitle([a, b], 'Chase Hamna')).toBeNull();
  });
});
