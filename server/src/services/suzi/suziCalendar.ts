/**
 * F-2.6 (Functional Charter, agreed 11 Nov 2026): Suzi changes or cancels his meetings through Nexeo.
 *
 *   calendar.update  {event_id, start?, end?, title?, attendees_add?, attendees_remove?, note?}
 *   calendar.cancel  {event_id, note?}
 *
 * Only an event he organises (Google's own `organizer.self`); anything else is 409 not_organizer.
 * Anything that reaches other people is signed + voice_score + confirmed: a cancel, and any change once
 * anyone else is invited (before or after the change). Their calendars show even a new title, so a title or
 * note edit is unsigned only when nobody else is on the event. Google tells the attendees itself
 * (sendUpdates "all"); with nobody else, nothing is sent ("none").
 *
 * A note goes into the event's description (a line headed with the date), so attendees read it in the
 * invitation; on a cancel it is written first, so the cancellation they receive carries it.
 * The pack's event id is Google's, from his primary calendar.
 */
import { personById } from './suziPeople';
import type { SendGate } from './suziEmail';

type Args = Record<string, unknown>;
type Result = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const fail = (error: string, detail?: string): Result => ({ ok: false, error, ...(detail ? { detail } : {}) });
/** ISO with an offset (or Z): a time without a zone would be read in the server's zone. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export type Gcal = {
  get(eventId: string): Promise<any>;
  patch(eventId: string, body: any, sendUpdates: 'all' | 'none'): Promise<any>;
  remove(eventId: string, sendUpdates: 'all' | 'none'): Promise<void>;
  list?(timeMin: string, timeMax: string): Promise<any[]>;
  insert?(body: any, sendUpdates: 'all' | 'none', withMeet: boolean): Promise<any>;
};

async function googleCalendar(userId: number): Promise<Gcal | string> {
  const { getAuthenticatedClient } = await import('../integrationService');
  const { client, error } = await getAuthenticatedClient(userId);
  if (!client) return error ?? 'Google Calendar is not connected';
  const { google } = await import('googleapis');
  const cal = google.calendar({ version: 'v3', auth: client as any });
  return {
    get: async (eventId) => (await cal.events.get({ calendarId: 'primary', eventId })).data,
    patch: async (eventId, body, sendUpdates) => (await cal.events.patch({ calendarId: 'primary', eventId, requestBody: body, sendUpdates })).data,
    remove: async (eventId, sendUpdates) => { await cal.events.delete({ calendarId: 'primary', eventId, sendUpdates }); },
    list: async (timeMin, timeMax) => (await cal.events.list({ calendarId: 'primary', timeMin, timeMax, singleEvents: true, maxResults: 50 })).data.items ?? [],
    insert: async (body, sendUpdates, withMeet) => (await cal.events.insert({ calendarId: 'primary', requestBody: body, sendUpdates, conferenceDataVersion: withMeet ? 1 : 0 })).data,
  };
}

/** People other than him (and other than rooms). */
const others = (attendees: any[] | undefined) => (attendees ?? []).filter((a) => a?.email && !a.self && !a.resource);
const signedOk = (gate: SendGate, confirmed: boolean) => confirmed && gate.signatureVerified && gate.voiceScore !== null;

async function addresses(clientNumber: string, userId: number, v: unknown): Promise<string[] | null> {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    const s = text(x);
    if (EMAIL.test(s)) { out.push(s.toLowerCase()); continue; }
    const p = await personById(clientNumber, userId, s);
    if (!p?.email) return null;
    out.push(p.email.toLowerCase());
  }
  return out;
}

function withNote(description: string | null | undefined, note: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return [String(description ?? '').trim(), `${day}: ${note.slice(0, 1000)}`].filter(Boolean).join('\n\n');
}

const card = (e: any) => ({
  event_id: e.id, title: e.summary ?? '', start: e.start?.dateTime ?? e.start?.date ?? null, end: e.end?.dateTime ?? e.end?.date ?? null,
  attendees: others(e.attendees).map((a: any) => a.email), html_link: e.htmlLink ?? null, status: e.status ?? 'confirmed',
});

async function load(userId: number, a: Args, cal?: Gcal): Promise<{ cal: Gcal; ev: any } | Result> {
  const eventId = text(a.event_id);
  if (!eventId) return fail('not_found');
  const c = cal ?? await googleCalendar(userId);
  if (typeof c === 'string') return fail('rejected', c);
  let ev: any;
  try { ev = await c.get(eventId); } catch (e: any) { return fail(e?.code === 404 || e?.code === 410 ? 'not_found' : 'rejected', String(e?.message ?? '').slice(0, 200)); }
  if (!ev || ev.status === 'cancelled') return fail('not_found');
  if (ev.organizer?.self !== true) return fail('not_organizer', 'he does not organise this event');
  return { cal: c, ev };
}

export async function calendarUpdate(clientNumber: string, userId: number, a: Args, confirmed: boolean, gate: SendGate, cal?: Gcal): Promise<Result> {
  const l = await load(userId, a, cal);
  if ('ok' in l) return l;
  const { ev } = l;
  const body: any = {};
  const start = text(a.start); const end = text(a.end);
  if ((start && !ISO.test(start)) || (end && !ISO.test(end))) return fail('bad_time', 'start and end need a date, a time and an offset');
  if (start || end) {
    if (!ev.start?.dateTime) return fail('bad_state', 'an all-day event is not moved by time');
    const s0 = Date.parse(ev.start.dateTime); const e0 = Date.parse(ev.end?.dateTime ?? ev.start.dateTime);
    const s = start ? Date.parse(start) : s0;
    const e = end ? Date.parse(end) : s + (e0 - s0);
    if (!(e > s)) return fail('bad_time', 'the end must be after the start');
    body.start = { dateTime: new Date(s).toISOString() };
    body.end = { dateTime: new Date(e).toISOString() };
  }
  if (text(a.title)) body.summary = text(a.title).slice(0, 300);
  const note = text(a.note);
  if (note) body.description = withNote(ev.description, note);
  const add = await addresses(clientNumber, userId, a.attendees_add);
  const remove = await addresses(clientNumber, userId, a.attendees_remove);
  if (!add || !remove) return fail('bad_attendee', 'an attendee is neither an email nor one of his people with an email');
  if (add.length || remove.length) {
    const kept = (ev.attendees ?? []).filter((x: any) => !remove.includes(String(x.email ?? '').toLowerCase()));
    const have = new Set(kept.map((x: any) => String(x.email ?? '').toLowerCase()));
    body.attendees = [...kept, ...add.filter((m) => !have.has(m)).map((email) => ({ email }))];
  }
  if (!Object.keys(body).length) return fail('bad_update', 'nothing to change');
  const reachesOthers = others(ev.attendees).length > 0 || others(body.attendees).length > 0;
  if (reachesOthers && !confirmed) return fail('needs_confirmation');
  if (reachesOthers && !signedOk(gate, confirmed)) return fail('needs_signature', 'other people are invited: a signed, voiced yes is needed');
  try {
    const after = await l.cal.patch(ev.id, body, reachesOthers ? 'all' : 'none');
    return { ok: true, item: { ...card(after), attendees_told: reachesOthers } };
  } catch (e: any) {
    return fail('rejected', String(e?.message ?? 'Google refused the change').slice(0, 200));
  }
}

export async function calendarCancel(clientNumber: string, userId: number, a: Args, confirmed: boolean, gate: SendGate, cal?: Gcal): Promise<Result> {
  if (!confirmed) return fail('needs_confirmation');
  if (!signedOk(gate, confirmed)) return fail('needs_signature', 'a cancel is signed and voiced');
  const l = await load(userId, a, cal);
  if ('ok' in l) return l;
  const { ev } = l;
  const reachesOthers = others(ev.attendees).length > 0;
  try {
    const note = text(a.note);
    if (note && reachesOthers) await l.cal.patch(ev.id, { description: withNote(ev.description, note) }, 'none');
    await l.cal.remove(ev.id, reachesOthers ? 'all' : 'none');
    return { ok: true, item: { event_id: ev.id, title: ev.summary ?? '', cancelled: true, attendees_told: reachesOthers } };
  } catch (e: any) {
    return fail('rejected', String(e?.message ?? 'Google refused the cancel').slice(0, 200));
  }
}

/**
 * F-2.8 (agreed by Suzi Master 11 Nov, by the founder 12 Nov 2026): calendar.create
 *   {title, start, end, attendees?[email | person_id], note?, location?, meet?, allow_clash?}
 * A new event on his primary calendar. A time that overlaps one of his busy events is 409 `clash` (with what it
 * clashes with) unless allow_clash is true. Inviting anyone else reaches other people: confirmed, signed and voiced,
 * and Google sends the invitations. With nobody else it needs only his confirmation. A Meet link is added when
 * others are invited, unless meet is false.
 */
export async function calendarCreate(clientNumber: string, userId: number, a: Args, confirmed: boolean, gate: SendGate, cal?: Gcal): Promise<Result> {
  const title = text(a.title).slice(0, 300);
  if (!title) return fail('bad_title');
  const start = text(a.start); const end = text(a.end);
  if (!ISO.test(start) || !ISO.test(end)) return fail('bad_time', 'start and end need a date, a time and an offset');
  const s = Date.parse(start); const e = Date.parse(end);
  if (!(e > s)) return fail('bad_time', 'the end must be after the start');
  const invite = await addresses(clientNumber, userId, a.attendees);
  if (!invite) return fail('bad_attendee', 'an attendee is neither an email nor one of his people with an email');
  if (!confirmed) return fail('needs_confirmation');
  const reachesOthers = invite.length > 0;
  if (reachesOthers && !signedOk(gate, confirmed)) return fail('needs_signature', 'other people are invited: a signed, voiced yes is needed');
  const c = cal ?? await googleCalendar(userId);
  if (typeof c === 'string') return fail('rejected', c);
  if (!c.list || !c.insert) return fail('rejected', 'calendar not available');
  if (a.allow_clash !== true) {
    let busy: any[] = [];
    try { busy = await c.list(new Date(s).toISOString(), new Date(e).toISOString()); } catch (err: any) {
      return fail('rejected', String(err?.message ?? 'could not read his calendar').slice(0, 200));
    }
    const clashes = busy.filter((x) => x?.status !== 'cancelled' && x?.transparency !== 'transparent' && x?.start?.dateTime
      && Date.parse(x.start.dateTime) < e && Date.parse(x.end?.dateTime ?? x.start.dateTime) > s);
    if (clashes.length) return fail('clash', clashes.slice(0, 5).map((x) => `${x.summary ?? '(no title)'} ${x.start.dateTime}–${x.end?.dateTime ?? ''}`).join('; '));
  }
  const withMeet = reachesOthers ? a.meet !== false : a.meet === true;
  const body: any = {
    summary: title, start: { dateTime: new Date(s).toISOString() }, end: { dateTime: new Date(e).toISOString() },
    ...(text(a.note) ? { description: text(a.note).slice(0, 4000) } : {}),
    ...(text(a.location) ? { location: text(a.location).slice(0, 300) } : {}),
    ...(reachesOthers ? { attendees: invite.map((email) => ({ email })) } : {}),
    ...(withMeet ? { conferenceData: { createRequest: { requestId: `suzi-${s}-${title.length}-${invite.length}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
  };
  try {
    const made = await c.insert(body, reachesOthers ? 'all' : 'none', withMeet);
    return { ok: true, item: { ...card(made), meet_link: made?.hangoutLink ?? null, invited: reachesOthers } };
  } catch (err: any) {
    return fail('rejected', String(err?.message ?? 'Google refused the event').slice(0, 200));
  }
}

export const CALENDAR_OPS = ['calendar.update', 'calendar.cancel', 'calendar.create'] as const;

export async function runCalendarOp(clientNumber: string, userId: number, op: string, a: Args, confirmed: boolean, gate: SendGate): Promise<Result> {
  if (op === 'calendar.update') return calendarUpdate(clientNumber, userId, a, confirmed, gate);
  if (op === 'calendar.cancel') return calendarCancel(clientNumber, userId, a, confirmed, gate);
  if (op === 'calendar.create') return calendarCreate(clientNumber, userId, a, confirmed, gate);
  return fail('unknown_op');
}
