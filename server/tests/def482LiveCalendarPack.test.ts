/**
 * DEF-482 (founder 16 Nov 2026, Suzi screenshot): "TMC System Catalogues" was cancelled at 10:20:29 UTC (ok), but the
 * pack kept it (the synced feed copy never learns of a cancel), so Suzi tried to cancel it again, got not_found and
 * told him "it's still on your calendar". The pack now reads his live Google Calendar; the feed is the fallback only.
 */
import { describe, it, expect } from 'vitest';
import { livePackEvents } from '../src/services/suzi/dayPack';

describe('DEF-482 the pack reads the live calendar', () => {
  it('live events in, cancelled ones out; the window spans yesterday to past the week end', async () => {
    let win: [Date, Date] | null = null;
    const out = await livePackEvents(2, '2026-11-16', async (_u, a, b) => { win = [a, b]; return { events: [
      { id: 'pms', title: 'PMS System Demo', start: '2026-11-16T11:00:00+05:00', end: '2026-11-16T12:00:00+05:00', isAllDay: false, attendees: ['a@x.com'], organizer: 'me@x.com', link: 'https://meet.google.com/abc-defg-hij', status: 'confirmed' },
      { id: 'cat', title: 'TMC System Catalogues', start: '2026-11-16T15:30:00+05:00', end: '2026-11-16T16:30:00+05:00', isAllDay: false, attendees: [], status: 'cancelled' },
    ] }; });
    expect(out?.map((e) => e.eventId)).toEqual(['pms']);
    expect(out?.[0]).toMatchObject({ title: 'PMS System Demo', organizer: 'me@x.com', link: 'https://meet.google.com/abc-defg-hij' });
    expect(win![0].getTime()).toBeLessThan(Date.parse('2026-11-15T00:00:00Z'));
    expect(win![1].getTime()).toBeGreaterThan(Date.parse('2026-11-24T00:00:00Z'));
  });
  it('a read that fails gives null, so the synced copy is used; never an empty calendar by mistake', async () => {
    expect(await livePackEvents(2, '2026-11-16', async () => ({ events: [], error: 'Calendar error: 401' }))).toBeNull();
    expect(await livePackEvents(2, '2026-11-16', async () => { throw new Error('boom'); })).toBeNull();
  });
  it('a calendar that is really empty stays empty (not the stale copy)', async () => {
    expect(await livePackEvents(2, '2026-11-16', async () => ({ events: [] }))).toEqual([]);
  });
});
