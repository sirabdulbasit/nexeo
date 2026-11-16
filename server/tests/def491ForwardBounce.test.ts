/**
 * DEF-491 (outside review; Suzi Master AGREE 16 Nov 2026): "delivered" meant only "in his Sent folder". Now (a) the
 * pack says "sent" for that; (b) a bounce notice carrying the forward's Message-ID within 30 minutes makes it "bounced"
 * and cancels the person's task; (c) sent_at is the field (delivered_at kept with the same value until 23 Nov).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ rows: [] as any[], updates: [] as any[], status: [] as any[], won: true }));
vi.mock('../src/db/prisma', () => ({ default: {
  $queryRawUnsafe: async (sql: string, ...a: any[]) => {
    if (/UPDATE agent_actions/.test(sql)) { s.updates.push({ id: a[0], patch: JSON.parse(a[1]) }); return s.won ? [{ id: a[0] }] : []; }
    return s.rows;
  },
} }));
vi.mock('../src/services/openItemsService', () => ({ changeStatus: async (...a: any[]) => { s.status.push(a); } }));
import { bounceSweep, BOUNCE_WINDOW_MS } from '../src/jobs/ruleForwardJob';

const now = new Date('2026-11-16T16:00:00Z');
beforeEach(() => { s.rows = [{ id: 9, mid: 'gm9', sent_at: '2026-11-16T15:50:00Z', task_id: 'i9' }]; s.updates = []; s.status = []; s.won = true; });

describe('DEF-491 a rule forward that bounces', () => {
  it('a bounce → state bounced, the task cancelled', async () => {
    expect(await bounceSweep('T', 2, now, { bounceFor: async () => 'bounced' })).toBe(1);
    expect(s.updates[0]).toEqual({ id: 9, patch: { state: 'bounced', bounced_at: now.toISOString() } });
    expect(s.status[0].slice(0, 3)).toEqual(['i9', 'T', 'CANCELLED']);
  });
  it('no bounce, or Gmail unreadable → nothing changes (asked again next tick)', async () => {
    expect(await bounceSweep('T', 2, now, { bounceFor: async () => 'none' })).toBe(0);
    expect(await bounceSweep('T', 2, now, { bounceFor: async () => 'unknown' })).toBe(0);
    expect(s.updates).toHaveLength(0);
  });
  it('a row another tick already moved is not cancelled twice', async () => {
    s.won = false;
    expect(await bounceSweep('T', 2, now, { bounceFor: async () => 'bounced' })).toBe(0);
    expect(s.status).toHaveLength(0);
  });
  it('the window is 30 minutes', () => { expect(BOUNCE_WINDOW_MS).toBe(30 * 60_000); });
});
