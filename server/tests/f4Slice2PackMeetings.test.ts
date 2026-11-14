/**
 * F-4 slice 2 (agreed 13 Nov 2026, suzi-b5): calendar attendees [{name, email, self?}] and organizer_self per event;
 * meetings_recorded[] of the last 24 hours with outcome, proposed count and a one-sentence summary on record_ready.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ rows: [] as any[], args: [] as any[], user: { email: 'Basit.Ahmed@tmcltd.com', integrationEmail: 'basit@gmail.com' } as any, names: [] as any[] }));
vi.mock('../src/db/prisma', () => ({ default: {
  user: { findUnique: async () => s.user },
  $queryRawUnsafe: async (q: string, ...a: any[]) => { s.args = a; return /meeting_records/.test(q) ? s.rows : s.names; },
} }));

import { packCalendar } from '../src/services/suzi/dayPack';
import { packPeople, meetingsRecorded, firstSentence, readableName } from '../src/services/suzi/packMeetings';

const KHI = 'Asia/Karachi';
beforeEach(() => { s.rows = []; s.names = []; });

describe('slice 2: attendees and organizer_self', () => {
  it('names from his contacts, else readable; self on his own addresses; organizer_self', async () => {
    s.names = [{ email: 'sofia.rana@tmcltd.com', name: 'Sofia Rana (TMC)' }];
    const people = await packPeople('TMC-0001', 2, ['sofia.rana@tmcltd.com', 'kashif.shahzad@tmcltd.com']);
    expect([...people.own]).toEqual(['basit.ahmed@tmcltd.com', 'basit@gmail.com']);
    expect(s.args[2]).toBe(2); // his contacts only
    const c = packCalendar([{ eventId: 'e1', title: 'Sync', start: '2026-11-14T11:00:00+05:00', organizer: 'basit.ahmed@tmcltd.com',
      attendees: ['basit.ahmed@tmcltd.com', 'Sofia.Rana@tmcltd.com', { email: 'kashif.shahzad@tmcltd.com' }, 'sofia.rana@tmcltd.com'] }], '2026-11-14', KHI, new Map(), people);
    expect(c.today[0].attendees).toEqual([
      { name: 'Basit Ahmed', email: 'basit.ahmed@tmcltd.com', self: true },
      { name: 'Sofia Rana (TMC)', email: 'sofia.rana@tmcltd.com' },
      { name: 'Kashif Shahzad', email: 'kashif.shahzad@tmcltd.com' },
    ]);
    expect(c.today[0].organizer_self).toBe(true);
    const d = packCalendar([{ eventId: 'e2', title: 'Theirs', start: '2026-11-14T12:00:00+05:00', organizer: 'sofia.rana@tmcltd.com', attendees: [] }], '2026-11-14', KHI, new Map(), people);
    expect(d.today[0].organizer_self).toBe(false);
  });
  it('readable name drops digits', () => { expect(readableName('salman.sohail2@x.com')).toBe('Salman Sohail'); });
});

describe('slice 2: meetings_recorded', () => {
  it('outcome, proposed count, summary only on record_ready, times in his zone, the 7-day window', async () => {
    const now = new Date('2026-11-14T10:00:00Z');
    s.rows = [
      { id: 'm1', title: 'PMS demo', start_at: new Date('2026-11-14T06:00:00Z'), end_at: new Date('2026-11-14T07:00:00Z'), status: 'record_ready', updated_at: new Date('2026-11-14T07:05:00Z'),
        minutes: '## Summary\n- The team agreed to launch the PMS pilot on 1 Dec. Sofia owns training.\n', action_items: [{ state: 'proposed' }, { state: 'accepted' }, { state: 'proposed' }] },
      { id: 'm2', title: 'Colleague call', start_at: new Date('2026-11-13T12:00:00Z'), end_at: null, status: 'not_covered', minutes: 'Should not show.', action_items: [], updated_at: new Date('2026-11-13T13:00:00Z') },
    ];
    const r = await meetingsRecorded('TMC-0001', 2, now, KHI);
    expect(r).toEqual([
      { meeting_id: 'm1', title: 'PMS demo', start: '2026-11-14T11:00:00+05:00', end: '2026-11-14T12:00:00+05:00', outcome: 'record_ready', action_items_proposed: 2, summary: 'The team agreed to launch the PMS pilot on 1 Dec.', updated_at: '2026-11-14T12:05:00+05:00' },
      { meeting_id: 'm2', title: 'Colleague call', start: '2026-11-13T17:00:00+05:00', end: null, outcome: 'not_covered', action_items_proposed: 0, updated_at: '2026-11-13T18:00:00+05:00' },
    ]);
    expect(s.args[2]).toEqual(new Date('2026-11-07T10:00:00Z')); // 7 days
  });
  it('summary is at most 160 characters', () => {
    const long = `${'word '.repeat(60)}end.`;
    const f = firstSentence(long)!;
    expect(f.length).toBe(160); expect(f.endsWith('…')).toBe(true);
    expect(firstSentence('')).toBeNull();
  });
});
