/**
 * Wiki structure part 8 — a source knows which version of its text it holds
 * (docs/Wiki-Knowledge.md §0.13; review finding: "reconciliation checks source
 * existence/text presence, and email recovery uses text length").
 *
 * `keepsHeldText` is the one rule: the store applies it inside the transaction
 * that writes the source, and the reconcile applies its mirror (`needsLanding`,
 * tested in wikiReconcile.test.ts). The store itself is exercised on the real
 * database.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

import { keepsHeldText, textHash, textOf } from '../src/services/wiki/wikiSources';

const at = (d: string) => new Date(`${d}T00:00:00Z`);
const held = (text: string, asOf: string | null, isPreview = false) =>
  ({ hasText: text.length > 0, hash: text ? textHash(text) : null, asOf: asOf ? at(asOf) : null, isPreview });
const incoming = (text: string, asOf: string, isPreview = false) => ({ hash: text ? textHash(text) : null, asOf: at(asOf), isPreview });

describe('a source knows which version of its text it holds', () => {
  it('a blank never replaces text, and anything fills an empty source', () => {
    expect(keepsHeldText(held('the email', '2026-11-01'), incoming('', '2026-11-09'))).toBe(true);
    expect(keepsHeldText(null, incoming('first text', '2026-11-01'))).toBe(false);
    expect(keepsHeldText(held('', null), incoming('first text', '2026-11-01'))).toBe(false);
    expect(keepsHeldText(held('', null), incoming('snippet…', '2026-11-01', true))).toBe(false);
  });

  it('a correction of the same length is taken', () => {
    expect(keepsHeldText(held('Meet at 10:00', '2026-11-01'), incoming('Meet at 11:00', '2026-11-02'))).toBe(false);
  });

  it('a newer text is taken even when it is shorter', () => {
    expect(keepsHeldText(held('A long description of the agenda.', '2026-11-01'), incoming('Cancelled.', '2026-11-02'))).toBe(false);
  });

  it('an older text arriving late does not replace the newer one', () => {
    expect(keepsHeldText(held('Cancelled.', '2026-11-02'), incoming('A long description of the agenda.', '2026-11-01'))).toBe(true);
  });

  it('a replay of the same text changes nothing', () => {
    expect(keepsHeldText(held('Same text', '2026-11-01'), incoming('Same text', '2026-11-05'))).toBe(true);
    expect(keepsHeldText(held('Same text', '2026-11-05'), incoming('Same text', '2026-11-01'))).toBe(true);
  });

  it('a preview never replaces text, and any full text replaces a preview whatever their order', () => {
    expect(keepsHeldText(held('The whole email.', '2026-11-01'), incoming('The whole…', '2026-11-09', true))).toBe(true);
    expect(keepsHeldText(held('The whole…', '2026-11-09', true), incoming('The whole email.', '2026-11-01'))).toBe(false);
    // Between two previews the first is kept: a preview is never treated as newer text.
    expect(keepsHeldText(held('The whole…', '2026-11-01', true), incoming('The wh…', '2026-11-09', true))).toBe(true);
  });

  it('text landed before versions existed (no date) is replaced by a different full text', () => {
    expect(keepsHeldText(held('old text', null), incoming('new text', '2026-11-01'))).toBe(false);
  });

  it('a text is stored trimmed, and a structured value as written', () => {
    expect(textOf('  hi \n')).toBe('hi');
    expect(textOf(null)).toBe('');
    expect(textOf({ a: 1 })).toBe('{"a":1}');
    expect(textHash('hi')).toBe(textHash(textOf(' hi ')));
  });
});
