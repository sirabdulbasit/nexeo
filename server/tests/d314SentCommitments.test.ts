/**
 * D-314 (T46): his sent mail becomes actions. Pinned:
 *  PARSE  only well-formed commitments survive; bad dates, kinds and addresses are dropped, never guessed.
 *  KEY    one commitment = one task: same thread + same words (case/punctuation ignored) → same key.
 *  RUN    "mine" → his task; "asked" → a watched task with that person; a repeat is skipped; each email marked read once;
 *         a model failure leaves the email unchecked for the next run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ rows: [] as any[], keys: new Set<string>(), marked: [] as string[], created: [] as any[] }));
vi.mock('../src/db/prisma', () => ({ default: {
  $queryRawUnsafe: async (sql: string, ...a: any[]) => sql.includes('FROM wiki_sources') ? db.rows : (db.keys.has(a[2]) ? [{ id: 'x' }] : []),
  $executeRawUnsafe: async (_sql: string, id: string) => { db.marked.push(id); return 1; },
} }));
vi.mock('../src/services/openItemsService', () => ({ createItem: async (_u: number, _c: string, inp: any) => { db.created.push(inp); db.keys.add(inp.metadata.sentCommitmentKey); return { id: `i${db.created.length}` }; } }));

import { parseCommitments, commitmentKey, runSentCommitments } from '../src/services/suzi/sentCommitments';

const row = { id: 'w1', external_id: 'g1', thread_key: 't1', title: 'Proposal', to_raw: 'Ali <ali@x.com>', body_text: 'I will send the proposal by Friday. Ali, please share the report by Monday.', occurred_at: new Date('2026-11-24T10:00:00Z') };
const answer = JSON.stringify({ commitments: [
  { kind: 'mine', text: 'Send the proposal', due: '2026-11-28', person_email: null, person_name: null },
  { kind: 'asked', text: 'Share the report', due: '2026-12-01', person_email: 'Ali@x.com', person_name: 'Ali' },
] });

describe('D-314 sent commitments', () => {
  beforeEach(() => { db.rows = [row]; db.keys = new Set(); db.marked = []; db.created = []; });
  it('PARSE: drops bad kinds, dates and addresses', () => {
    const c = parseCommitments('noise ' + JSON.stringify({ commitments: [
      { kind: 'maybe', text: 'x x x x' },
      { kind: 'mine', text: 'Call the bank', due: 'Friday', person_email: 'not-an-email' },
    ] }));
    expect(c).toEqual([{ kind: 'mine', text: 'Call the bank', due: null, person_email: null, person_name: null }]);
    expect(parseCommitments('not json')).toEqual([]);
  });
  it('KEY: same thread and words, same key; another thread, another key', () => {
    expect(commitmentKey('t1', { kind: 'mine', text: 'Send the proposal!' })).toBe(commitmentKey('t1', { kind: 'mine', text: 'send  the proposal' }));
    expect(commitmentKey('t2', { kind: 'mine', text: 'Send the proposal' })).not.toBe(commitmentKey('t1', { kind: 'mine', text: 'Send the proposal' }));
  });
  it('RUN: his task and a watched task, with source; the repeat is skipped', async () => {
    const r = await runSentCommitments('T', 2, async () => answer);
    expect(r).toEqual({ read: 1, created: 2, skipped: 0 });
    const [mine, asked] = db.created;
    expect(mine).toMatchObject({ title: 'Send the proposal', sourceFeed: 'gmail', sourceRef: 'g1', metadata: { fromSent: true, suziSource: { email_id: 'g1', thread_id: 't1', from_sent: true } } });
    expect(mine.metadata.watch).toBeUndefined();
    expect(mine.dueDate.toISOString().slice(0, 10)).toBe('2026-11-28');
    expect(asked.metadata.watch).toMatchObject({ person: 'Ali', email: 'ali@x.com' });
    expect(db.marked).toEqual(['w1']);
    const again = await runSentCommitments('T', 2, async () => answer);
    expect(again).toEqual({ read: 1, created: 0, skipped: 2 });
  });
  it('RUN: a model failure leaves the email unchecked', async () => {
    const r = await runSentCommitments('T', 2, async () => { throw new Error('down'); });
    expect(r.created).toBe(0);
    expect(db.marked).toEqual([]);
  });
});
