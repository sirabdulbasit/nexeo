/**
 * F-4.2 (agreed 12 Nov 2026) and the founder's add-on the same day: the Meeting Assistant switch is per user, in his
 * Settings, off by default. Pinned:
 *  ON        stored in HIS preferences only; another user's preferences are never written;
 *  SCOPES    on without both Meet scopes in his Google grant → needs_reconnect (Settings shows the reconnect prompt);
 *            on with both → no prompt; no Google connection → needs_reconnect;
 *  OFF       his Workspace Events subscription is dropped; his records are not touched;
 *  ROUTE     PUT /profile/meeting-assistant takes the user from the session; a non-boolean is 400.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const users: Record<number, any> = {};
const update = vi.fn(async ({ where, data }: any) => { users[where.id] = { notificationPreferences: data.notificationPreferences }; return users[where.id]; });
const exec = vi.fn(async () => 1);
vi.mock('../src/db/prisma', () => ({ default: {
  user: { findUnique: async ({ where }: any) => users[where.id] ?? null, update: (...a: any[]) => (update as any)(...a) },
  $executeRawUnsafe: (...a: any[]) => (exec as any)(...a), $queryRawUnsafe: async () => [],
} }));
vi.mock('../src/middleware/auth', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 2, clientNumber: 'T' }; next(); } }));

import { setSwitch, view, isOn, MEET_SCOPE_URLS } from '../src/services/meetings/meetingSwitch';
import router from '../src/routes/profileRoutes';

const all = (s: string[]) => async () => s;
beforeEach(() => { for (const k of Object.keys(users)) delete users[+k]; users[2] = { notificationPreferences: { brain_channel: { timezone: 'Asia/Karachi' } } }; users[3] = { notificationPreferences: { meeting_assistant: { enabled: true } } }; update.mockClear(); exec.mockClear(); });

describe('per user, off by default', () => {
  it('is off for a user who never turned it on', async () => {
    expect(await isOn(2)).toBe(false);
  });
  it('turning it on writes only his preferences, keeping his other settings', async () => {
    const drop = vi.fn();
    const v = await setSwitch(2, 'T', true, { scopesOf: all(MEET_SCOPE_URLS), dropSubscription: drop });
    expect(v).toEqual({ enabled: true, meet_scopes: true, needs_reconnect: false });
    expect(update).toHaveBeenCalledTimes(1);
    expect((update.mock.calls[0] as any[])[0].where).toEqual({ id: 2 });
    expect(users[2].notificationPreferences.brain_channel).toEqual({ timezone: 'Asia/Karachi' });
    expect(users[3].notificationPreferences.meeting_assistant.enabled).toBe(true); // the other user untouched
    expect(drop).not.toHaveBeenCalled();
  });
});

describe('missing Meet scopes → reconnect prompt', () => {
  it('on, but the grant lacks the Meet scopes: needs_reconnect', async () => {
    expect(await setSwitch(2, 'T', true, { scopesOf: all(['https://www.googleapis.com/auth/gmail.readonly']), dropSubscription: vi.fn() }))
      .toEqual({ enabled: true, meet_scopes: false, needs_reconnect: true });
  });
  it('on, but no Google connection at all: needs_reconnect', async () => {
    expect(await setSwitch(2, 'T', true, { scopesOf: async () => null, dropSubscription: vi.fn() })).toMatchObject({ enabled: true, needs_reconnect: true });
  });
  it('off: no prompt and no Google call', async () => {
    const scopesOf = vi.fn();
    expect(await view(2, { scopesOf })).toEqual({ enabled: false, meet_scopes: null, needs_reconnect: false });
    expect(scopesOf).not.toHaveBeenCalled();
  });
});

describe('off', () => {
  it('drops his subscription and never deletes a meeting record', async () => {
    users[2].notificationPreferences.meeting_assistant = { enabled: true };
    const drop = vi.fn(async () => undefined);
    expect(await setSwitch(2, 'T', false, { dropSubscription: drop })).toMatchObject({ enabled: false });
    expect(drop).toHaveBeenCalledWith('T', 2);
    expect(exec.mock.calls.some((c: any[]) => /meeting_records/.test(String(c[0])))).toBe(false);
  });
});

describe('route', () => {
  const app = express().use(express.json()).use('/', router);
  it('a non-boolean is refused', async () => {
    expect((await request(app).put('/meeting-assistant').send({ enabled: 'yes' })).status).toBe(400);
  });
  it('the user comes from the session, never the body', async () => {
    await request(app).put('/meeting-assistant').send({ enabled: false, userId: 3 });
    expect((update.mock.calls[0] as any[])[0].where).toEqual({ id: 2 });
    expect(users[3].notificationPreferences.meeting_assistant.enabled).toBe(true);
  });
});
