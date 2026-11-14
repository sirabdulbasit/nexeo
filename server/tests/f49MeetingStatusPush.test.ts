/**
 * F-4.9 (charter, agreed 13 Nov 2026): Nexeo pushes meeting.status to his live Suzi sessions on a real status
 * change only: a new record, a changed status or reason, and record_ready on every save of the notes (with updated
 * and the proposed count). A repeat of the same status pushes nothing; a finished record is never pushed back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ rec: null as any, pushed: [] as any[] }));
vi.mock('../src/db/prisma', () => ({ default: {
  $queryRawUnsafe: async () => (s.rec ? [s.rec] : []),
  $executeRawUnsafe: async (sql: string, ...a: any[]) => {
    if (/INSERT INTO meeting_records/.test(sql)) s.rec = { id: a[0], client_number: a[1], user_id: a[2], meeting_key: a[3], event_id: a[4], title: a[5], status: a[9], status_reason: a[10], action_items: [], updated_flag: false };
    else if (/SET status = \$2/.test(sql)) s.rec = { ...s.rec, status: a[1], status_reason: a[2] };
    else if (/status = 'record_ready'/.test(sql)) s.rec = { ...s.rec, status: 'record_ready', status_reason: null, action_items: JSON.parse(a[4]), updated_flag: a[5] };
    return 1;
  },
} }));
vi.mock('../src/services/suzi/gatewayAdminClient', () => ({ pushMeetingStatus: async (o: any, m: any) => { s.pushed.push({ o, m }); return { delivered: 1 }; } }));

import { setStatus, saveDerived, PUSH_STATUS } from '../src/services/meetings/meetingRecordStore';
const tick = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => { s.rec = null; s.pushed = []; PUSH_STATUS.on = true; });

describe('F-4.9 meeting.status push', () => {
  it('new record pushes; the same status again does not; a new reason does', async () => {
    await setStatus('TMC-0001', 2, 'event:e1', 'not_covered', { title: 'Ops', eventId: 'e1', reason: 'not_host' }); await tick();
    expect(s.pushed.map((p) => p.m.status)).toEqual(['not_covered']);
    expect(s.pushed[0]).toMatchObject({ o: { userId: 2, clientNumber: 'TMC-0001' }, m: { event_id: 'e1', title: 'Ops', reason: 'not_host' } });
    await setStatus('TMC-0001', 2, 'event:e1', 'not_covered', { reason: 'not_host' }); await tick();
    expect(s.pushed).toHaveLength(1);
    await setStatus('TMC-0001', 2, 'event:e1', 'failed', { reason: 'transcript not produced' }); await tick();
    expect(s.pushed.map((p) => p.m.status)).toEqual(['not_covered', 'failed']);
  });
  it('record_ready carries updated and the proposed count; a late status never moves it back', async () => {
    await setStatus('TMC-0001', 2, 'event:e2', 'transcribing', { title: 'PMS' }); await tick();
    await saveDerived(s.rec.id, { minutes: 'm', minutes_offered: null, decisions: [], action_items: [{ id: 'a', title: 'x', state: 'proposed' }, { id: 'b', title: 'y', state: 'accepted' }] as any, updated: false }); await tick();
    expect(s.pushed[1].m).toMatchObject({ status: 'record_ready', updated: false, action_items_proposed: 1 });
    await setStatus('TMC-0001', 2, 'event:e2', 'failed', { reason: 'late' }); await tick();
    expect(s.pushed).toHaveLength(2);
  });
  it('switched off (until the gateway route is installed): nothing is pushed', async () => {
    PUSH_STATUS.on = false;
    await setStatus('TMC-0001', 2, 'event:e3', 'not_covered', { reason: 'not_host' }); await tick();
    expect(s.pushed).toHaveLength(0);
  });
});
