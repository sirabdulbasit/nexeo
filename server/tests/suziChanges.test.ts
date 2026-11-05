/**
 * Link T12, P6. Pinned: the answer lists only what changed and carries no content; a cursor it can't trust gets everything; every
 * read is this tenant and this user; a failure reaches the route rather than reading as "nothing changed".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: (...a: any[]) => query(...a) } }));
const rules = vi.fn(async () => ({}));
vi.mock('../src/services/suzi/suziRules', () => ({ rulesDocument: (...a: any[]) => (rules as any)(...a) }));

import { changesSince } from '../src/services/suzi/suziChanges';

const now = new Date('2026-11-05T08:00:00.000Z');
const none = { actions: false, calendar: false, emails: false, rules: false, people: false };

beforeEach(() => { query.mockReset(); rules.mockClear(); });

describe('the changes feed', () => {
  it('lists what changed, and a new cursor', async () => {
    query.mockResolvedValue([{ ...none, actions: true, emails: true }]);
    expect(await changesSince('TMC-0001', 2, '2026-11-05T07:45:00.000Z', now)).toEqual({ cursor: '2026-11-05T08:00:00.000Z', changed: ['actions', 'emails'] });
  });
  it('nothing changed is an empty list', async () => {
    query.mockResolvedValue([none]);
    expect(await changesSince('T', 2, '2026-11-05T07:45:00.000Z', now)).toEqual({ cursor: now.toISOString(), changed: [] });
  });
  it('a cursor older than 7 days, unreadable, missing or in the future gets everything', async () => {
    for (const bad of ['2026-10-01T00:00:00Z', 'yesterday', undefined, '2026-11-06T00:00:00Z']) {
      expect(await changesSince('T', 2, bad, now)).toEqual({ cursor: now.toISOString(), full: true });
    }
    expect(query).not.toHaveBeenCalled();
  });
  it('every part reads this tenant and this user', async () => {
    query.mockResolvedValue([none]);
    await changesSince('TMC-0001', 2, '2026-11-05T07:45:00.000Z', now);
    const [sql, ...args] = query.mock.calls[0];
    expect(args.slice(0, 2)).toEqual(['TMC-0001', 2]);
    expect(sql.match(/client_number = \$1 AND user_id = \$2/g)).toHaveLength(6);
    expect(rules).toHaveBeenCalledWith('TMC-0001', 2);
  });
  it('a failed read fails, and never says nothing changed', async () => {
    query.mockRejectedValue(new Error('db down'));
    await expect(changesSince('T', 2, '2026-11-05T07:45:00.000Z', now)).rejects.toThrow('db down');
  });
});
