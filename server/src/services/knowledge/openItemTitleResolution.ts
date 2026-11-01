/**
 * DEF-375 — resolving WHICH open item a title refers to, decomposed from the
 * update dispatch so the decision is pure and testable.
 *
 * The B04 re-measure (iteration 83) caught the live failure this closes: the
 * owner answered Brain's own question ("Priority high."), the model bound it
 * correctly (`update_open_item` with the right titleRef), and DEF-103's lookup
 * found TWO rows carrying the byte-identical title — real data: two "Define
 * rules for Brain's responsiveness to new vs. existing contacts" drafts,
 * created 09-08 and 10-28. `exact.length === 2` resolved nothing, the dispatch
 * fell through to a "could not find" marker (false — it found two), and the
 * sanitizer shipped the distrust fallback. His answer died in the executor
 * AFTER the model got it right — `guard-destroys-the-answer`.
 *
 * The rule this module adds: multiple EXACT matches are, by construction,
 * case/whitespace variants of ONE title — the user cannot tell them apart by
 * any clarifying question, so asking is not an available move. The NEWEST row
 * is the referent: in the live shape Brain has just created a draft and asked
 * for its priority and deadline, so the most recent duplicate is the one under
 * discussion. Partial (contains) matches with DIFFERENT titles stay
 * unresolved — genuinely a question, never a fuzzy best-guess, because
 * updating the WRONG item silently is far worse than asking (target
 * grounding). DEF-103's ladder is otherwise unchanged: id, then unique exact,
 * then unique contains.
 */
export type OpenItemCandidate = {
  id: string;
  title: string;
  createdAt?: Date | string | null;
};

export function resolveOpenItemByTitle<T extends OpenItemCandidate>(
  candidates: T[],
  lookupTitle: string,
): T | null {
  const norm = (s: string) => s.trim().toLowerCase();
  const wanted = norm(lookupTitle ?? '');
  if (!wanted) return null;

  const exact = candidates.filter((c) => norm(c.title) === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    // Indistinguishable duplicates of one title: deterministic, newest first.
    // A row without createdAt sorts as oldest — a dated duplicate always wins.
    const at = (c: OpenItemCandidate) =>
      c.createdAt ? new Date(c.createdAt).getTime() : 0;
    return [...exact].sort((a, b) => at(b) - at(a))[0];
  }

  if (candidates.length === 1) return candidates[0];
  return null;
}
