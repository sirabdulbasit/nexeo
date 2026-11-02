/**
 * DEF-379 — an update that misses its target speaks, instead of the distrust
 * fallback (`guard-destroys-the-answer`; Codex it-83 finding #2 / directive #2).
 *
 * Measured B04 death: the model consumes the owner's answer ("Priority high.")
 * and emits `update_open_item`; when the target cannot be resolved the
 * dispatch minted a HAND-BUILT `[update_open_item: could not find …]` string
 * with no curated meaning, so the sanitizer shipped "I couldn't put together
 * an answer I trust for that one" — the owner's correct answer replaced by a
 * machine shrug.
 *
 * Fix: the failure joins the itemOutcome family (actionReceipt.ts —
 * constructor and renderer in ONE module, the DEF-238 contract), so the
 * sanitizer holds a meaning BY CONSTRUCTION. The fact it carries is honest:
 * nothing was changed; what he provided was heard but NOT applied; and when
 * several DIFFERENT items matched, their titles — material for a real
 * question with options. Wording stays with the model
 * (`renderMarkerInBrainVoice` phrases the fact). No success is ever claimed:
 * no-claim-without-a-receipt is the guardrail this enforces.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import { itemOutcomeMarker, itemOutcomeMeaning } from '../src/services/knowledge/actionReceipt';
import { curatedMarkerMeaning } from '../src/services/knowledge/answerSanitizer';
import { stripMarkerEnvelope } from '../src/services/knowledge/systemMarker';

const B04_TITLE = "Define rules for Brain's responsiveness to new vs. existing contacts";

// The meaning functions receive what the sanitizer hands them: the marker with
// its provenance sentinel stripped (answerSanitizer.ts:551 —
// `curatedMarkerMeaning(stripMarkerEnvelope(answer))`). Mirror that path.
const meaningOf = (marker: string) => itemOutcomeMeaning(stripMarkerEnvelope(marker));
const curatedOf = (marker: string) => curatedMarkerMeaning(stripMarkerEnvelope(marker));

describe('DEF-379 — the not-found update failure has a curated meaning by construction', () => {
  const marker = itemOutcomeMarker({
    verb: 'updated',
    ok: false,
    title: B04_TITLE,
    why: `no open item matching "${B04_TITLE}" was found`,
    heard: 'priority: high',
  });

  it('THE CLASS ASSERTION: the real sanitizer resolves the minted marker — the neutral fallback is unreachable for this family', () => {
    expect(curatedOf(marker)).not.toBeNull();
  });

  it('the meaning says plainly that nothing happened, and never claims the update', () => {
    const meaning = meaningOf(marker)!;
    expect(meaning).toContain('did not happen');
    expect(meaning).toContain('nothing was changed');
    expect(meaning).toContain(`no open item matching "${B04_TITLE}" was found`);
    expect(meaning).not.toContain('was updated just now');
  });

  it("the owner's provided values ride the fact — heard, not applied", () => {
    const meaning = meaningOf(marker)!;
    expect(meaning).toContain('priority: high');
    expect(meaning).toContain('understood but not applied');
  });

  it('without heard values there is no provided-clause — nothing is invented', () => {
    const bare = itemOutcomeMarker({ verb: 'updated', ok: false, title: B04_TITLE, why: 'x was not found' });
    expect(meaningOf(bare)).not.toContain('understood but not applied');
  });

  it('the ambiguous case carries the differing candidate titles through to the fact', () => {
    const m = itemOutcomeMarker({
      verb: 'updated',
      ok: false,
      title: 'Define rules',
      why: '2 different open items matched — "Define rules for Brain", "Define rules for escalation emails"',
      heard: 'due: monday',
    });
    const meaning = meaningOf(m)!;
    expect(meaning).toContain('"Define rules for Brain"');
    expect(meaning).toContain('"Define rules for escalation emails"');
    expect(curatedOf(m)).not.toBeNull();
  });

  it('a successful update renders as one, and an unnameable success is rejected (fabricated-status guard)', () => {
    expect(meaningOf(itemOutcomeMarker({ verb: 'updated', ok: true, title: B04_TITLE })))
      .toContain('was updated just now');
    expect(meaningOf(itemOutcomeMarker({ verb: 'updated', ok: true }))).toBeNull();
  });
});

describe('DEF-379 — the wiring: the dispatch mints through the family, the hand-built string is gone', () => {
  const composer = fs.readFileSync(
    path.join(__dirname, '../src/services/knowledge/brainComposer.ts'), 'utf8',
  );

  it('the old uncurated marker literal no longer exists in the composer', () => {
    expect(composer).not.toContain('[update_open_item: could not find');
  });

  it('the failure branch mints itemOutcomeMarker with the updated verb', () => {
    const site = composer.indexOf("existing = resolveOpenItemByTitle(byTitle, lookupTitle);");
    expect(site).toBeGreaterThan(-1);
    const windowAfter = composer.slice(site, site + 2600);
    expect(windowAfter).toContain('itemOutcomeMarker({');
    expect(windowAfter).toContain("verb: 'updated'");
    expect(composer).toMatch(/import \{[^}]*itemOutcomeMarker[^}]*\} from '\.\/actionReceipt'/);
  });
});
