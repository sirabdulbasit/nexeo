/**
 * Wiki marks — what is known about a source beyond its text (docs/Wiki-Knowledge.md §0.12.1).
 *
 * Against an in-memory stand-in for `wiki_sources` and `wiki_source_marks`:
 *  1. a mark is set on the writer's own source, and read back by that user;
 *  2. the same value again changes nothing;
 *  3. a new value supersedes the earlier mark and keeps it as history;
 *  4. two rules on one email are two current marks, told apart by key;
 *  5. clearing a mark takes it off and keeps it in the history;
 *  6. a source of another user or another client cannot be marked;
 *  7. one user's mark on a shared source is never read by another user;
 *  8. a malformed mark is refused before anything is written.
 * The window listing and the unmarked count are SQL and are exercised on the real database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const t = vi.hoisted(() => ({ sources: [] as any[], marks: [] as any[], seq: 0, clock: 0 }));

vi.mock('../src/db/prisma', () => {
  const current = (sourceId: string, client: string, user: number, kind: string, key: string) =>
    t.marks.filter((m) => m.source_id === sourceId && m.client_number === client && m.user_id === user && m.kind === kind && m.mark_key === key && !m.superseded_at);
  const p: any = {
    $transaction: async (fn: any) => fn(p),
    $queryRawUnsafe: async (sql: string, ...a: any[]) => {
      if (/FROM wiki_sources WHERE id = \$1/.test(sql)) {
        return t.sources.filter((s) => s.id === a[0] && s.client_number === a[1] && (s.scope === 'tenant' || s.user_id === a[2]));
      }
      if (/FOR UPDATE/.test(sql)) return current(a[0], a[1], a[2], a[3], a[4]);
      if (/FROM wiki_source_marks/.test(sql) && /ANY\(\$3::text\[\]\)/.test(sql)) {
        return t.marks.filter((m) => m.client_number === a[0] && m.user_id === a[1] && (a[2] as string[]).includes(m.source_id) && !m.superseded_at);
      }
      if (/FROM wiki_source_marks/.test(sql) && /source_id = \$3/.test(sql)) {
        return t.marks.filter((m) => m.client_number === a[0] && m.user_id === a[1] && m.source_id === a[2]);
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    $executeRawUnsafe: async (sql: string, ...a: any[]) => {
      if (/UPDATE wiki_source_marks SET superseded_at/.test(sql)) {
        t.marks.find((m) => m.id === a[0]).superseded_at = new Date(++t.clock);
        return 1;
      }
      if (/INSERT INTO wiki_source_marks/.test(sql)) {
        t.marks.push({ id: ++t.seq, source_id: a[0], client_number: a[1], user_id: a[2], kind: a[3], mark_key: a[4], value: JSON.parse(a[5]), set_by: a[6], set_at: new Date(++t.clock), superseded_at: null });
        return 1;
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
  return { __esModule: true, default: p, prisma: p };
});

import { markSource, clearMark, marksOf, markHistory, MarkRefused, sameValue } from '../src/services/wiki/wikiMarks';

const me = { clientNumber: 'T-1', userId: 1 };
const colleague = { clientNumber: 'T-1', userId: 2 };
const needsYou = { class: 'needs_you', why: 'He is asked to approve the quote' };

beforeEach(() => {
  t.sources = [
    { id: 's-mine', client_number: 'T-1', user_id: 1, scope: 'user' },
    { id: 's-theirs', client_number: 'T-1', user_id: 2, scope: 'user' },
    { id: 's-company', client_number: 'T-1', user_id: 2, scope: 'tenant' },
    { id: 's-other-client', client_number: 'T-2', user_id: 1, scope: 'tenant' },
  ];
  t.marks = []; t.seq = 0; t.clock = 0;
});

describe('wiki marks', () => {
  it('1. a mark is set on the writer\'s own source and read back by that user', async () => {
    expect(await markSource(me, 's-mine', { kind: 'attention', value: needsYou, by: 'triage:v2' })).toEqual({ changed: true });
    const marks = (await marksOf('T-1', 1, ['s-mine'])).get('s-mine')!;
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ kind: 'attention', key: '', value: needsYou, setBy: 'triage:v2', supersededAt: null });
  });

  it('2. the same value again changes nothing, whatever the order of its keys', async () => {
    await markSource(me, 's-mine', { kind: 'attention', value: needsYou, by: 'triage:v2' });
    expect(await markSource(me, 's-mine', { kind: 'attention', value: { why: needsYou.why, class: 'needs_you' }, by: 'triage:v2' })).toEqual({ changed: false });
    expect(t.marks).toHaveLength(1);
  });

  it('3. a new value supersedes the earlier mark and keeps it as history', async () => {
    await markSource(me, 's-mine', { kind: 'attention', value: needsYou, by: 'triage:v2' });
    await markSource(me, 's-mine', { kind: 'attention', value: { class: 'brief' }, by: 'triage:v2' });
    const now = (await marksOf('T-1', 1, ['s-mine'])).get('s-mine')!;
    expect(now.map((m) => m.value.class)).toEqual(['brief']);
    const history = await markHistory('T-1', 1, 's-mine');
    expect(history.map((m) => m.value.class)).toEqual(['needs_you', 'brief']);
    expect(history[0].supersededAt).not.toBeNull();
    expect(history[1].supersededAt).toBeNull();
  });

  it('4. two rules on one email are two current marks, told apart by key', async () => {
    await markSource(me, 's-mine', { kind: 'rule', key: 'rule-7', value: { action: 'ignore' }, by: 'rule:rule-7' });
    await markSource(me, 's-mine', { kind: 'rule', key: 'rule-9', value: { action: 'delegate', person_id: 'p1' }, by: 'rule:rule-9' });
    const marks = (await marksOf('T-1', 1, ['s-mine'])).get('s-mine')!;
    expect(marks.map((m) => m.key).sort()).toEqual(['rule-7', 'rule-9']);
  });

  it('5. clearing a mark takes it off and keeps it in the history', async () => {
    await markSource(me, 's-mine', { kind: 'rule', key: 'rule-7', value: { action: 'ignore' }, by: 'rule:rule-7' });
    expect(await clearMark(me, 's-mine', 'rule', 'rule-7')).toEqual({ changed: true });
    expect(await clearMark(me, 's-mine', 'rule', 'rule-7')).toEqual({ changed: false });
    expect((await marksOf('T-1', 1, ['s-mine'])).get('s-mine')).toBeUndefined();
    expect(await markHistory('T-1', 1, 's-mine')).toHaveLength(1);
  });

  it('6. a source of another user or another client cannot be marked', async () => {
    await expect(markSource(me, 's-theirs', { kind: 'attention', value: needsYou, by: 'triage:v2' })).rejects.toBeInstanceOf(MarkRefused);
    await expect(markSource(me, 's-other-client', { kind: 'attention', value: needsYou, by: 'triage:v2' })).rejects.toBeInstanceOf(MarkRefused);
    await expect(clearMark(me, 's-theirs', 'attention')).rejects.toBeInstanceOf(MarkRefused);
    expect(t.marks).toEqual([]);
  });

  it('7. one user\'s mark on a shared source is never read by another user', async () => {
    await markSource(me, 's-company', { kind: 'attention', value: needsYou, by: 'triage:v2' });
    await markSource(colleague, 's-company', { kind: 'attention', value: { class: 'brief' }, by: 'triage:v2' });
    expect((await marksOf('T-1', 1, ['s-company'])).get('s-company')!.map((m) => m.value.class)).toEqual(['needs_you']);
    expect((await marksOf('T-1', 2, ['s-company'])).get('s-company')!.map((m) => m.value.class)).toEqual(['brief']);
    expect((await marksOf('T-2', 1, ['s-company'])).size).toBe(0);
    expect(await markHistory('T-1', 2, 's-company')).toHaveLength(1);
  });

  it('8. a malformed mark is refused before anything is written', async () => {
    await expect(markSource(me, 's-mine', { kind: 'mood' as any, value: {}, by: 'x' })).rejects.toBeInstanceOf(MarkRefused);
    await expect(markSource(me, 's-mine', { kind: 'attention', value: needsYou, by: '  ' })).rejects.toBeInstanceOf(MarkRefused);
    await expect(markSource(me, 's-mine', { kind: 'attention', value: null as any, by: 'triage:v2' })).rejects.toBeInstanceOf(MarkRefused);
    await expect(markSource(me, 's-mine', { kind: 'rule', key: 'k'.repeat(201), value: {}, by: 'rule:x' })).rejects.toBeInstanceOf(MarkRefused);
    expect(t.marks).toEqual([]);
  });

  it('sameValue compares content, not key order', () => {
    expect(sameValue({ a: 1, b: { c: [1, 2], d: 2 } }, { b: { d: 2, c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameValue({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});
