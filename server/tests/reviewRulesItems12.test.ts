/**
 * Third outside review, items 1 and 2 (owner approved 13 Nov 2026 13:44 PKT, Rules.md §11, Wiki-Knowledge §0.11).
 *  ITEM 1  an instruction and its email rule change in ONE transaction: pause/resume/archive from the instruction
 *          (rule.remove from the email rule is pinned in f2SuziEmailRules.test.ts); a failed write changes neither;
 *  ITEM 2  one governed read: every reader gets every rule (31+ reach the reader, no 30/50/100); a database error is
 *          RulesUnavailable, never an empty list; the auto-executor HOLDS when its veto check cannot read the rules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let rowsOut: any[] = [];
let readFails = false;
const query = vi.fn(async () => { if (readFails) throw new Error('connection refused'); return rowsOut; });
const pageUpdate = vi.fn((a: any) => ({ op: 'page', a }));
const exec = vi.fn((...a: any[]) => ({ op: 'rule', a }));
const tx = vi.fn(async (ops: any[]) => ops);
vi.mock('../src/db/prisma', () => ({
  default: {
    $queryRawUnsafe: (...a: any[]) => (query as any)(...a),
    $executeRawUnsafe: (...a: any[]) => (exec as any)(...a),
    $transaction: (...a: any[]) => (tx as any)(...a),
    wikiPage: {
      findFirst: async () => ({ id: 'ins_9', userId: 2, metadata: { scope: 'user', status: 'active' } }),
      update: (a: any) => (pageUpdate as any)(a),
    },
  },
}));
vi.mock('../src/utils/redisClient', () => ({ invalidate: async () => {} }));

import { updateInstructionStatus, getActiveInstructions, RulesUnavailable, RULES_READ_CEILING } from '../src/services/knowledge/instructionService';

beforeEach(() => { rowsOut = []; readFails = false; query.mockClear(); pageUpdate.mockClear(); exec.mockClear(); tx.mockClear(); });

describe('item 1: one transaction', () => {
  it.each([['paused', false], ['active', true], ['archived', false]] as const)('%s: the instruction and its email rule in ONE $transaction', async (status, ruleOn) => {
    expect(await updateInstructionStatus('T', 2, 'ins_9', status)).toEqual({ ok: true });
    expect(tx).toHaveBeenCalledTimes(1);
    const ops = (tx.mock.calls[0] as any[])[0];
    expect(ops.map((o: any) => o.op)).toEqual(['page', 'rule']);
    expect(ops[0].a.data.metadata.status).toBe(status);
    expect(ops[1].a[0]).toMatch(/UPDATE user_action_rules SET is_active = \$4/);
    expect(ops[1].a.slice(1)).toEqual(['T', 2, 'ins_9', ruleOn]);
  });
  it('a failed transaction is reported and changes neither (nothing is written outside it)', async () => {
    tx.mockRejectedValueOnce(new Error('db down'));
    expect(await updateInstructionStatus('T', 2, 'ins_9', 'paused')).toMatchObject({ ok: false });
    // The only writes are the two queued inside the transaction; neither ran on its own.
    expect(tx).toHaveBeenCalledTimes(1);
  });
});

describe('item 2: one governed read', () => {
  it('every reader gets every rule: 31+ come back, no per-reader limit', async () => {
    rowsOut = Array.from({ length: 31 }, (_, i) => ({ id: `ins_${i}`, title: `rule ${i}`, scope: i % 2 ? 'client' : 'user' }));
    const rows = await getActiveInstructions('T', 2);
    expect(rows).toHaveLength(31);
    expect((query.mock.calls[0] as any[])[3]).toBe(RULES_READ_CEILING);
    expect(RULES_READ_CEILING).toBeGreaterThanOrEqual(1000);
  });
  it('a database error is "could not be read", never an empty list', async () => {
    readFails = true;
    await expect(getActiveInstructions('T', 2)).rejects.toBeInstanceOf(RulesUnavailable);
  });
});
