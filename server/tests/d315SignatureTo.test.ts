/**
 * Suzi 25 Nov 2026 (13:25, 14:02). Pinned:
 *  SIGN  his Settings signature replaces the writer's closing, once; no signature = the body unchanged.
 */
import { describe, it, expect } from 'vitest';
import { withSignature } from '../src/services/suzi/suziEmail';

describe('email signature', () => {
  it('SIGN: replaces a trailing closing and name with his signature', () => {
    expect(withSignature('Hi Sofia,\n\nPlease share the update.\n\nRegards,\nBasit', 'Best,\nBasit Ahmed\nTMC')).toBe('Hi Sofia,\n\nPlease share the update.\n\nBest,\nBasit Ahmed\nTMC');
    expect(withSignature('Hi,\n\nThanks for this.\nI will send it today.', 'Basit')).toBe('Hi,\n\nThanks for this.\nI will send it today.\n\nBasit');
  });
  it('SIGN: no signature set leaves the body as written', () => {
    expect(withSignature('Hi,\n\nRegards,\nBasit', null)).toBe('Hi,\n\nRegards,\nBasit');
  });
});

describe('email signature, never twice', () => {
  it('SIGN: a body already ending with his signature is unchanged', () => {
    const sig = 'Best,\nBasit Ahmed';
    expect(withSignature('Hi,\n\nDone.\n\nBest,\n  Basit Ahmed \n', sig)).toBe('Hi,\n\nDone.\n\nBest,\n  Basit Ahmed \n');
  });
});
