/**
 * Link T14: one name, Nexeo's profile the record. T11, N4: what nudges-off holds back, read on request. Pinned:
 * the default, the old "Brain" default isn't a name, a bad name changes nothing, tenant and user scope, and that
 * reading held items writes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const exec = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: (...a: any[]) => query(...a), $executeRawUnsafe: (...a: any[]) => exec(...a) } }));

import { getAssistantName, heldItems, setAssistantName } from '../src/services/suzi/suziProfile';

beforeEach(() => { query.mockReset(); exec.mockReset(); });

describe('the name', () => {
  it('reads the profile, for this tenant and user', async () => {
    query.mockResolvedValue([{ name: ' Maya ' }]);
    expect(await getAssistantName('TMC-0001', 2)).toBe('Maya');
    expect(query.mock.calls[0].slice(1)).toEqual([2, 'TMC-0001']);
  });
  it('with nothing set, or the old default, it is Suzi', async () => {
    query.mockResolvedValue([{ name: null }]);
    expect(await getAssistantName('T', 2)).toBe('Suzi');
    query.mockResolvedValue([{ name: 'Brain' }]);
    expect(await getAssistantName('T', 2)).toBe('Suzi');
  });
  it('a rename is written for this tenant and user, in any script', async () => {
    expect(await setAssistantName('TMC-0001', 2, 'سوزی')).toBe(true);
    expect(exec.mock.calls[0].slice(1)).toEqual(['سوزی', 2, 'TMC-0001']);
  });
  it('what isn\'t a name changes nothing', async () => {
    for (const bad of ['', '   ', 123, null, 'x'.repeat(41), 'a; DROP TABLE users', '<b>x</b>']) {
      expect(await setAssistantName('T', 2, bad)).toBe(false);
    }
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('held items', () => {
  it('the urgent ones, held or shown only silently, for this user, and nothing is written', async () => {
    query.mockResolvedValue([{ id: '7', kind: 'k', summary: 's', urgency: 'high', created_at: new Date('2026-11-05T05:00:00Z') }]);
    expect(await heldItems('TMC-0001', 2)).toEqual([{ id: '7', kind: 'k', summary: 's', urgency: 'high', at: '2026-11-05T05:00:00.000Z' }]);
    const [sql, ...args] = query.mock.calls[0];
    expect(args).toEqual(['TMC-0001', 2]);
    expect(sql).toContain("urgency IN ('high', 'emergency')");
    expect(sql).toContain("state = 'held' OR delivered_how IN ('notice', 'whatsapp', 'email')");
    expect(sql).toContain('LIMIT 20');
    expect(exec).not.toHaveBeenCalled();
  });
});
