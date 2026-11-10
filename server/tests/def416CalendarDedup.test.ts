/**
 * DEF-416 (CL-070): the day brief listed each meeting twice. The calendar view read every gcal row as an event;
 * the poller writes a new row when an event changes. Pinned:
 *  1. one entry per event id, its latest version (rows are read newest first);
 *  2. a cancelled event is left out, even when an older row of it was confirmed;
 *  3. two different events at the same time both stay.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const find = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { feedEvent: { findMany: (...a: any[]) => find(...a) } } }));

import { getTodayCalendar } from '../src/services/views/calendar';

const today = new Date();
const at = (h: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h, 0, 0)).toISOString();
const row = (id: string, eventId: string, title: string, h: number, extra: any = {}) => ({ id, rawPayload: { eventId, title, start: at(h), end: at(h + 1), ...extra } });

beforeEach(() => find.mockReset());

describe('one meeting, one line', () => {
  it('the same event id twice: once, the newest version', async () => {
    find.mockResolvedValue([row('r2', 'ev1', 'Mentorship (moved)', 11), row('r1', 'ev1', 'Mentorship', 11), row('r3', 'ev2', 'Office', 6)]);
    const out = await getTodayCalendar({ clientNumber: 'T', userId: 2, opts: { timezone: 'UTC' } });
    expect(out.map((e) => e.title)).toEqual(['Office', 'Mentorship (moved)']);
    expect(find.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });
  it('cancelled in its latest version: left out', async () => {
    find.mockResolvedValue([row('r2', 'ev1', 'Mentorship', 11, { status: 'cancelled' }), row('r1', 'ev1', 'Mentorship', 11)]);
    expect(await getTodayCalendar({ clientNumber: 'T', userId: 2, opts: { timezone: 'UTC' } })).toEqual([]);
  });
  it('two different events at the same time both stay', async () => {
    find.mockResolvedValue([row('r1', 'evA', 'A', 11), row('r2', 'evB', 'B', 11)]);
    expect((await getTodayCalendar({ clientNumber: 'T', userId: 2, opts: { timezone: 'UTC' } })).length).toBe(2);
  });
});
