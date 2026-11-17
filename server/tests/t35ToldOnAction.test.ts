/**
 * T35 (a) (both AGREE 17 Nov 2026): forward answers once assigned (told: "pending"); the task Suzi reads then carries
 * told: sent | drafted | failed, and told_draft_id when the note ended as a draft (Suzi's counter).
 */
import { describe, it, expect, vi } from 'vitest';

const s = vi.hoisted(() => ({ meta: null as any }));
vi.mock('../src/db/prisma', () => ({ default: {
  openItem: { findFirst: async () => ({ id: 'i7', title: 'Session on Vision Metrics', priority: 'medium', status: 'DELEGATED', delegateeName: 'Sofia Rana', createdAt: new Date('2026-11-16T08:00:00Z'), updatedAt: new Date(), metadata: s.meta, notes: [], delegationTrail: [] }) },
  $queryRawUnsafe: async () => [],
} }));
import { actionById } from '../src/services/suzi/suziActions';

describe('T35 told on the task', () => {
  it('drafted → told + told_draft_id', async () => {
    s.meta = { suziTold: { state: 'drafted', draft_id: '3550' } };
    expect(await actionById('T', 2, 'i7', 'Asia/Karachi')).toMatchObject({ owner: 'Sofia Rana', told: 'drafted', told_draft_id: '3550' });
  });
  it('pending / sent carry no draft id; nothing recorded → no told field', async () => {
    s.meta = { suziTold: { state: 'sent', draft_id: '3550' } };
    const a: any = await actionById('T', 2, 'i7', 'Asia/Karachi');
    expect(a.told).toBe('sent'); expect(a.told_draft_id).toBeUndefined();
    s.meta = {};
    expect((await actionById('T', 2, 'i7', 'Asia/Karachi') as any).told).toBeUndefined();
  });
});
