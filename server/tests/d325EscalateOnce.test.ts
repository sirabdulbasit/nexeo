/**
 * D-325 (T49; Suzi-Builder 26 Nov 09:59 "I escalated it (9 times)"). Found: ten daily notes to HIM (escalate_user,
 * 17-26 Nov) "No working WhatsApp or email route for Sofia Rana"; nothing was sent to her. The route is missing by
 * policy (WhatsApp is his only; email to others is off), so it never came back and he was told every day.
 * Pinned:
 *  1. alreadyTold: the same reason already escalated on this task → not told again (a week's rest instead);
 *     a new reason is told.
 *  2. followedUpRecently: his own follow-up in the last 3 days (metadata.lastFollowupAt) → nobody chased, not told.
 *  3. The sweep checks both BEFORE contacting anyone (source order).
 *  4. History: escalate_user reads "Nexeo told you" with the reason, repeats fold into one line with a count.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
vi.mock('../src/db/prisma', () => ({ default: {} }));
import { alreadyTold, followedUpRecently, REST_AFTER_TOLD_MS } from '../src/jobs/actionLifecycleWorker';
import { historyOf } from '../src/services/suzi/taskHistory';

const REASON = 'No working WhatsApp or email route for Sofia Rana';
const now = new Date('2026-11-26T13:55:00Z');

describe('D-325 told once', () => {
  it('ONCE: the same reason is not told twice; another reason is', () => {
    expect(alreadyTold({ interventionReason: REASON, escalatedAt: '2026-11-17T10:43:04Z' }, REASON)).toBe(true);
    expect(alreadyTold({ interventionReason: 'blocked: waiting for budget', escalatedAt: '2026-11-17T10:43:04Z' }, REASON)).toBe(false);
    expect(alreadyTold({ interventionReason: REASON, escalatedAt: null }, REASON)).toBe(false);
    expect(alreadyTold(null, REASON)).toBe(false);
    expect(REST_AFTER_TOLD_MS).toBe(7 * 24 * 3600_000);
  });
  it('HIS FOLLOW-UP: within 3 days holds; older or missing does not', () => {
    expect(followedUpRecently({ lastFollowupAt: '2026-11-25T08:15:00Z' }, now)).toBe(true);
    expect(followedUpRecently({ lastFollowupAt: '2026-11-20T08:15:00Z' }, now)).toBe(false);
    expect(followedUpRecently({}, now)).toBe(false);
    expect(followedUpRecently({ lastFollowupAt: 'garbage' }, now)).toBe(false);
  });
  it('ORDER: the sweep checks before contacting anyone', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/jobs/actionLifecycleWorker.ts'), 'utf8');
    const sweep = src.slice(src.indexOf('export async function runActionLifecycleSweep'));
    expect(sweep.indexOf('followedUpRecently(item.metadata, now)')).toBeGreaterThan(0);
    expect(sweep.indexOf('followedUpRecently(item.metadata, now)')).toBeLessThan(sweep.indexOf('contactConcernedParty(item'));
    const noRoute = sweep.slice(sweep.indexOf('No working WhatsApp or email route'));
    expect(noRoute.indexOf('alreadyTold(current, interventionReason)')).toBeGreaterThan(0);
    expect(noRoute.indexOf('alreadyTold(current, interventionReason)')).toBeLessThan(noRoute.indexOf('contactOwner('));
  });
});

describe('D-325 history words', () => {
  it('escalate_user is "Nexeo told you" with the reason, ten days are one line', () => {
    const h = Array.from({ length: 10 }, (_, i) => ({ at: new Date(Date.UTC(2026, 10, 17 + i, 10)).toISOString(), event: 'escalate_user', channel: 'brain_prompt', summary: REASON }));
    const out = historyOf({ createdAt: new Date('2026-11-16T08:00:00Z'), metadata: { actionLifecycle: { followUpHistory: h } } }, [], 2);
    expect(out[0]).toMatchObject({ who: 'Nexeo', change: 'Nexeo told you (10 times)', note: REASON });
    expect(out.map((e) => e.change).join('|')).not.toMatch(/escalated/);
  });
});
