/**
 * Third review item 2: "nothing that needs a rule check runs by itself while rules are unavailable". Before this, the
 * auto-executor's veto check swallowed a read failure and went on to execute: an unreadable "ask me first" rule was
 * treated as no rule. Pinned: when the veto check cannot read the rules, the executor does not execute.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/prisma', () => ({ default: {} }));
vi.mock('../src/services/knowledge/instructionMatcher', () => ({
  findVetoForEvent: async () => { throw new Error('standing instructions could not be read: connection refused'); },
}));

import { executeIfMatched } from '../src/services/triage/autonomousExecutor';

describe('the executor holds when rules cannot be read', () => {
  it('does not execute, and says why', async () => {
    const r = await executeIfMatched({
      id: 'fe1', clientNumber: 'T', userId: 2, sourceType: 'gmail', senderEmail: 'a@x.com', senderName: 'A',
      rawPayload: { subject: 'Invoice', snippet: 'please pay', from: 'A <a@x.com>' }, createdAt: new Date(),
    } as any);
    expect(r).toMatchObject({ executed: false });
    expect(String(r?.reason)).toMatch(/^rules_unavailable:/);
  });
});
