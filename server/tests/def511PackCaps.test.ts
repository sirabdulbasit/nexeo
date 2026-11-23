/**
 * DEF-511 (19 Nov): a slow outside read must not hold the day pack past Suzi's 20 s limit.
 *  CAP     a part slower than its cap answers its fallback and is recorded as capped;
 *  PASS    a fast part answers its own value and its time;
 *  ERROR   a part that fails still throws (the cap is not a catch);
 *  LATE    a capped part that fails later raises no unhandled rejection.
 */
import { describe, it, expect } from 'vitest';
import { capped, PART_CAP_MS, ATTENTION_CAP_MS, PACK_SLOW_MS } from '../src/services/suzi/dayPack';

const wait = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

describe('DEF-511 capped parts', () => {
  it('CAP: past the cap the fallback answers', async () => {
    const t: Record<string, number | string> = {};
    expect(await capped(t, 'calendar', () => wait(200, 'late'), 'fallback', 20)).toBe('fallback');
    expect(t.calendar).toBe('capped>20');
  });
  it('PASS: a fast part answers its own value', async () => {
    const t: Record<string, number | string> = {};
    expect(await capped(t, 'drafts', () => wait(1, { drafts_count: 3 }), {}, 500)).toEqual({ drafts_count: 3 });
    expect(typeof t.drafts).toBe('number');
  });
  it('ERROR: a failing part still throws', async () => {
    await expect(capped({}, 'x', () => Promise.reject(new Error('boom')), null, 500)).rejects.toThrow('boom');
  });
  it('LATE: a capped part that fails afterwards is not unhandled', async () => {
    const out = await capped({}, 'x', () => new Promise((_, rej) => setTimeout(() => rej(new Error('late')), 30)), 'fb', 5);
    expect(out).toBe('fb');
    await wait(60, null);
  });
  it('the caps stay inside Suzi\'s 20 s read', () => {
    expect(ATTENTION_CAP_MS + PART_CAP_MS).toBeLessThan(20_000);
    expect(PACK_SLOW_MS).toBe(5000);
  });
});
