/**
 * D-323 (T47): proposals on tasks not in actions[] (watched: he asked someone else) go to pack.proposals[]. Pinned:
 *  LEVEL   a task already in actions[] is not repeated; a watched task's proposal carries task {id, title, watching}.
 *  ORDER   newest first; handled proposals stay out.
 */
import { describe, it, expect, vi } from 'vitest';

const rows = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: async () => rows.list } }));
import { packLevelProposals } from '../src/services/suzi/proposals';

const P = (id: string, at: string, state?: string) => ({ id, change: 'done', value: null, why: `w${id}`, from: { email_id: 'm', direction: 'in' }, at, ...(state ? { state } : {}) });

describe('D-323 pack.proposals', () => {
  it('LEVEL and ORDER', async () => {
    rows.list = [
      { id: 'mine', title: 'In actions', status: 'NEW', metadata: { proposals: [P('a', '2026-11-25T09:00:00Z')] } },
      { id: 'w1', title: 'Create a group', status: 'NEW', metadata: { watch: { person: 'Aziz Masood' }, proposals: [P('b', '2026-11-25T08:00:00Z')] } },
      { id: 'w2', title: 'Confirm Meet', status: 'NEW', metadata: { watch: { email: 'support@x.com' }, proposals: [P('c', '2026-11-25T10:00:00Z'), P('d', '2026-11-25T11:00:00Z', 'dismissed')] } },
    ];
    const out = await packLevelProposals('T', 2, new Set(['mine']));
    expect(out.map((p) => p.id)).toEqual(['c', 'b']);
    expect(out[1]).toMatchObject({ op: 'task.update', args: { id: 'w1', update: 'done', proposal_id: 'b' }, task: { id: 'w1', title: 'Create a group', watching: 'Aziz Masood' } });
    expect(out[0].task.watching).toBe('support@x.com');
    expect((out[0] as any).at).toBeUndefined();
  });
});
