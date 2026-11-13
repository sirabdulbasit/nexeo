/**
 * F-4.7 (suzi-23; Nexeo AGREE 13 Nov 16:10:35 PKT). Pinned: meeting.item skip / propose, confirmed, his own record;
 * a bad decision or an unknown item changes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setState = vi.fn(async () => 'skipped' as any);
vi.mock('../src/services/meetings/meetingRecordStore', async (orig) => ({ ...(await (orig as any)()), setActionItemState: (...a: any[]) => (setState as any)(...a) }));
vi.mock('../src/db/prisma', () => ({ default: {} }));

import { runMeetingOp, MEETING_OPS } from '../src/services/suzi/suziMeetings';

beforeEach(() => setState.mockClear());

describe('meeting.item', () => {
  it('is an op; skip and propose set the state through the one store function', async () => {
    expect(MEETING_OPS).toContain('meeting.item');
    expect(await runMeetingOp('T', 2, 'meeting.item', { meeting_id: 'mtg_1', item_id: 'ai_1', decision: 'skip' }, true, { signatureVerified: false }))
      .toEqual({ ok: true, item: { meeting_id: 'mtg_1', item_id: 'ai_1', state: 'skipped' } });
    expect(setState).toHaveBeenCalledWith('T', 2, 'mtg_1', 'ai_1', 'skipped');
    setState.mockResolvedValueOnce('proposed' as any);
    await runMeetingOp('T', 2, 'meeting.item', { meeting_id: 'mtg_1', item_id: 'ai_1', decision: 'propose' }, true, { signatureVerified: false });
    expect(setState).toHaveBeenLastCalledWith('T', 2, 'mtg_1', 'ai_1', 'proposed');
  });
  it('refuses a bad decision or no confirmation; an unknown item is not_found', async () => {
    expect(await runMeetingOp('T', 2, 'meeting.item', { meeting_id: 'm', item_id: 'i', decision: 'delete' }, true, { signatureVerified: false })).toMatchObject({ error: 'bad_decision' });
    expect(await runMeetingOp('T', 2, 'meeting.item', { meeting_id: 'm', item_id: 'i', decision: 'skip' }, false, { signatureVerified: false })).toMatchObject({ error: 'needs_confirmation' });
    setState.mockResolvedValueOnce(null as any);
    expect(await runMeetingOp('T', 2, 'meeting.item', { meeting_id: 'm', item_id: 'nope', decision: 'skip' }, true, { signatureVerified: false })).toMatchObject({ error: 'not_found' });
  });
});
