/**
 * Day contract, Phase 1 (spec 2026-11-04): GET /suzi/gateway/day-pack and POST /suzi/gateway/act.
 *
 * Pinned:
 *  TIME ZONE   every time is in the user's own zone with its offset; "today" is the user's day,
 *              not the server's (a 23:30 UTC instant is tomorrow in Karachi).
 *  CALENDAR    today and tomorrow in full; rest of the week titles only; the newest synced copy
 *              of an event wins; a cancelled event is dropped.
 *  EMAILS      a preview of at most 200 characters, never a body.
 *  BRIEF       device schema, numbers from the server, `say` empty for the model.
 *  PERMISSIONS the act route trusts only the gateway; a foreign item id is 404 and untouched.
 *  IDEMPOTENCY a repeated key replays the stored answer without doing the work again; the same
 *              key with other arguments is refused; a key still running answers 409.
 *  AUDIT       success and refusal both write an audit line; audit_id is the log row's id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const log = { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() };
const userFind = vi.fn();
vi.mock('../src/db/prisma', () => ({
  default: {
    suziActLog: { create: (...a: any[]) => log.create(...a), findUnique: (...a: any[]) => log.findUnique(...a), update: (...a: any[]) => log.update(...a) },
    user: { findUnique: (...a: any[]) => userFind(...a) },
  },
}));
vi.mock('../src/services/suzi/gatewayAdminClient', () => ({ verifyGatewaySecret: async (t: any) => t === 'right-secret' }));
const auditFn = vi.fn();
vi.mock('../src/services/auditLogService', () => ({ audit: (...a: any[]) => auditFn(...a) }));
const follow = vi.fn();
vi.mock('../src/services/suzi/suziActions', async (orig) => ({ ...(await (orig as any)()), applyFollowUp: (...a: any[]) => follow(...a) }));
vi.mock('../src/services/userTimezoneService', async (orig) => ({ ...(await (orig as any)()), resolveUserTimezone: async () => 'Asia/Karachi' }));
const pack = vi.fn();
vi.mock('../src/services/suzi/dayPack', async (orig) => ({ ...(await (orig as any)()), buildDayPack: (...a: any[]) => pack(...a) }));

import { endOfWeek, packCalendar, toDeviceBlocks, toDeviceKpis, toPackEmail, EMAIL_PREVIEW_MAX } from '../src/services/suzi/dayPack';
import { toZonedIso } from '../src/services/suzi/zonedTime';
import { act } from '../src/services/suzi/suziAct';
import { localDate } from '../src/services/suzi/dayBriefFacts';
import router from '../src/routes/suziGatewayRoutes';

const KHI = 'Asia/Karachi';

describe('time zone', () => {
  it('ISO with the zone\'s offset, not UTC', () => {
    expect(toZonedIso(new Date('2026-11-04T10:00:00Z'), KHI)).toBe('2026-11-04T15:00:00+05:00');
    expect(toZonedIso(new Date('2026-11-04T10:00:00Z'), 'America/New_York')).toBe('2026-11-04T05:00:00-05:00');
    expect(toZonedIso(new Date('2026-11-04T10:00:00Z'), 'UTC')).toBe('2026-11-04T10:00:00+00:00');
  });
  it('"today" is the user\'s day', () => {
    expect(localDate(new Date('2026-11-04T23:30:00Z'), KHI)).toBe('2026-11-05');
  });
  it('the meeting-prep prompt no longer says UTC (the 3 PM read aloud as "10 o\'clock UTC")', async () => {
    const fs = await import('fs'); const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/services/brain/preactiveEngine.ts'), 'utf8');
    expect(src).not.toContain('(UTC)');
    expect(src).toContain('formatTimeInZone(tz, when)');
    const brief = fs.readFileSync(path.join(__dirname, '../src/services/views/dayBrief.ts'), 'utf8');
    expect(brief).not.toMatch(/\$\{t\} UTC/);
  });
});

describe('calendar', () => {
  const today = '2026-11-04'; // a Wednesday
  it('today and tomorrow in full, the rest of the week as titles only, in the user\'s zone', () => {
    const c = packCalendar([
      { eventId: 'uat', title: 'UAT session', start: '2026-11-04T15:00:00+05:00', end: '2026-11-04T16:00:00+05:00', attendees: ['a@x.com', { email: 'b@x.com' }], link: 'https://l' },
      { eventId: 'off', title: 'Office', start: '2026-11-04', end: '2026-11-05', isAllDay: true },
      { eventId: 'tom', title: 'Tomorrow call', start: '2026-11-05T04:00:00Z', location: 'Room 1' },
      { eventId: 'fri', title: 'Leadership', start: '2026-11-06T09:30:00+05:00', attendees: ['secret@x.com'] },
      { eventId: 'nxt', title: 'Next Monday', start: '2026-11-09T09:30:00+05:00' },
      { eventId: 'old', title: 'Yesterday', start: '2026-11-03T09:30:00+05:00' },
    ], today, KHI, new Map([['uat', 'Prep: bring the sign-off']]));
    expect(c.today.map((e) => e.id)).toEqual(['off', 'uat']);
    expect(c.today[1]).toEqual({ id: 'uat', start: '2026-11-04T15:00:00+05:00', end: '2026-11-04T16:00:00+05:00', all_day: false, title: 'UAT session', attendees: ['a@x.com', 'b@x.com'], location: null, link: 'https://l', prep_notes: 'Prep: bring the sign-off' });
    expect(c.today[0]).toMatchObject({ all_day: true, start: '2026-11-04' });
    expect(c.tomorrow[0]).toMatchObject({ id: 'tom', start: '2026-11-05T09:00:00+05:00', location: 'Room 1' });
    expect(c.rest_of_week).toEqual([{ id: 'fri', date: '2026-11-06', title: 'Leadership' }]); // titles only, this week only
  });
  it('the newest synced copy wins; a cancelled event is dropped', () => {
    const c = packCalendar([
      { eventId: 'a', title: 'Moved', start: '2026-11-04T17:00:00+05:00' },
      { eventId: 'a', title: 'Old time', start: '2026-11-04T09:00:00+05:00' },
      { eventId: 'b', title: 'Cancelled', start: '2026-11-04T10:00:00+05:00', status: 'cancelled' },
      { eventId: 'b', title: 'Cancelled', start: '2026-11-04T10:00:00+05:00' },
    ], today, KHI);
    expect(c.today.map((e) => e.title)).toEqual(['Moved']);
  });
  it('the week closes on Sunday', () => {
    expect(endOfWeek('2026-11-04')).toBe('2026-11-08');
    expect(endOfWeek('2026-11-08')).toBe('2026-11-08');
  });
});

describe('emails', () => {
  it('a preview of at most 200 characters, never the body; received_at in the user\'s zone', () => {
    const e = toPackEmail({ threadId: 't1', feedEventId: 'f1', from: 'a@x.com', fromDisplay: 'Aqsa', subject: 'S', preview: 'x'.repeat(500), body: 'THE WHOLE BODY', receivedAt: '2026-11-04T10:00:00Z', criticality: { band: 'high' } } as any, KHI);
    expect(e.preview).toHaveLength(EMAIL_PREVIEW_MAX);
    expect(e).toEqual({ thread_id: 't1', from: 'Aqsa', subject: 'S', preview: 'x'.repeat(200), received_at: '2026-11-04T15:00:00+05:00', urgency: 'high' });
    expect(JSON.stringify(e)).not.toContain('THE WHOLE BODY');
  });
});

describe('email previews are plain text', () => {
  it('HTML escapes in a snippet are decoded before the cut', () => {
    const e = toPackEmail({ feedEventId: 'f', from: 'a', subject: 's', preview: 'From &lt;vm@tmcltd.com&gt; wrote &amp; &quot;x&quot;', receivedAt: '2026-11-04T10:00:00Z' } as any, KHI);
    expect(e.preview).toBe('From <vm@tmcltd.com> wrote & "x"');
  });
});

describe('brief blocks', () => {
  const facts: any = {
    missing: [{ source: 'calendar', status: 'expired', reconnect: 'Nexeo web → Connectors' }, { source: 'email', status: 'loading' }],
    blocks: [
      { type: 'kpis', id: 'key_figures', title: 'Key figures', items: [{ label: 'Pending actions', value: 22 }, { label: 'Overdue', value: 21 }, { label: 'Meetings today', value: 'not connected' }] },
      { type: 'list', id: 'emails', title: 'Emails', connected: true, items: [{ primary: 'Subject', secondary: 'Aqsa', time: '2026-11-04' }] },
      { type: 'table', id: 'pending_actions', title: 'Pending', columns: ['Action', 'Due'], rows: [['A', null]] },
      { type: 'chart', id: 'c', title: 'By priority', chart: 'bar', series: [{ label: 'high', value: 17 }, { label: 'low', value: 1 }] },
    ],
  };
  it('device schema: numbers in value, x + series[{name, values}], {text, meta}; say left to the model', () => {
    const b = toDeviceBlocks(facts);
    expect(b.map((x) => x.kind)).toEqual(['kpis', 'list', 'table', 'chart', 'text']);
    expect(b.every((x) => x.say === '')).toBe(true);
    expect(b[0].items).toEqual([{ label: 'Pending actions', value: 22 }, { label: 'Overdue', value: 21, good: false }, { label: 'Meetings today', value: 'not connected' }]);
    expect(b[1].items).toEqual([{ text: 'Subject', meta: '2026-11-04 · Aqsa' }]);
    expect(b[2].rows).toEqual([['A', '']]);
    expect(b[3]).toMatchObject({ chart: 'bar', x: ['high', 'low'], series: [{ name: 'By priority', values: [17, 1] }] });
    expect(b[4]).toMatchObject({ id: 'missing_calendar', text: 'Nexeo web → Connectors' }); // loading is not missing
  });
  it('no overdue is not flagged', () => {
    expect(toDeviceKpis([{ label: 'Overdue', value: 0 }])).toEqual([{ label: 'Overdue', value: 0 }]);
  });
});

const ok = { op: 'task.update', args: { id: 'a1', update: 'done' }, idempotency_key: 'k1', confirmed_by_user: true, voice_score: 0.93 };

describe('act', () => {
  beforeEach(() => {
    log.create.mockReset(); log.findUnique.mockReset(); log.update.mockReset(); follow.mockReset(); auditFn.mockReset();
    log.create.mockResolvedValue({ id: 'audit1' });
    log.update.mockResolvedValue({});
    follow.mockResolvedValue({ ok: true, update: 'done', action: { id: 'a1', status: 'CLOSED' } });
  });

  it('does the work, audits it, and returns {ok, audit_id, item}', async () => {
    const r = await act('TMC-0001', 2, ok);
    expect(r).toEqual({ status: 200, body: { ok: true, audit_id: 'audit1', item: { id: 'a1', status: 'CLOSED' } } });
    expect(follow).toHaveBeenCalledWith('TMC-0001', 2, expect.objectContaining({ actionId: 'a1', update: 'done' }));
    expect(log.create.mock.calls[0][0].data).toMatchObject({ clientNumber: 'TMC-0001', userId: 2, op: 'task.update', idempotencyKey: 'k1', confirmedByUser: true, voiceScore: 0.93 });
    expect(log.update.mock.calls[0][0].data).toMatchObject({ status: 'ok' });
    expect(auditFn.mock.calls[0][0]).toMatchObject({ clientNumber: 'TMC-0001', actorId: 2, action: 'suzi.act.task.update', subjectId: 'a1', result: 'success' });
  });

  it('a repeated key replays the stored answer and does NOT do the work again', async () => {
    await act('TMC-0001', 2, ok);
    const fp = log.create.mock.calls[0][0].data.argsHash;
    log.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    log.findUnique.mockResolvedValueOnce({ id: 'audit1', argsHash: fp, status: 'ok', result: { ok: true, item: { id: 'a1', status: 'CLOSED' } }, createdAt: new Date() });
    const r = await act('TMC-0001', 2, ok);
    expect(r).toEqual({ status: 200, body: { ok: true, audit_id: 'audit1', item: { id: 'a1', status: 'CLOSED' }, replayed: true } });
    expect(follow).toHaveBeenCalledTimes(1);
  });

  it('the same key with other arguments is refused; a key still running is 409', async () => {
    log.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    log.findUnique.mockResolvedValueOnce({ id: 'x', argsHash: 'different', status: 'ok', result: {}, createdAt: new Date() });
    expect(await act('TMC-0001', 2, ok)).toMatchObject({ status: 409, body: { error: 'idempotency_key_reused' } });
    await act('TMC-0001', 2, { ...ok, idempotency_key: 'k2' }).catch(() => null);
    const fp = (await import('crypto')).createHash('sha256').update(`task.update\u0000${JSON.stringify(ok.args)}`).digest('hex');
    log.findUnique.mockResolvedValueOnce({ id: 'x', argsHash: fp, status: 'running', createdAt: new Date() });
    expect(await act('TMC-0001', 2, ok)).toMatchObject({ status: 409, body: { error: 'in_progress' } });
    expect(follow).not.toHaveBeenCalled();
  });

  it('the key is scoped to tenant AND user', async () => {
    log.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    log.findUnique.mockResolvedValueOnce(null);
    await act('TMC-0001', 2, ok);
    expect(log.findUnique.mock.calls[0][0].where).toEqual({ clientNumber_userId_idempotencyKey: { clientNumber: 'TMC-0001', userId: 2, idempotencyKey: 'k1' } });
  });

  it('a foreign item is 404, audited as a failure; the refusal is stored too', async () => {
    follow.mockResolvedValue({ ok: false, error: 'not_found' });
    const r = await act('TMC-0001', 2, ok);
    expect(r).toEqual({ status: 404, body: { ok: false, audit_id: 'audit1', error: 'not_found' } });
    expect(auditFn.mock.calls[0][0]).toMatchObject({ result: 'failure' });
    expect(log.update.mock.calls[0][0].data).toMatchObject({ status: 'failed' });
  });

  it('an unknown op or a missing key does nothing at all', async () => {
    expect(await act('TMC-0001', 2, { ...ok, op: 'calendar.book' })).toMatchObject({ status: 400, body: { error: 'unknown_op' } });
    expect(await act('TMC-0001', 2, { ...ok, idempotency_key: ' ' })).toMatchObject({ status: 400, body: { error: 'bad_idempotency_key' } });
    expect(log.create).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();
  });
});

describe('the routes trust only the gateway', () => {
  const app = express();
  app.use(express.json());
  app.use('/g', router);
  beforeEach(() => {
    userFind.mockReset(); pack.mockReset(); log.create.mockReset(); follow.mockReset();
    userFind.mockResolvedValue({ clientNumber: 'TMC-0001', isActive: true });
    pack.mockResolvedValue({ version: 1, actions: [], emails: [], calendar: { today: [] } });
  });
  const q = 'user_id=2&tenant_id=TMC-0001';
  it('Apache-forwarded 403, no or wrong secret 401, wrong tenant 404: nothing is built or written', async () => {
    expect((await request(app).get(`/g/day-pack?${q}`).set('Authorization', 'Bearer right-secret').set('X-Forwarded-For', '1.2.3.4')).status).toBe(403);
    expect((await request(app).get(`/g/day-pack?${q}`)).status).toBe(401);
    expect((await request(app).post('/g/act').set('Authorization', 'Bearer wrong').send({ user_id: 2, tenant_id: 'TMC-0001', ...ok })).status).toBe(401);
    userFind.mockResolvedValue({ clientNumber: 'OTHER', isActive: true });
    expect((await request(app).get(`/g/day-pack?${q}`).set('Authorization', 'Bearer right-secret')).status).toBe(404);
    expect((await request(app).post('/g/act').set('Authorization', 'Bearer right-secret').send({ user_id: 2, tenant_id: 'TMC-0001', ...ok })).status).toBe(404);
    expect(pack).not.toHaveBeenCalled();
    expect(log.create).not.toHaveBeenCalled();
  });
  it('the pack is built for that user in their own zone', async () => {
    const r = await request(app).get(`/g/day-pack?${q}`).set('Authorization', 'Bearer right-secret');
    expect(r.status).toBe(200);
    expect(pack).toHaveBeenCalledWith('TMC-0001', 2, { timezone: KHI });
  });
});
