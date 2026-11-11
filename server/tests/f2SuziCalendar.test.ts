/**
 * F-2.6 (Functional Charter, agreed 11 Nov 2026): calendar.update / calendar.cancel. Pinned:
 *  ORGANIZER  only an event he organises (organizer.self); anything else 409 not_organizer, nothing written;
 *  REACH      anyone else invited (before or after) → confirmed + signed + voiced, Google tells them ("all");
 *             nobody else → a title or note edit is unsigned and nothing is sent ("none");
 *  CANCEL     always signed and voiced; a note is written first so the cancellation carries it;
 *  TIME       a move keeps the duration; a time without an offset or an end before the start is refused.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/suzi/suziPeople', () => ({ personById: async (_c: string, _u: number, id: string) => (id === 'p1' ? { id: 'p1', name: 'Ali', email: 'Ali@x.com' } : null) }));
import { calendarUpdate, calendarCancel, type Gcal } from '../src/services/suzi/suziCalendar';

const SIGNED = { signatureVerified: true, voiceScore: 0.9 };
const UNSIGNED = { signatureVerified: false, voiceScore: null };
const ev = (over: any = {}) => ({
  id: 'e1', summary: 'Review', status: 'confirmed', organizer: { self: true },
  start: { dateTime: '2026-11-12T10:00:00+05:00' }, end: { dateTime: '2026-11-12T11:00:00+05:00' },
  attendees: [{ email: 'me@x.com', self: true }], description: 'agenda', ...over,
});
let calls: any[];
const cal = (e: any): Gcal => ({
  get: async () => e,
  patch: async (id, body, send) => { calls.push(['patch', id, body, send]); return { ...e, ...body }; },
  remove: async (id, send) => { calls.push(['remove', id, send]); },
});
beforeEach(() => { calls = []; });

describe('calendar.update', () => {
  it('only his own events', async () => {
    expect(await calendarUpdate('T', 2, { event_id: 'e1', title: 'X' }, true, SIGNED, cal(ev({ organizer: { email: 'boss@x.com' } })))).toMatchObject({ ok: false, error: 'not_organizer' });
    expect(calls).toEqual([]);
  });
  it('nobody else on it: a title edit is unsigned and sends nothing', async () => {
    const r: any = await calendarUpdate('T', 2, { event_id: 'e1', title: 'Review v2' }, false, UNSIGNED, cal(ev()));
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(['patch', 'e1', { summary: 'Review v2' }, 'none']);
    expect(r.item.attendees_told).toBe(false);
  });
  it('others invited: even a title edit needs a signed, voiced yes; then Google tells them', async () => {
    const e = ev({ attendees: [{ email: 'me@x.com', self: true }, { email: 'b@x.com' }] });
    expect(await calendarUpdate('T', 2, { event_id: 'e1', title: 'X' }, false, SIGNED, cal(e))).toEqual({ ok: false, error: 'needs_confirmation' });
    expect(await calendarUpdate('T', 2, { event_id: 'e1', title: 'X' }, true, UNSIGNED, cal(e))).toMatchObject({ ok: false, error: 'needs_signature' });
    expect(calls).toEqual([]);
    const r: any = await calendarUpdate('T', 2, { event_id: 'e1', title: 'X' }, true, SIGNED, cal(e));
    expect(calls[0][3]).toBe('all');
    expect(r.item.attendees_told).toBe(true);
  });
  it('adding someone counts as reaching others; a person id becomes their email', async () => {
    expect(await calendarUpdate('T', 2, { event_id: 'e1', attendees_add: ['p1'] }, true, UNSIGNED, cal(ev()))).toMatchObject({ ok: false, error: 'needs_signature' });
    await calendarUpdate('T', 2, { event_id: 'e1', attendees_add: ['p1', 'c@y.com'] }, true, SIGNED, cal(ev()));
    expect(calls[0][2].attendees.map((a: any) => a.email)).toEqual(['me@x.com', 'ali@x.com', 'c@y.com']);
    expect(await calendarUpdate('T', 2, { event_id: 'e1', attendees_add: ['nobody'] }, true, SIGNED, cal(ev()))).toMatchObject({ ok: false, error: 'bad_attendee' });
  });
  it('a move keeps the duration; bad times are refused', async () => {
    await calendarUpdate('T', 2, { event_id: 'e1', start: '2026-11-12T15:00:00+05:00' }, false, UNSIGNED, cal(ev()));
    expect(calls[0][2]).toEqual({ start: { dateTime: '2026-11-12T10:00:00.000Z' }, end: { dateTime: '2026-11-12T11:00:00.000Z' } });
    expect(await calendarUpdate('T', 2, { event_id: 'e1', start: '2026-11-12T15:00' }, false, UNSIGNED, cal(ev()))).toMatchObject({ error: 'bad_time' });
    expect(await calendarUpdate('T', 2, { event_id: 'e1', start: '2026-11-12T15:00:00+05:00', end: '2026-11-12T14:00:00+05:00' }, false, UNSIGNED, cal(ev()))).toMatchObject({ error: 'bad_time' });
  });
  it('a note is added to the description, the old text kept', async () => {
    await calendarUpdate('T', 2, { event_id: 'e1', note: 'bring the figures' }, false, UNSIGNED, cal(ev()));
    expect(calls[0][2].description).toMatch(/^agenda\n\n\d{4}-\d{2}-\d{2}: bring the figures$/);
  });
});

describe('calendar.cancel', () => {
  it('always signed and voiced, even with nobody else', async () => {
    expect(await calendarCancel('T', 2, { event_id: 'e1' }, true, UNSIGNED, cal(ev()))).toMatchObject({ ok: false, error: 'needs_signature' });
    const r: any = await calendarCancel('T', 2, { event_id: 'e1' }, true, SIGNED, cal(ev()));
    expect(calls).toEqual([['remove', 'e1', 'none']]);
    expect(r.item).toMatchObject({ cancelled: true, attendees_told: false });
  });
  it('with others: the note is written first, then Google tells them', async () => {
    const e = ev({ attendees: [{ email: 'me@x.com', self: true }, { email: 'b@x.com' }] });
    await calendarCancel('T', 2, { event_id: 'e1', note: 'moved to next week' }, true, SIGNED, cal(e));
    expect(calls[0][0]).toBe('patch');
    expect(calls[0][3]).toBe('none');
    expect(calls[1]).toEqual(['remove', 'e1', 'all']);
  });
  it('not his event: nothing removed', async () => {
    expect(await calendarCancel('T', 2, { event_id: 'e1' }, true, SIGNED, cal(ev({ organizer: { self: false } })))).toMatchObject({ error: 'not_organizer' });
    expect(calls).toEqual([]);
  });
});
