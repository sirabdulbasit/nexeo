/**
 * T34 (both AGREE 17 Nov 2026): calendar notices into the meeting. Pinned:
 *  KIND     each notice subject maps to its kind (invitation, updated, accepted, declined, tentative, proposed, cancelled);
 *           anything else is not a notice;
 *  PLACE    the order is eid → iCalendar UID → title + date (exactly one); a series id places only the instance on the
 *           subject's date; an email no step can place stays unplaced;
 *  PACK     today's and tomorrow's events carry updates (newest first, ≤10); a placed notice leaves the emails, counted
 *           as calendar; a proposed new time for a meeting still ahead stays, carrying event_id.
 */
import { describe, it, expect } from 'vitest';
import { noticeKind, eidEventIds, icalEventIds, subjectTitleDate, placeNotice } from '../src/services/suzi/suziCalendarNotices';
import { leaveHandled, withUpdates } from '../src/services/suzi/dayPack';

const eid = (id: string) => Buffer.from(`${id} basit@x.com`).toString('base64').replace(/=+$/, '');

describe('KIND', () => {
  it.each([
    ['Invitation: ECP Payroll @ Wed Nov 18, 2026 5pm - 6pm (PKT) (basit@x.com)', 'invited'],
    ['Updated invitation: ECP Payroll @ Wed Nov 18, 2026', 'changed'],
    ['Updated invitation with note: ECP Payroll @ Wed Nov 18, 2026', 'changed'],
    ['Accepted: ECP Payroll @ Wed Nov 18, 2026', 'accepted'],
    ['Declined: ECP Payroll @ Wed Nov 18, 2026', 'declined'],
    ['Tentatively Accepted: ECP Payroll @ Tue Nov 17, 2026', 'tentative'],
    ['Proposed new time: TMC System Catalogues @ Fri Nov 13, 2026', 'proposed_time'],
    ['Canceled event: ECP Payroll @ Wed Nov 18, 2026', 'cancelled'],
    ['Cancelled event with note: ECP Payroll @ Wed Nov 18, 2026', 'cancelled'],
    ['Re: Accepted the plan', null],
    ['Payroll accepted: next steps', null],
  ])('%s → %s', (subject, kind) => expect(noticeKind(subject)).toBe(kind));
});

describe('PLACE', () => {
  const events = [
    { id: 'abc123def456', title: 'ECP Payroll', day: '2026-11-18', start: '2026-11-18T12:00:00.000Z' },
    { id: 'series99_20261118T060000Z', title: 'Office', day: '2026-11-18', start: '2026-11-18T06:00:00.000Z' },
    { id: 'series99_20261119T060000Z', title: 'Office', day: '2026-11-19', start: '2026-11-19T06:00:00.000Z' },
    { id: 'zzz', title: 'Vision Metrics review', day: '2026-11-19', start: '2026-11-19T09:00:00.000Z' },
  ];
  it('eid first, even when the subject names another date (a moved event keeps its id)', () => {
    expect(eidEventIds(`https://www.google.com/calendar/event?action=VIEW&eid=${eid('abc123def456')}&tok=x`)).toEqual(['abc123def456']);
    expect(placeNotice({ subject: 'Accepted: ECP Payroll @ Mon Nov 16, 2026', body: `see ?eid=${eid('abc123def456')}` }, events)?.id).toBe('abc123def456');
  });
  it('a series id places only the instance on the subject date; none when the date is unreadable', () => {
    expect(placeNotice({ subject: 'Accepted: Office @ Thu Nov 19, 2026', body: `?eid=${eid('series99')}` }, events)?.id).toBe('series99_20261119T060000Z');
    expect(placeNotice({ subject: 'Accepted: Office', body: `?eid=${eid('series99')}` }, events)).toBeNull();
  });
  it('iCalendar UID second; title + date last, only with exactly one match', () => {
    expect(icalEventIds('UID:zzz@google.com')).toEqual([]); // too short to be a Google id
    expect(placeNotice({ subject: 'Invitation: x', body: 'UID:abc123def456@google.com' }, events)?.id).toBe('abc123def456');
    expect(subjectTitleDate('Invitation: Vision Metrics review @ Thu Nov 19, 2026 2pm')).toEqual({ title: 'Vision Metrics review', date: '2026-11-19' });
    expect(placeNotice({ subject: 'Invitation: Vision  Metrics review @ Thu Nov 19, 2026 2pm', body: null }, events)?.id).toBe('zzz');
    expect(placeNotice({ subject: 'Invitation: Office @ Wed Nov 18, 2026', body: null }, [...events, { id: 'o2', title: 'Office', day: '2026-11-18', start: null }])).toBeNull();
    expect(placeNotice({ subject: 'Invitation: Unknown @ Thu Nov 19, 2026', body: null }, events)).toBeNull();
  });
});

describe('PACK', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  const e = (thread: string) => ({ thread_id: thread, from: 'x', subject: thread, preview: '', received_at: '2026-11-18T09:00:00Z', urgency: 'normal' });
  it('a placed notice leaves (counted); a proposed time for a meeting ahead stays with event_id; past proposals leave', () => {
    const threads = new Map<string, any>([
      ['t-acc', { event_id: 'E1', kind: 'accepted', start: '2026-11-18T12:00:00.000Z' }],
      ['t-prop', { event_id: 'E1', kind: 'proposed_time', start: '2026-11-18T12:00:00.000Z' }],
      ['t-prop-past', { event_id: 'E0', kind: 'proposed_time', start: '2026-11-18T08:00:00.000Z' }],
    ]);
    const r = leaveHandled([e('t-acc'), e('t-prop'), e('t-prop-past'), e('t-plain')] as any, new Map(), threads, now);
    expect(r.emails.map((x) => [x.thread_id, x.event_id])).toEqual([['t-prop', 'E1'], ['t-plain', undefined]]);
    expect(r.emails_hidden).toEqual({ ignored: 0, tasked: 0, calendar: 2 });
  });
  it("today's and tomorrow's events carry their updates; other events none", () => {
    const ev = (id: string) => ({ id, start: '', end: null, all_day: false, title: id, attendees: [], organizer_self: false, location: null, link: null, prep_notes: null });
    const cal = withUpdates({ today: [ev('E1'), ev('E2')], tomorrow: [ev('E3')], rest_of_week: [] }, { updates: new Map([['E1', [{ at: 'a', who: 'Sara', kind: 'accepted' as const }]], ['E3', [{ at: 'b', who: 'you', kind: 'declined' as const }]]]), threads: new Map() });
    expect(cal.today[0].updates).toEqual([{ at: 'a', who: 'Sara', kind: 'accepted' }]);
    expect(cal.today[1].updates).toBeUndefined();
    expect(cal.tomorrow[0].updates?.[0].kind).toBe('declined');
  });
});
