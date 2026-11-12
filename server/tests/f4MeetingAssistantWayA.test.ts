/**
 * F-4 Way A (Functional Charter, agreed 12 Nov 2026). Pinned:
 *  PUSH      only Google's OIDC token for nexeo-meet-push with our URL as audience is accepted; anything else is 401;
 *            a delivery is acknowledged at once and processed once per event id.
 *  SCOPE     a meeting he does not host is not_covered and nothing is asked of Google.
 *  C6        re-deriving never undoes his decisions: accepted/skipped items stay, only new items are proposed and
 *            never one his open items already say; minutes he edited are kept and the new version is offered.
 *  OPS       attend/leave are not_yet (Way B parked); delete needs his confirmation and a signature; upload needs the
 *            switch on; the record reads in F-4.4's shape with sources[].way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const exec = vi.fn(async () => 1);
const query = vi.fn(async () => [] as any[]);
vi.mock('../src/db/prisma', () => ({ default: { $executeRawUnsafe: (...a: any[]) => (exec as any)(...a), $queryRawUnsafe: (...a: any[]) => (query as any)(...a) } }));
const handle = vi.fn(async () => 'processed');
vi.mock('../src/services/meetings/meetEvents', async (orig) => {
  const real: any = await (orig as any)();
  return { ...real, handleEvent: (...a: any[]) => (handle as any)(...a), verifyPushToken: (h: any) => real.verifyPushToken(h, { verify: async (t: string) => tokens[t] }) };
});
const tokens: Record<string, any> = {
  good: { iss: 'https://accounts.google.com', aud: 'https://tai.tmcltd.com/api/v1/meet/events', email: 'nexeo-meet-push@nexeo-tmc.iam.gserviceaccount.com', email_verified: true },
  otherSa: { iss: 'https://accounts.google.com', aud: 'https://tai.tmcltd.com/api/v1/meet/events', email: 'someone@evil.iam.gserviceaccount.com', email_verified: true },
  otherAud: { iss: 'https://accounts.google.com', aud: 'https://elsewhere', email: 'nexeo-meet-push@nexeo-tmc.iam.gserviceaccount.com', email_verified: true },
};
const meetFor = vi.fn();
vi.mock('../src/services/meetings/meetTranscripts', async (orig) => ({ ...(await (orig as any)()), meetFor: (...a: any[]) => meetFor(...a) }));
const flag = vi.fn(async () => '');
vi.mock('../src/services/featureFlagService', () => ({ getFlagValue: (...a: any[]) => (flag as any)(...a) }));

import router from '../src/routes/meetEventRoutes';
import { parsePush } from '../src/services/meetings/meetEvents';
import { processEndedEvent } from '../src/services/meetings/meetingProcessor';
import { mergeDerived, WAY_RANK } from '../src/services/meetings/meetingRecordStore';
import { runMeetingOp, toWire } from '../src/services/suzi/suziMeetings';
import { MEET_SCOPES } from '../src/services/connectorService';

const app = express().use(express.json()).use('/', router);
const push = (id: string) => ({ message: { messageId: 'm1', attributes: { 'ce-id': id, 'ce-type': 'google.workspace.meet.transcript.v2.fileGenerated', 'ce-source': '//workspaceevents.googleapis.com/subscriptions/s1' }, data: Buffer.from(JSON.stringify({ transcript: { name: 'conferenceRecords/c1/transcripts/t1' } })).toString('base64') } });
const flush = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => { exec.mockReset(); exec.mockResolvedValue(1); query.mockReset(); query.mockResolvedValue([]); handle.mockClear(); meetFor.mockReset(); flag.mockReset(); flag.mockResolvedValue(''); });

describe('PUSH: Google OIDC only, acknowledged at once, processed once', () => {
  it('refuses no token, another service account and another audience', async () => {
    expect((await request(app).post('/meet/events').send(push('e1'))).status).toBe(401);
    expect((await request(app).post('/meet/events').set('Authorization', 'Bearer otherSa').send(push('e1'))).status).toBe(401);
    expect((await request(app).post('/meet/events').set('Authorization', 'Bearer otherAud').send(push('e1'))).status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });
  it('accepts the real token, answers 204, processes the event', async () => {
    const r = await request(app).post('/meet/events').set('Authorization', 'Bearer good').send(push('e2'));
    expect(r.status).toBe(204);
    await flush();
    expect(handle).toHaveBeenCalledTimes(1);
    expect((handle.mock.calls[0] as any[])[0]).toMatchObject({ id: 'e2', data: { transcript: { name: 'conferenceRecords/c1/transcripts/t1' } } });
  });
  it('a redelivery of the same event id is acknowledged and not processed again', async () => {
    exec.mockResolvedValue(0); // the receipt already exists
    const r = await request(app).post('/meet/events').set('Authorization', 'Bearer good').send(push('e2'));
    expect(r.status).toBe(204);
    await flush();
    expect(handle).not.toHaveBeenCalled();
  });
  it('parses the CloudEvent out of the Pub/Sub body', () => {
    expect(parsePush(push('e3'))).toMatchObject({ id: 'e3', type: 'google.workspace.meet.transcript.v2.fileGenerated', source: '//workspaceevents.googleapis.com/subscriptions/s1' });
  });
});

describe('SCOPE: a meeting he does not host', () => {
  it('is not_covered and Google is never asked', async () => {
    query.mockResolvedValue([{ id: 'mtg_1', meeting_key: 'event:ev1', status: 'not_covered' }]);
    const r = await processEndedEvent('T', 2, ['basit.ahmed@tmcltd.com'], { id: 'ev1', title: 'Colleague sync', start: '2026-11-12T10:00:00Z', end: '2026-11-12T10:30:00Z', organizer: 'colleague@tmcltd.com', link: 'https://meet.google.com/abc-defg-hij' });
    expect(r).toBe('not_covered');
    expect(meetFor).not.toHaveBeenCalled();
  });
});

describe('C6: his decisions survive a better transcript', () => {
  const rec: any = {
    minutes: 'His own edited minutes', minutes_edited: true, status: 'record_ready',
    action_items: [
      { id: 'a1', title: 'Send the SAP quote', state: 'accepted', task_id: 't9' },
      { id: 'a2', title: 'Book the venue', state: 'skipped' },
    ],
  };
  it('keeps accepted and skipped items, adds only new ones, never one his open items already say', () => {
    const m = mergeDerived(rec, {
      minutes: 'Better minutes', decisions: ['Go with option B'],
      action_items: [{ title: 'Send the SAP quote' }, { title: 'Book the venue' }, { title: 'Share the deck with Haseeb' }, { title: 'Reply to Sofia Rana on the Din Textile costing' }],
    }, ['Reply to Sofia Rana on the Din Textile costing']);
    expect(m.action_items.find((a) => a.id === 'a1')).toMatchObject({ state: 'accepted', task_id: 't9' });
    expect(m.action_items.find((a) => a.id === 'a2')).toMatchObject({ state: 'skipped' });
    expect(m.action_items.filter((a) => a.state === 'proposed').map((a) => a.title)).toEqual(['Share the deck with Haseeb']);
    expect(m.updated).toBe(true);
  });
  it('minutes he edited are kept, the improved version offered beside them', () => {
    const m = mergeDerived(rec, { minutes: 'Better minutes', decisions: [], action_items: [] });
    expect(m.minutes).toBe('His own edited minutes');
    expect(m.minutes_offered).toBe('Better minutes');
  });
  it('the best transcript wins in the agreed order', () => {
    expect(WAY_RANK.google_transcript > WAY_RANK.participant && WAY_RANK.participant > WAY_RANK.imported && WAY_RANK.imported > WAY_RANK.computer).toBe(true);
  });
});

describe('OPS', () => {
  const gate = { signatureVerified: false };
  it('attend and leave are not_yet (Way B parked)', async () => {
    expect(await runMeetingOp('T', 2, 'meeting.attend', { event_id: 'x' }, true, gate)).toMatchObject({ ok: false, error: 'not_yet' });
    expect(await runMeetingOp('T', 2, 'meeting.leave', { meeting_id: 'x' }, true, gate)).toMatchObject({ ok: false, error: 'not_yet' });
  });
  it('delete needs his confirmation and a signature, and touches nothing without them', async () => {
    expect(await runMeetingOp('T', 2, 'meeting.delete', { meeting_id: 'mtg_1' }, false, { signatureVerified: true })).toMatchObject({ error: 'needs_confirmation' });
    expect(await runMeetingOp('T', 2, 'meeting.delete', { meeting_id: 'mtg_1' }, true, gate)).toMatchObject({ error: 'needs_signature' });
    expect(exec).not.toHaveBeenCalled();
    expect(await runMeetingOp('T', 2, 'meeting.delete', { meeting_id: 'mtg_1' }, true, { signatureVerified: true })).toMatchObject({ ok: true, item: { deleted: true } });
    expect(String((exec.mock.calls[0] as any[])[0])).toMatch(/DELETE FROM meeting_records WHERE client_number = \$1 AND user_id = \$2 AND id = \$3/);
  });
  it('upload is refused while his switch is off: meeting data stays on the computer', async () => {
    expect(await runMeetingOp('T', 2, 'meeting.upload', { title: 'x', start: '2026-11-12T10:00:00Z', end: '2026-11-12T11:00:00Z' }, true, gate)).toMatchObject({ error: 'switched_off' });
    flag.mockResolvedValue('2');
    expect(await runMeetingOp('T', 2, 'meeting.upload', { title: 'x', start: '2026-11-12T11:00:00Z', end: '2026-11-12T10:00:00Z' }, true, gate)).toMatchObject({ error: 'bad_date' });
  });
  it('the record reads in F-4.4 shape, with sources[].way', () => {
    const w: any = toWire({ id: 'mtg_1', event_id: 'ev1', title: 'Sync', platform: 'meet', start_at: new Date('2026-11-12T10:00:00Z'), end_at: new Date('2026-11-12T10:30:00Z'), way: 'google_transcript',
      sources: [{ way: 'google_transcript', ref: 'conferenceRecords/c/transcripts/t', received_at: 'x' }], participants: [{ name: 'Basit Ahmed' }], transcript: [{ t: 'x', speaker: 'Basit Ahmed', text: 'hello' }],
      minutes: 'm', minutes_offered: null, decisions: [], action_items: [{ id: 'a', title: 'Do it', state: 'proposed' }], status: 'record_ready', updated_flag: false } as any, true);
    expect(w).toMatchObject({ meeting_id: 'mtg_1', way: 'google_transcript', sources: [{ way: 'google_transcript' }], participants: [{ name: 'Basit Ahmed' }], action_items_proposed: 1, status: 'record_ready' });
    expect(w.sources[0].ref).toBeUndefined();
  });
  it('the Meet scopes are the two agreed ones', () => {
    expect(MEET_SCOPES).toEqual(['https://www.googleapis.com/auth/meetings.space.readonly', 'https://www.googleapis.com/auth/meetings.space.settings']);
  });
});
