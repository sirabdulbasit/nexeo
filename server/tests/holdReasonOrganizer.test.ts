/**
 * Suzi 24 Nov 2026 (12:51 and 09:31). Pinned:
 *  REASON     a held send says why: not_signed, then sends_off, then google_not_connected; null when it may go.
 *  ORGANIZER  each pack event names its organiser, or null when it is him.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const flag = vi.hoisted(() => ({ off: '' }));
const user = vi.hoisted(() => ({ row: { integrationProvider: 'google', integrationStatus: 'active' } as any }));
vi.mock('../src/services/featureFlagService', () => ({ getFlagValue: async () => flag.off }));
vi.mock('../src/db/prisma', () => ({ default: { user: { findFirst: async () => user.row } } }));

import { sendBlockReason } from '../src/services/suzi/suziSend';
import { packCalendar } from '../src/services/suzi/dayPack';

describe('REASON', () => {
  beforeEach(() => { flag.off = ''; user.row = { integrationProvider: 'google', integrationStatus: 'active' }; });
  it('unsigned is not_signed, even with Google active', async () => {
    expect(await sendBlockReason('T', 2, { signatureVerified: false })).toBe('not_signed');
  });
  it('signed, but on the off switch, is sends_off', async () => {
    flag.off = '5, 2';
    expect(await sendBlockReason('T', 2, { signatureVerified: true })).toBe('sends_off');
  });
  it('signed, Google not active, is google_not_connected', async () => {
    user.row = { integrationProvider: 'google', integrationStatus: 'expired' };
    expect(await sendBlockReason('T', 2, { signatureVerified: true })).toBe('google_not_connected');
  });
  it('signed (or by rule) with Google active may go', async () => {
    expect(await sendBlockReason('T', 2, { signatureVerified: true })).toBeNull();
    expect(await sendBlockReason('T', 2, { byRule: 'r1' })).toBeNull();
  });
});

describe('ORGANIZER', () => {
  const people = { own: new Set(['me@x.com']), names: new Map([['syeda@x.com', 'Syeda Uzma Shah']]) };
  it('names someone else as organiser, with the name from people first', () => {
    const c = packCalendar([{ id: 'a', start: '2026-11-25T06:00:00Z', title: 'Green Belt', organizer: { email: 'Syeda@x.com', displayName: 'S' } } as any], '2026-11-25', 'Asia/Karachi', new Map(), people as any);
    expect(c.today[0].organizer).toEqual({ name: 'Syeda Uzma Shah', email: 'syeda@x.com' });
    expect(c.today[0].organizer_self).toBe(false);
  });
  it('is null when he organised it, or when there is no organiser', () => {
    const c = packCalendar([
      { id: 'b', start: '2026-11-25T07:00:00Z', title: 'Mine', organizer: { email: 'me@x.com' } },
      { id: 'c', start: '2026-11-25T08:00:00Z', title: 'None' },
    ] as any, '2026-11-25', 'Asia/Karachi', new Map(), people as any);
    expect(c.today.map((e) => e.organizer)).toEqual([null, null]);
  });
});
