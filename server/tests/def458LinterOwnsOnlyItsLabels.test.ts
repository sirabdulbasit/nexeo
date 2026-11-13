/**
 * DEF-458 — the hourly wiki linter relabelled every row of `wiki_pages`.
 *
 * Observed on production, 13 Nov 2026: all 12 standing instructions carried
 * status 'orphan' or 'stale' while the user's own setting said active, so
 * `getActiveInstructions` (status = 'active') returned none and My Rules showed
 * "No standing instructions yet"; and not one page was left 'deleted' or
 * 'superseded' among 16,204.
 *
 * Criteria:
 *  1. a standing instruction (own lifecycle in metadata.status) is never relabelled;
 *  2. a deleted or retired page is never brought back;
 *  3. a note of the new wiki is never relabelled, and its counts are not overwritten;
 *  4. a draft is left alone (as before);
 *  5. an ordinary page is still labelled: orphan, stale, contradicted, active.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const t = vi.hoisted(() => ({ rows: [] as any[], updates: [] as Array<{ id: string; data: any }> }));

vi.mock('../src/db/prisma', () => {
  const p: any = {
    $queryRawUnsafe: async () => t.rows,
    wikiPage: { update: async ({ where, data }: any) => { t.updates.push({ id: where.id, data }); return {}; } },
  };
  return { __esModule: true, default: p, prisma: p };
});

import { lintAllWikiPages, linterOwns, lintLabel } from '../src/services/knowledge/wikiLinterService';

const fresh = new Date();
const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
const row = (id: string, over: Record<string, any> = {}) => ({
  id, status: 'active', own_lifecycle: false, is_note: false, last_updated_at: fresh,
  inbound_refs: 0, outbound_refs: 0, source_refs: 0, contradicts_refs: 0, ...over,
});
const statusOf = (id: string) => t.updates.find((u) => u.id === id)?.data.status;

beforeEach(() => { t.rows = []; t.updates = []; });

describe('DEF-458: the linter labels only the pages it owns', () => {
  it('1. a standing instruction with no links is not relabelled', async () => {
    t.rows = [row('instruction', { own_lifecycle: true })];
    const r = await lintAllWikiPages();
    expect(t.updates).toEqual([]);
    expect(r.not_owned).toBe(1);
    expect(r.marked_orphan).toBe(0);
  });

  it('2. a deleted page and a retired page are not brought back', async () => {
    t.rows = [row('deleted', { status: 'deleted', inbound_refs: 3 }), row('retired', { status: 'superseded', source_refs: 2 })];
    const r = await lintAllWikiPages();
    expect(t.updates).toEqual([]);
    expect(r.marked_active).toBe(0);
  });

  it('3. a note of the new wiki is not relabelled and its counts are not overwritten', async () => {
    t.rows = [row('note', { is_note: true }), row('old-note', { is_note: true, last_updated_at: old, inbound_refs: 1 })];
    await lintAllWikiPages();
    expect(t.updates).toEqual([]);
  });

  it('4. a draft is left alone', async () => {
    t.rows = [row('draft', { status: 'draft', inbound_refs: 1 })];
    await lintAllWikiPages();
    expect(t.updates).toEqual([]);
  });

  it('5. an ordinary page is still labelled', async () => {
    t.rows = [
      row('lonely'),
      row('aged', { inbound_refs: 1, last_updated_at: old }),
      row('disputed', { contradicts_refs: 1, inbound_refs: 1 }),
      row('back', { status: 'orphan', source_refs: 1 }),
    ];
    const r = await lintAllWikiPages();
    expect(statusOf('lonely')).toBe('orphan');
    expect(statusOf('aged')).toBe('stale');
    expect(statusOf('disputed')).toBe('contradicted');
    expect(statusOf('back')).toBe('active');
    expect(r).toMatchObject({ scanned: 4, not_owned: 0, marked_orphan: 1, marked_stale: 1, marked_contradicted: 1, marked_active: 1 });
  });

  it('the rule itself', () => {
    expect(linterOwns({ status: 'active', ownLifecycle: false, isNote: false })).toBe(true);
    expect(linterOwns({ status: 'stale', ownLifecycle: false, isNote: false })).toBe(true);
    expect(linterOwns({ status: 'active', ownLifecycle: true, isNote: false })).toBe(false);
    expect(linterOwns({ status: 'active', ownLifecycle: false, isNote: true })).toBe(false);
    expect(linterOwns({ status: 'deleted', ownLifecycle: false, isNote: false })).toBe(false);
    expect(linterOwns({ status: 'superseded', ownLifecycle: false, isNote: false })).toBe(false);
    expect(lintLabel({ inbound_refs: 0, outbound_refs: 0, source_refs: 0, contradicts_refs: 0, last_updated_at: fresh }, old)).toBe('orphan');
  });
});
