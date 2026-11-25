/**
 * Meeting record standard (founder 24 Nov 2026; Suzi-Builder AGREE 25 Nov). Pinned:
 *  ITEMS    owner from name, person_id or owner{}; no owner → owner_needed (never invented); a bad date is dropped.
 *  DEC      decisions keep id, confirmed_by and the [from, to] timestamps; plain strings still work.
 *  FIELDS   risks, open questions, chair, purpose; draft unless approved.
 *  FILL     a re-upload gives an existing item the owner/date it was missing, keeping his decision on it.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/db/prisma', () => ({ default: {} }));
import { actionItemsArg, decisionsArg, recordFieldsArg, transcriptEnArg } from '../src/services/meetings/meetingRecordFields';
import { mergeDerived } from '../src/services/meetings/meetingRecordStore';

describe('meeting record fields', () => {
  it('ITEMS', () => {
    expect(actionItemsArg([
      { id: 'A1', text: 'Share the test plan', owner: { name: 'Ali Haider' }, due: '2026-11-28', dependency: 'server access', source: ['12:01', '12:03'] },
      { title: 'Book the room', due: 'Friday' },
      { title: '' },
    ])).toEqual([
      { title: 'Share the test plan', owner_name: 'Ali Haider', due: '2026-11-28', dependency: 'server access', source: ['12:01', '12:03'], ref: 'A1' },
      { title: 'Book the room', owner_needed: true },
    ]);
  });
  it('DEC', () => {
    expect(decisionsArg([{ id: 'D1', text: 'Go live Monday', confirmed_by: 'Basit', source: ['10:00', '10:02'] }, 'Keep the old flow'])).toEqual([
      { id: 'D1', text: 'Go live Monday', confirmed_by: 'Basit', source: ['10:00', '10:02'] },
      { id: 'D2', text: 'Keep the old flow' },
    ]);
  });
  it('FIELDS', () => {
    expect(recordFieldsArg({ risks: [{ text: 'Server not ready', impact: 'delay' }], open_questions: ['Who signs off?'], chair: 'Basit', purpose: 'Testing review' }))
      .toEqual({ risks: [{ id: 'R1', text: 'Server not ready', impact: 'delay' }], open_questions: ['Who signs off?'], chair: 'Basit', purpose: 'Testing review', record_status: 'draft' });
    expect(recordFieldsArg({ status: 'approved' }).record_status).toBe('approved');
    expect(transcriptEnArg([{ t: '00:01', speaker: 'Ali', text: 'Hello' }])).toEqual([{ t: '00:01', speaker: 'Ali', text: 'Hello' }]);
    expect(transcriptEnArg([])).toBeNull();
  });
  it('FILL', () => {
    const rec: any = { minutes: 'm', minutes_edited: false, status: 'record_ready', action_items: [{ id: 'ai_1', title: 'Share the test plan', state: 'accepted', task_id: 't1', owner_needed: true }] };
    const m = mergeDerived(rec, { minutes: 'm2', decisions: [], action_items: [{ title: 'Share the test plan', owner_name: 'Ali Haider', due: '2026-11-28' }] as any });
    expect(m.action_items).toEqual([{ id: 'ai_1', title: 'Share the test plan', state: 'accepted', task_id: 't1', owner_name: 'Ali Haider', due: '2026-11-28' }]);
  });
});
