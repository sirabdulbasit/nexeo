/**
 * DEF-453 / Functional Charter row 7 (Suzi Master AGREE 13 Nov 2026, with the nudges condition). Pinned:
 *  WINDOW    a meeting is due once, when its start - 10 min falls in the tick's (from, to]; all-day, cancelled and
 *            declined meetings are never due;
 *  PRESENCE  sent when he has no Suzi device; NOT sent while a device is alive (Suzi alerts); NOT sent when his
 *            latest frame said nudges off; sent when every device is asleep and nudges are on;
 *  MESSAGE   one message for meetings starting together; the model words the fact (title, time in his zone, names);
 *            the Meet link is appended verbatim; never the calendar page; dedup per event and start.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let reach: any = { adopted: false, alive: false, absentMs: 0 };
let lastFrame: any[] = [];
vi.mock('../src/db/prisma', () => ({
  default: {
    $queryRawUnsafe: async (sql: string) => {
      if (/FROM users/.test(sql)) return [{ id: 2, client_number: 'T', email: 'me@x.com', integration_email: null }];
      if (/FROM suzi_presence/.test(sql)) return lastFrame;
      if (/FROM person_facets/.test(sql)) return [{ email: 'ali@x.com', name: 'Ali Raza' }];
      return [];
    },
  },
}));
vi.mock('../src/services/suzi/suziReach', () => ({ reachFor: async () => reach }));
let events: any[] = [];
vi.mock('../src/services/calendarService', () => ({ getEvents: async () => ({ events }) }));
const send = vi.fn(async () => ({ sent: true, channelsUsed: ['text'], waMessageIds: ['w1'] }));
vi.mock('../src/services/notifications/brainOutboundService', () => ({ brainContactsUser: (...a: any[]) => (send as any)(...a) }));
const voice = vi.fn(async (fact: string) => `Heads up: ${fact.length} chars of fact, worded.`);
vi.mock('../src/services/knowledge/markerVoice', () => ({ renderMarkerInBrainVoice: (...a: any[]) => (voice as any)(...a) }));
vi.mock('../src/services/userTimezoneService', () => ({ resolveUserTimezone: async () => 'Asia/Karachi' }));

import { dueMeetings, joinLinkOf, runMeetingReminders } from '../src/jobs/meetingReminderJob';

const to = new Date('2026-11-13T06:20:00Z'); // 11:20 PKT
const from = new Date(to.getTime() - 2 * 60_000);
const ev = (id: string, startIso: string, extra: any = {}) => ({ id, title: id, start: startIso, end: new Date(Date.parse(startIso) + 3_600_000).toISOString(), isAllDay: false, attendees: ['me@x.com', 'ali@x.com'], link: 'https://meet.google.com/ain-npxi-hhv', ...extra });
beforeEach(() => { reach = { adopted: false, alive: false, absentMs: 0 }; lastFrame = []; send.mockClear(); voice.mockClear(); events = [ev('ECP Payroll', '2026-11-13T06:30:00Z'), ev('Vision Metrics', '2026-11-13T06:30:00Z', { link: 'https://www.google.com/calendar/event?eid=x', location: 'https://us02web.zoom.us/j/123' })]; });

describe('window', () => {
  it('due exactly once across consecutive ticks; all-day, cancelled, declined never', () => {
    const e = [ev('a', '2026-11-13T06:30:00Z'), ev('b', '2026-11-13T06:30:00Z', { isAllDay: true }), ev('c', '2026-11-13T06:30:00Z', { status: 'cancelled' }), ev('d', '2026-11-13T06:30:00Z', { selfResponse: 'declined' }), ev('later', '2026-11-13T06:33:00Z')];
    expect(dueMeetings(e, from, to).map((x) => x.id)).toEqual(['a']);
    expect(dueMeetings(e, to, new Date(to.getTime() + 2 * 60_000)).map((x) => x.id)).toEqual([]);
    expect(dueMeetings(e, to, new Date(to.getTime() + 4 * 60_000)).map((x) => x.id)).toEqual(['later']);
  });
  it('the join link is a Meet or a conferencing URL, never the calendar page', () => {
    expect(joinLinkOf(ev('x', to.toISOString()))).toBe('https://meet.google.com/ain-npxi-hhv');
    expect(joinLinkOf(ev('x', to.toISOString(), { link: 'https://www.google.com/calendar/event?eid=x' }))).toBeNull();
    expect(joinLinkOf(ev('x', to.toISOString(), { link: undefined, location: 'Zoom https://us02web.zoom.us/j/9 pw' }))).toBe('https://us02web.zoom.us/j/9');
  });
});

describe('presence and nudges', () => {
  it('no Suzi device: one message for both meetings, worded by the model, links appended, dedup per event+start', async () => {
    const r = await runMeetingReminders(from, to);
    expect(r.sent).toBe(1);
    const fact = voice.mock.calls[0][0] as string;
    expect(fact).toContain('"ECP Payroll" at 11:30, with Ali Raza');
    expect(fact).toContain('"Vision Metrics" at 11:30');
    const req = (send.mock.calls[0] as any[])[0];
    expect(req).toMatchObject({ kind: 'meeting_reminder', urgency: 'high', clientNumber: 'T', userId: 2 });
    expect(req.body).toContain('ECP Payroll: https://meet.google.com/ain-npxi-hhv');
    expect(req.body).toContain('Vision Metrics: https://us02web.zoom.us/j/123');
    expect(req.body).not.toContain('calendar/event');
    expect(req.dedupKey).toBe('meeting_reminder:ECP Payroll@2026-11-13T06:30:00Z,Vision Metrics@2026-11-13T06:30:00Z');
  });
  it('a Suzi device alive: nothing (Suzi alerts)', async () => {
    reach = { adopted: true, alive: true, absentMs: 0 };
    expect((await runMeetingReminders(from, to)).sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('every device asleep, latest frame said nudges off: nothing', async () => {
    reach = { adopted: true, alive: false, absentMs: 3_600_000 };
    lastFrame = [{ nudges_off: true }];
    expect((await runMeetingReminders(from, to)).sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('every device asleep, nudges on: sent', async () => {
    reach = { adopted: true, alive: false, absentMs: 3_600_000 };
    lastFrame = [{ nudges_off: false }];
    expect((await runMeetingReminders(from, to)).sent).toBe(1);
  });
});
