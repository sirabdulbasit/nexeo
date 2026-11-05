/**
 * Functional Charter, "Reminders and presence". Pinned:
 *  1. alive means what the charter says it means;
 *  2. each row of the rules: alive, not alive, quiet hours, card first and spoken after;
 *  3. no presence row or unreadable presence: contacted as before, because a lost reminder is worse;
 *  4. the pump: speaks, shows cards, emails once, keeps what failed, a third party's words are never spoken;
 *  5. the morning brief stops only after handover;
 *  6. WhatsApp is not used for an adopted user; the brief and things asked for just now still go.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const q = vi.fn();
const exec = vi.fn();
const findFirst = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: {
  $queryRawUnsafe: (...a: any[]) => q(...a), $executeRawUnsafe: (...a: any[]) => exec(...a),
  user: { findFirst: (...a: any[]) => findFirst(...a) },
} }));
const tell = vi.fn(); const notice = vi.fn();
vi.mock('../src/services/suzi/gatewayAdminClient', () => ({
  tellSuzi: (...a: any[]) => tell(...a), noticeSuzi: (...a: any[]) => notice(...a),
  suziReasonFor: (kind: string) => (kind === 'critical_bundle' ? 'email' : kind === 'open_item_owner_chase' ? 'task' : null),
}));
const quiet = vi.fn(); const email = vi.fn(); const delivered = vi.fn();
vi.mock('../src/services/notifications/brainOutboundService', () => ({
  isWithinQuietHours: (...a: any[]) => quiet(...a), emailHeldItem: (...a: any[]) => email(...a), recordSuziDelivery: (...a: any[]) => delivered(...a),
}));
vi.mock('../src/services/whatsapp/displayIdentity', () => ({ scrubSyntheticIdentities: async (s: string) => s }));

import { briefHandedOver, decide, isAlive, primaryDeviceOf, pumpHeld, reachFor, recordPresence } from '../src/services/suzi/suziReach';

const now = new Date('2026-11-04T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;

beforeEach(() => {
  for (const f of [q, exec, findFirst, tell, notice, quiet, email, delivered]) f.mockReset();
  exec.mockResolvedValue(1); findFirst.mockResolvedValue({ notificationPreferences: {} }); quiet.mockResolvedValue(false);
  tell.mockResolvedValue({ delivered: 1 }); notice.mockResolvedValue({ delivered: 1 }); email.mockResolvedValue(true);
});

describe('CN-011: in a meeting', () => {
  const base = { critical: true, emergency: false, speakable: true, carded: false, alive: true, quiet: false, absentMs: 0, emailed: false };
  it('alive, so no other channel; a critical item is a silent card and stays owed its spoken turn', () => {
    expect(decide({ ...base, meeting: true })).toEqual({ step: 'card', email: false });
    expect(decide({ ...base, meeting: true, carded: true })).toEqual({ step: 'hold', email: false });
  });
  it('when the meeting ends, it is spoken', () => {
    expect(decide({ ...base, carded: true })).toEqual({ step: 'speak', email: false });
  });
});

describe('link T11: nudges off', () => {
  const base = { critical: true, emergency: false, speakable: true, carded: false, alive: true, quiet: false, absentMs: 0, emailed: false };
  it('a critical item is a silent card, with no spoken turn; nudges on is unchanged', () => {
    expect(decide({ ...base, nudgesOff: true })).toEqual({ step: 'card', email: false });
    expect(decide(base)).toEqual({ step: 'speak', email: false });
  });
  it('not even an emergency is spoken, and no other channel starts', () => {
    expect(decide({ ...base, emergency: true, nudgesOff: true })).toEqual({ step: 'card', email: false });
  });
  it('away with nudges off, no email after 10 minutes; with nudges on, the email still goes', () => {
    const away = { ...base, alive: false, absentMs: 11 * 60_000 };
    expect(decide({ ...away, nudgesOff: true })).toEqual({ step: 'hold', email: false });
    expect(decide(away)).toEqual({ step: 'hold', email: true });
  });
});

describe('alive', () => {
  const p = (state: string, frame: number, since = frame) => ({ state, last_frame_at: ago(frame), state_since: ago(since) });
  it('active with a frame in the last 3 minutes', () => {
    expect(isAlive(p('active', 2 * MIN), now)).toBe(true);
    expect(isAlive(p('active', 3 * MIN + 1), now)).toBe(false);
  });
  it('away counts for under 30 minutes, and still needs a fresh frame', () => {
    expect(isAlive(p('away', MIN, 29 * MIN), now)).toBe(true);
    expect(isAlive(p('away', MIN, 30 * MIN), now)).toBe(false);
    expect(isAlive(p('away', 4 * MIN, 5 * MIN), now)).toBe(false);
  });
  it('locked, asleep and paused are not alive, however fresh', () => {
    for (const s of ['locked', 'asleep', 'paused']) expect(isAlive(p(s, 0), now)).toBe(false);
  });
});

describe('the rules', () => {
  const base = { critical: false, emergency: false, speakable: false, carded: false, alive: true, quiet: false, absentMs: 0, emailed: false };
  it('alive: critical and speakable is spoken at once; everything else is a card', () => {
    expect(decide({ ...base, critical: true, speakable: true }).step).toBe('speak');
    expect(decide(base).step).toBe('card');
    expect(decide({ ...base, speakable: true }).step).toBe('card');
    expect(decide({ ...base, critical: true }).step).toBe('card'); // a person's words stay off the voice
  });
  it('quiet hours: critical is a silent card, then waits to be spoken; an emergency is still spoken', () => {
    expect(decide({ ...base, critical: true, speakable: true, quiet: true }).step).toBe('card');
    expect(decide({ ...base, critical: true, speakable: true, quiet: true, carded: true }).step).toBe('hold');
    expect(decide({ ...base, critical: true, speakable: true, carded: true }).step).toBe('speak');
    expect(decide({ ...base, critical: true, emergency: true, speakable: true, quiet: true }).step).toBe('speak');
  });
  it('not alive: held; email only for critical, after 10 minutes, outside quiet hours, once', () => {
    const away = { ...base, alive: false, critical: true, absentMs: 10 * MIN };
    expect(decide(away)).toEqual({ step: 'hold', email: true });
    expect(decide({ ...away, absentMs: 10 * MIN - 1 }).email).toBe(false);
    expect(decide({ ...away, quiet: true }).email).toBe(false);
    expect(decide({ ...away, emailed: true }).email).toBe(false);
    expect(decide({ ...away, critical: false }).email).toBe(false);
  });
});

describe('reach', () => {
  it('no presence row, or unreadable presence: not adopted, contacted as before', async () => {
    q.mockResolvedValue([]);
    expect((await reachFor('T', 2, now)).adopted).toBe(false);
    q.mockRejectedValue(new Error('db down'));
    expect((await reachFor('T', 2, now)).adopted).toBe(false);
  });
  it('absence is counted from the last time it was alive, not the last frame', async () => {
    q.mockResolvedValue([{ state: 'locked', state_since: ago(40 * MIN), last_frame_at: ago(MIN), last_alive_at: ago(40 * MIN) }]);
    expect(await reachFor('T', 2, now)).toEqual({ adopted: true, alive: false, absentMs: 40 * MIN });
  });
  it('coming back is reported once; a state that continues keeps its start time', async () => {
    q.mockResolvedValueOnce([{ state: 'asleep', state_since: ago(60 * MIN), last_frame_at: ago(60 * MIN), last_alive_at: ago(60 * MIN) }]).mockResolvedValueOnce([{ state: 'asleep', state_since: ago(60 * MIN) }]);
    expect(await recordPresence('T', 2, 'd', 'active', now)).toEqual({ returned: true });
    q.mockResolvedValueOnce([{ state: 'active', state_since: ago(MIN), last_frame_at: ago(MIN), last_alive_at: ago(MIN) }]).mockResolvedValueOnce([{ state: 'active', state_since: ago(MIN) }]);
    expect(await recordPresence('T', 2, 'd', 'active', now)).toEqual({ returned: false });
    expect(exec.mock.calls[1][5]).toEqual(ago(MIN));
  });
});

describe('the pump', () => {
  const row = (o: any = {}) => ({ id: '1', kind: 'critical_bundle', summary: 's', body: 'Two critical emails', urgency: 'high', provenance: null, metadata: {}, carded_at: null, emailed_at: null, ...o });
  const aliveRows = [{ state: 'active', state_since: ago(MIN), last_frame_at: ago(MIN), last_alive_at: ago(MIN) }];
  const goneRows = [{ state: 'asleep', state_since: ago(20 * MIN), last_frame_at: ago(20 * MIN), last_alive_at: ago(20 * MIN) }];
  const setup = (rows: any[], presence: any[]) => q.mockResolvedValueOnce(rows).mockResolvedValueOnce(presence);

  it('alive: critical is spoken and finished, routine is a card and finished, Brain remembers both', async () => {
    setup([row(), row({ id: '2', kind: 'connector_stale', urgency: 'normal', body: 'Gmail needs reconnecting' })], aliveRows);
    expect(await pumpHeld('T', 2, now)).toMatchObject({ spoken: 1, carded: 1, emailed: 0 });
    expect(tell.mock.calls[0][1]).toMatchObject({ kind: 'critical_bundle', body: 'Two critical emails' });
    expect(notice.mock.calls[0][1]).toMatchObject({ text: 'Gmail needs reconnecting' });
    expect(delivered).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls.filter((c) => String(c[0]).includes("state = 'delivered'"))).toHaveLength(2);
  });
  it('another person\'s words are never spoken, even when critical', async () => {
    setup([row({ provenance: 'quoted_third_party' })], aliveRows);
    await pumpHeld('T', 2, now);
    expect(tell).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledTimes(1);
  });
  it('nobody online: stays held and Brain does not claim it told them', async () => {
    tell.mockResolvedValue({ delivered: 0 });
    setup([row()], aliveRows);
    expect(await pumpHeld('T', 2, now)).toMatchObject({ spoken: 0 });
    expect(exec.mock.calls.filter((c) => String(c[0]).includes("state = 'delivered'"))).toHaveLength(0);
    expect(delivered).not.toHaveBeenCalled();
  });
  it('quiet hours, alive: card now, kept for its spoken turn', async () => {
    quiet.mockResolvedValue(true);
    setup([row()], aliveRows);
    expect(await pumpHeld('T', 2, now)).toMatchObject({ spoken: 0, carded: 1 });
    expect(exec.mock.calls.some((c) => String(c[0]).includes('carded_at = now()'))).toBe(true);
    expect(exec.mock.calls.some((c) => String(c[0]).includes("state = 'delivered'"))).toBe(false);
  });
  it('the default quiet hours are 22:00-08:00; the user\'s own win', async () => {
    setup([row()], aliveRows);
    await pumpHeld('T', 2, now);
    expect(quiet.mock.calls[0][0]).toMatchObject({ quietStart: '22:00', quietEnd: '08:00' });
    findFirst.mockResolvedValue({ notificationPreferences: { brain_channel: { quietStart: '23:30', quietEnd: '06:00' } } });
    setup([row()], aliveRows);
    await pumpHeld('T', 2, now);
    expect(quiet.mock.calls[1][0]).toMatchObject({ quietStart: '23:30', quietEnd: '06:00' });
  });
  it('gone for 10 minutes: critical is emailed and stays held for his return; a failed email can try again', async () => {
    setup([row()], goneRows);
    expect(await pumpHeld('T', 2, now)).toMatchObject({ emailed: 1, spoken: 0 });
    expect(tell).not.toHaveBeenCalled();
    email.mockResolvedValue(false);
    setup([row()], goneRows);
    expect(await pumpHeld('T', 2, now)).toMatchObject({ emailed: 0 });
    expect(exec.mock.calls.some((c) => String(c[0]).includes('emailed_at = NULL'))).toBe(true);
  });
  it('a claim already taken sends no second email', async () => {
    exec.mockImplementation(async (sql: string) => (String(sql).includes('emailed_at = now()') ? 0 : 1));
    setup([row()], goneRows);
    await pumpHeld('T', 2, now);
    expect(email).not.toHaveBeenCalled();
  });
  it('at most 3 spoken in one pump; the rest stay held', async () => {
    setup([1, 2, 3, 4].map((i) => row({ id: String(i) })), aliveRows);
    expect(await pumpHeld('T', 2, now)).toMatchObject({ spoken: 3 });
  });
  it('a database failure never throws', async () => {
    exec.mockRejectedValue(new Error('down'));
    await expect(pumpHeld('T', 2, now)).resolves.toMatchObject({ spoken: 0 });
  });
});

describe('the morning brief', () => {
  it('stops only after handover; if this cannot be read he keeps his brief', async () => {
    q.mockResolvedValueOnce([]);
    expect(await briefHandedOver('T', 2)).toBe(false);
    q.mockResolvedValueOnce([{ '?column?': 1 }]);
    expect(await briefHandedOver('T', 2)).toBe(true);
    q.mockRejectedValueOnce(new Error('down'));
    expect(await briefHandedOver('T', 2)).toBe(false);
  });
});

describe('the device in charge (Functional Charter row 15)', () => {
  it('reach counts only that device once one is chosen; otherwise any', async () => {
    q.mockReset();
    q.mockResolvedValue([]);
    await reachFor('T', 2);
    expect(q.mock.calls[0][0]).toContain("device_id = COALESCE((SELECT notification_preferences->'brain_channel'->>'suziPrimaryDevice' FROM users WHERE id = $2), device_id)");
    expect(q.mock.calls[0].slice(1)).toEqual(['T', 2]);
  });
  it('reads the choice inside the tenant; nobody chose is null', async () => {
    q.mockReset();
    q.mockResolvedValueOnce([{ device_id: 'd1' }]);
    expect(await primaryDeviceOf('T', 2)).toBe('d1');
    expect(q.mock.calls[0].slice(1)).toEqual([2, 'T']);
    expect(q.mock.calls[0][0]).toContain('client_number = $2');
    q.mockResolvedValueOnce([{ device_id: null }]);
    expect(await primaryDeviceOf('T', 2)).toBeNull();
    q.mockResolvedValueOnce([]);
    expect(await primaryDeviceOf('T', 2)).toBeNull();
  });
});
