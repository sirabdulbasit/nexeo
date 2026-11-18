/**
 * T39 round 2 (both AGREE 18 Nov 2026): meeting.reread on his word. Pinned: {meeting_id} or {all: true, days?} (14 by
 * default, at most 30, at most 10 meetings); only a Google-transcript meeting; another user's id is not_found; the answer
 * says per meeting where the text came from, its size and whether it changed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: (...a: any[]) => query(...a) } }));
const rec = (id: string, lines: number) => ({ id, way: 'google_transcript', sources: [{ way: 'google_transcript', text_from: 'google_doc' }], transcript: Array.from({ length: lines }, () => ({ t: 'x', speaker: 'S', text: 'a b' })), action_items: [] });
const store: Record<string, any> = {};
vi.mock('../src/services/meetings/meetingRecordStore', async () => ({ ...(await vi.importActual<any>('../src/services/meetings/meetingRecordStore')), getRecord: async (_c: string, _u: number, id: string) => store[id] ?? null }));
vi.mock('../src/services/meetings/meetTranscripts', () => ({ meetFor: async () => ({}) }));
const ingest = vi.fn();
vi.mock('../src/services/meetings/meetingProcessor', () => ({ ingestConference: (...a: any[]) => ingest(...a) }));

import { runMeetingOp } from '../src/services/suzi/suziMeetings';
const G = { signatureVerified: false };
const row = (id: string, way = 'google_transcript') => ({ id, meeting_key: `k-${id}`, conference_record: 'conf/1', title: 'T', event_id: null, start_at: null, end_at: null, way });

beforeEach(() => { query.mockReset(); ingest.mockReset(); store.m1 = rec('m1', 3); });

describe('meeting.reread', () => {
  it('one meeting: re-read, says source, size and changed', async () => {
    query.mockResolvedValue([row('m1')]);
    ingest.mockResolvedValue(rec('m1', 5));
    const r: any = await runMeetingOp('T', 2, 'meeting.reread', { meeting_id: 'm1' }, false, G);
    expect(r).toEqual({ ok: true, item: { meetings: [{ meeting_id: 'm1', transcript_from: 'google_doc', lines: 5, words: 10, changed: true }] } });
    expect(ingest.mock.calls[0][6]).toEqual({ reread: true });
    expect(query.mock.calls[0].slice(1)).toEqual(['T', 2, 'm1']);
  });
  it('all: his Google meetings of the last days (default 14, at most 30, at most 10)', async () => {
    query.mockResolvedValue([]);
    await runMeetingOp('T', 2, 'meeting.reread', { all: true, days: 90 }, false, G);
    expect(query.mock.calls[0][0]).toContain("way = 'google_transcript'");
    expect(query.mock.calls[0][0]).toContain('LIMIT 10');
    expect(query.mock.calls[0][3]).toBe('30');
  });
  it('refusals: nothing given, not his, not a Google transcript', async () => {
    expect(await runMeetingOp('T', 2, 'meeting.reread', {}, false, G)).toMatchObject({ error: 'bad_args' });
    query.mockResolvedValue([]);
    expect(await runMeetingOp('T', 2, 'meeting.reread', { meeting_id: 'x' }, false, G)).toMatchObject({ error: 'not_found' });
    query.mockResolvedValue([row('m2', 'computer')]);
    expect(await runMeetingOp('T', 2, 'meeting.reread', { meeting_id: 'm2' }, false, G)).toMatchObject({ error: 'bad_state' });
    expect(ingest).not.toHaveBeenCalled();
  });
});
