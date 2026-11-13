/**
 * F-4 Way A, Suzi Master 13 Nov: the 5-minute poll processed the same meeting again every tick. Pinned:
 *  - a hosted meeting with no conference or no transcript is retried while young, and settled as not_covered (with
 *    the reason, and the conference record so the conference sweep skips it too) two hours after its end;
 *  - a calendar link that is not a Meet is not a meeting we can read (no_meet_link, nothing written);
 *  - the conference sweep settles a conference with no transcript the same way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: async () => [], $executeRawUnsafe: async () => 1 } }));
let confs: any[] = [];
vi.mock('../src/services/meetings/meetTranscripts', async (orig) => ({
  ...(await (orig as any)()),
  meetFor: async () => ({ spaces: { get: async () => ({ data: { meetingCode: 'abc-defg-hij' } }) } }),
  conferencesFor: async () => confs,
  conference: async (_m: any, name: string) => ({ name, space: 'spaces/S', startTime: new Date(Date.now() - 4 * 3_600_000).toISOString(), endTime: new Date(Date.now() - 3 * 3_600_000).toISOString() }),
  readTranscript: async () => ({ transcriptName: null, lines: [], participants: [], minutes: 0 }),
}));
const setStatus = vi.fn(async () => ({}) as any);
vi.mock('../src/services/meetings/meetingRecordStore', async (orig) => ({ ...(await (orig as any)()), setStatus: (...a: any[]) => (setStatus as any)(...a) }));
vi.mock('../src/services/calendarService', () => ({ getEvents: async () => ({ events: [] }) }));
vi.mock('../src/services/userTimezoneService', () => ({ resolveUserTimezone: async () => 'Asia/Karachi' }));

import { processEndedEvent, processConferenceForUser } from '../src/services/meetings/meetingProcessor';

const ev = (endMinAgo: number, link = 'https://meet.google.com/abc-defg-hij') => {
  const end = new Date(Date.now() - endMinAgo * 60_000);
  return { id: 'e1', title: 'ECP Payroll', link, organizer: 'me@x.com', start: new Date(end.getTime() - 3_600_000).toISOString(), end: end.toISOString() } as any;
};
beforeEach(() => { setStatus.mockClear(); confs = []; });

describe('a meeting that will never have a transcript stops being polled', () => {
  it('young: retried (nothing written); two hours after the end: settled not_covered with the reason', async () => {
    expect(await processEndedEvent('T', 2, ['me@x.com'], ev(30))).toBe('no_conference');
    expect(setStatus).not.toHaveBeenCalled();
    expect(await processEndedEvent('T', 2, ['me@x.com'], ev(130))).toBe('not_covered');
    expect(setStatus).toHaveBeenCalledWith('T', 2, 'event:e1', 'not_covered', expect.objectContaining({ reason: 'no_conference', eventId: 'e1' }));
  });
  it('a conference with no transcript is settled with its conference record, so the conference sweep skips it too', async () => {
    confs = [{ name: 'conferenceRecords/c1' }];
    expect(await processEndedEvent('T', 2, ['me@x.com'], ev(130))).toBe('not_covered');
    expect(setStatus).toHaveBeenCalledWith('T', 2, 'event:e1', 'not_covered', expect.objectContaining({ reason: 'no_transcript', conferenceRecord: 'conferenceRecords/c1' }));
  });
  it('a calendar link that is not a Meet writes nothing', async () => {
    expect(await processEndedEvent('T', 2, ['me@x.com'], ev(130, 'https://www.google.com/calendar/event?eid=x'))).toBe('no_meet_link');
    expect(setStatus).not.toHaveBeenCalled();
  });
  it('the conference sweep settles a long-ended conference with no transcript', async () => {
    expect(await processConferenceForUser('T', 2, 'conferenceRecords/c9')).toBe('not_covered');
    expect(setStatus).toHaveBeenCalledWith('T', 2, expect.stringMatching(/^conf:spaces\/S@/), 'not_covered', expect.objectContaining({ reason: 'no_transcript', conferenceRecord: 'conferenceRecords/c9' }));
  });
});
