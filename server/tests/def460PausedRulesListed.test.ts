/**
 * DEF-460 (found by the Wiki session 13 Nov, Rules.md §2.4): a paused standing instruction vanished from My Rules,
 * so it could never be resumed. Pinned: Brain's read is active only; My Rules' read (includePaused) is active and
 * paused, and carries each row's status so the page shows Resume.
 */
import { describe, it, expect, vi } from 'vitest';

const query = vi.fn(async () => [] as any[]);
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: (...a: any[]) => (query as any)(...a) } }));

import { getActiveInstructions } from '../src/services/knowledge/instructionService';

describe('paused rules on My Rules', () => {
  it('Brain reads active only; My Rules reads active and paused, with the status', async () => {
    await getActiveInstructions('T', 2);
    expect((query.mock.calls[0] as any[])[4]).toEqual(['active']);
    await getActiveInstructions('T', 2, { includePaused: true });
    const [sql, , , , statuses] = query.mock.calls[1] as any[];
    expect(statuses).toEqual(['active', 'paused']);
    expect(sql).toMatch(/metadata->>'status' AS status/);
    expect(sql).toMatch(/metadata->>'status' = ANY\(\$4::text\[\]\)/);
  });
});
