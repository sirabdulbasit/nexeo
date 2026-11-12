/**
 * F-2.8 calendar.create (Suzi Master AGREE 11 Nov; founder 12 Nov 2026: "Creating/Changing meeting/invites").
 * Pinned:
 *  CONFIRM   always his confirmation; inviting anyone else also signed and voiced (it reaches other people);
 *  CLASH     an overlap with one of his busy events is `clash` naming it, unless allow_clash; free or cancelled
 *            or "free"-marked events never clash;
 *  INVITES   Google sends the invitations (sendUpdates all) only when others are invited; a Meet link then by default;
 *  INPUT     a time without an offset, an end before the start, or an unknown attendee is refused before anything.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/suzi/suziPeople', () => ({ personById: async (_c: string, _u: number, id: string) => (id === 'p1' ? { id: 'p1', name: 'Ali', email: 'Ali@x.com' } : null) }));
import { calendarCreate, type Gcal } from '../src/services/suzi/suziCalendar';

const signed = { signatureVerified: true, voiceScore: 0.9 } as any;
const unsigned = { signatureVerified: false, voiceScore: null } as any;
function cal(busy: any[] = []) {
  const insert = vi.fn(async (body: any) => ({ id: 'ev_new', summary: body.summary, start: body.start, end: body.end, attendees: body.attendees, hangoutLink: body.conferenceData ? 'https://meet.google.com/abc-defg-hij' : undefined }));
  const c: Gcal = { get: vi.fn(), patch: vi.fn(), remove: vi.fn(), list: vi.fn(async () => busy), insert };
  return { c, insert };
}
const base = { title: 'SAP ECP kickoff', start: '2026-11-13T15:00:00+05:00', end: '2026-11-13T15:30:00+05:00' };

describe('F-2.8 calendar.create', () => {
  it('his own event: confirmation is enough, nobody is told, no Meet link unless asked', async () => {
    const { c, insert } = cal();
    expect(await calendarCreate('T', 2, base, false, unsigned, c)).toMatchObject({ error: 'needs_confirmation' });
    const r: any = await calendarCreate('T', 2, base, true, unsigned, c);
    expect(r).toMatchObject({ ok: true, item: { event_id: 'ev_new', invited: false, meet_link: null } });
    expect(insert.mock.calls[0][1]).toBe('none');
    expect(insert.mock.calls[0][2]).toBe(false);
  });
  it('inviting others needs a signed, voiced yes; Google then sends the invites with a Meet link', async () => {
    const { c, insert } = cal();
    expect(await calendarCreate('T', 2, { ...base, attendees: ['p1'] }, true, unsigned, c)).toMatchObject({ error: 'needs_signature' });
    expect(insert).not.toHaveBeenCalled();
    const r: any = await calendarCreate('T', 2, { ...base, attendees: ['p1', 'Sara@y.com'] }, true, signed, c);
    expect(r).toMatchObject({ ok: true, item: { invited: true, meet_link: 'https://meet.google.com/abc-defg-hij', attendees: ['ali@x.com', 'sara@y.com'] } });
    expect(insert.mock.calls[0][1]).toBe('all');
    expect(insert.mock.calls[0][2]).toBe(true);
  });
  it('a clash is refused naming what it clashes with, unless allow_clash', async () => {
    const busy = [{ summary: 'TMC System Catalogues', status: 'confirmed', start: { dateTime: '2026-11-13T15:15:00+05:00' }, end: { dateTime: '2026-11-13T16:00:00+05:00' } }];
    const { c, insert } = cal(busy);
    const r: any = await calendarCreate('T', 2, base, true, unsigned, c);
    expect(r).toMatchObject({ ok: false, error: 'clash' });
    expect(r.detail).toContain('TMC System Catalogues');
    expect(insert).not.toHaveBeenCalled();
    expect(await calendarCreate('T', 2, { ...base, allow_clash: true }, true, unsigned, c)).toMatchObject({ ok: true });
  });
  it('cancelled, free-marked and all-day events never clash', async () => {
    const { c } = cal([
      { summary: 'gone', status: 'cancelled', start: { dateTime: '2026-11-13T15:00:00+05:00' }, end: { dateTime: '2026-11-13T15:30:00+05:00' } },
      { summary: 'free', transparency: 'transparent', start: { dateTime: '2026-11-13T15:00:00+05:00' }, end: { dateTime: '2026-11-13T15:30:00+05:00' } },
      { summary: 'Office', start: { date: '2026-11-13' }, end: { date: '2026-11-14' } },
    ]);
    expect(await calendarCreate('T', 2, base, true, unsigned, c)).toMatchObject({ ok: true });
  });
  it('bad input is refused before anything is read or written', async () => {
    const { c, insert } = cal();
    expect(await calendarCreate('T', 2, { ...base, start: '2026-11-13T15:00:00' }, true, signed, c)).toMatchObject({ error: 'bad_time' });
    expect(await calendarCreate('T', 2, { ...base, end: '2026-11-13T14:00:00+05:00' }, true, signed, c)).toMatchObject({ error: 'bad_time' });
    expect(await calendarCreate('T', 2, { ...base, attendees: ['nobody'] }, true, signed, c)).toMatchObject({ error: 'bad_attendee' });
    expect(await calendarCreate('T', 2, { ...base, title: ' ' }, true, signed, c)).toMatchObject({ error: 'bad_title' });
    expect(insert).not.toHaveBeenCalled();
  });
});
