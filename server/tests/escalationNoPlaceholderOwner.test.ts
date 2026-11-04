/** Held item 8(b): an escalation names the real owner, or says none is recorded. Never a placeholder. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/prisma', () => ({ default: {} }));

import { escalationQuestion } from '../src/jobs/actionLifecycleWorker';

const state: any = { unansweredAttempts: 3, commitmentHistory: [], currentDelayReason: null };

describe('an escalation', () => {
  it('names the owner when there is one', () => {
    const q = escalationQuestion({ title: 'Plan', delegateeName: 'Sara' }, state, 'no reply');
    expect(q).toContain('Owner: Sara.');
    expect(q).toContain('contact Sara directly');
  });
  it('falls to the email, then says no owner is recorded; an empty name is not a name', () => {
    expect(escalationQuestion({ title: 'Plan', delegateeName: '', delegateeEmail: 's@x.co' }, state, 'r')).toContain('Owner: s@x.co.');
    const q = escalationQuestion({ title: 'Plan', delegateeName: null }, state, 'r');
    expect(q).toContain('No owner is recorded');
    expect(q).not.toContain('the responsible person');
    expect(q).not.toContain('null');
  });
});
