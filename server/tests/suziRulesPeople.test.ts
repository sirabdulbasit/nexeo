/**
 * Link T12, P1 to P3. Pinned:
 *  1. rules have the agreed shape, defaults, and a stable order;
 *  2. the version SQL moves the number only when the hash changes; a stale number on `act` returns the
 *     current one, and a failed lookup returns nothing rather than touching the decided operation;
 *  3. rules and people are read only for this tenant and this user (delegations are the tenant's);
 *  4. people have no empty fields, at most 5 search results, and an empty question reads nothing;
 *  5. the pack carries these behind one switch, and a failed part stays out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: (...a: any[]) => query(...a) } }));
const instructions = vi.fn();
vi.mock('../src/services/knowledge/instructionService', () => ({ getActiveInstructions: (...a: any[]) => instructions(...a) }));
vi.mock('../src/services/suzi/suziKnowledge', () => ({
  queryTerms: (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean),
}));

import { newerRulesVersion, rulesContent, rulesDocument, rulesMarkdown } from '../src/services/suzi/suziRules';
import { displayName, MAX_RESULTS, recentPeople, searchPeople } from '../src/services/suzi/suziPeople';
import { PHASE2_IN_PACK, phase2Fields } from '../src/services/suzi/dayPack';

function db(o: { bc?: any; delegations?: any[]; actionRules?: any[]; version?: number } = {}) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM persons')) return [];
    if (sql.includes('FROM users')) return [{ bc: o.bc ?? null }];
    if (sql.includes('FROM delegation_matrix')) return o.delegations ?? [];
    if (sql.includes('FROM user_action_rules')) return o.actionRules ?? [];
    if (sql.includes('INSERT INTO suzi_rules_version')) return [{ version: o.version ?? 1 }];
    return [];
  });
}

beforeEach(() => { query.mockReset(); instructions.mockReset(); instructions.mockResolvedValue([]); });

describe('the rules document', () => {
  it('has the agreed shape; with nothing set, it gives the charter defaults and empty lists', async () => {
    db();
    expect(await rulesContent('T', 2)).toEqual({
      quiet_hours: { start: '22:00', end: '08:00' }, language: 'en', delegations: [], action_rules: [], standing: [],
    });
  });
  it('maps what is set, and sorts standing instructions so the same set gives the same version', async () => {
    db({
      bc: { quietStart: '23:00', quietEnd: '07:00', replyLanguage: 'urdu' },
      delegations: [{ area: 'Finance', owner_name: 'A', owner_email: 'a@x', escalate_to_name: 'B' }],
      actionRules: [{ id: 'r1', name: 'Name', nl_original: null, mode: 'suggest', scope: 'user' }],
    });
    instructions.mockResolvedValue([{ id: 'z', title: 'Z title', originalText: null }, { id: 'a', title: 'A title', originalText: 'A words' }]);
    const r = await rulesContent('T', 2);
    expect(r.quiet_hours).toEqual({ start: '23:00', end: '07:00' });
    expect(r.language).toBe('ur');
    expect(r.delegations).toEqual([{ area: 'Finance', owner: 'A', owner_email: 'a@x', escalate_to: 'B' }]);
    expect(r.action_rules).toEqual([{ id: 'r1', name: 'Name', text: 'Name', mode: 'suggest', scope: 'user' }]);
    expect(r.standing).toEqual([{ id: 'a', text: 'A words' }, { id: 'z', text: 'Z title' }]);
    const md = rulesMarkdown(r);
    for (const t of ['23:00 to 07:00', 'Finance: A, escalates to B', 'Name (suggest)', 'A words']) expect(md).toContain(t);
  });
  it('leaves out empty sections in the Markdown', () => {
    const md = rulesMarkdown({ quiet_hours: { start: '22:00', end: '08:00' }, language: 'en', delegations: [], action_rules: [], standing: [] });
    expect(md).not.toContain('##');
  });
  it('reads rules for this tenant and this user only; delegations for this tenant', async () => {
    db();
    await rulesContent('TMC-0001', 2);
    const call = (t: string) => query.mock.calls.find((c) => c[0].includes(t))!;
    expect(call('FROM users').slice(1)).toEqual([2, 'TMC-0001']);
    expect(call('FROM user_action_rules').slice(1)).toEqual(['TMC-0001', 2]);
    expect(call('FROM delegation_matrix').slice(1)).toEqual(['TMC-0001']);
    expect(instructions).toHaveBeenCalledWith('TMC-0001', 2);
  });
});

describe('the version', () => {
  it('moves only when the hash changes', async () => {
    db({ version: 4 });
    const doc = await rulesDocument('T', 2);
    expect(doc.rules_version).toBe(4);
    const sql = query.mock.calls.find((c) => c[0].includes('INSERT INTO suzi_rules_version'))![0];
    expect(sql).toMatch(/version \+ CASE WHEN suzi_rules_version\.content_hash = EXCLUDED\.content_hash THEN 0 ELSE 1 END/);
  });
  it('the same content gives the same hash; different content a different one', async () => {
    const hashes: string[] = [];
    const run = async (bc: any) => {
      db({ bc });
      await rulesDocument('T', 2);
      hashes.push(query.mock.calls.find((c) => c[0].includes('INSERT INTO suzi_rules_version'))![3]);
      query.mockClear();
    };
    await run({ quietStart: '22:00' }); await run({ quietStart: '22:00' }); await run({ quietStart: '21:00' });
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[0]).not.toBe(hashes[2]);
  });
  it('on act: a stale number gets the current one; a current or absent one gets nothing', async () => {
    db({ version: 5 });
    expect(await newerRulesVersion('T', 2, 3)).toBe(5);
    expect(await newerRulesVersion('T', 2, 5)).toBeUndefined();
    query.mockClear();
    expect(await newerRulesVersion('T', 2, undefined)).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });
  it('on act: a failed lookup gives nothing, so it can never change the decided operation', async () => {
    query.mockRejectedValue(new Error('db down'));
    expect(await newerRulesVersion('T', 2, 3)).toBeUndefined();
  });
});

describe('people', () => {
  it('search: the user\'s own people only, at most 5, no empty fields', async () => {
    query.mockResolvedValue([{ id: 'p1', name: 'Rafay', email: 'r@x', phone: null }, { id: 'p2', name: 'Rafi', email: null, phone: '+92' }]);
    const r = await searchPeople('TMC-0001', 2, 'rafy');
    expect(r).toEqual([{ id: 'p1', name: 'Rafay', email: 'r@x' }, { id: 'p2', name: 'Rafi', phone: '+92' }]);
    const [sql, ...args] = query.mock.calls[0];
    expect(sql).toContain('p.client_number = $1 AND p.user_id = $2');
    expect(sql).toContain(`LIMIT ${MAX_RESULTS}`);
    expect(args).toEqual(['TMC-0001', 2, 'rafy', ['%rafy%'], ['rafy']]);
  });
  it('search: an empty question reads nothing', async () => {
    expect(await searchPeople('T', 2, '   ')).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
  it('recent: the user\'s own people, most recent first, automated senders left out', async () => {
    query.mockResolvedValue([{ id: 'p1', name: 'A', email: 'a@x', phone: null }]);
    expect(await recentPeople('TMC-0001', 2)).toEqual([{ id: 'p1', name: 'A', email: 'a@x' }]);
    const [sql, ...args] = query.mock.calls[0];
    expect(args).toEqual(['TMC-0001', 2, 100]);
    expect(sql).toContain('p.client_number = $1 AND p.user_id = $2');
    expect(sql).toContain('client_number = $1 AND user_id = $2 AND sender_email IS NOT NULL');
    expect(sql).toMatch(/ORDER BY max\(r\.at\) DESC NULLS LAST/);
    expect(sql).toContain('no-?reply');
  });
});

describe('names', () => {
  it('a name that is an address reads as a name; a real name is untouched', () => {
    expect(displayName('numair.mazhar@tmcltd.ai')).toBe('Numair Mazhar');
    expect(displayName('Guru Gaonkar')).toBe('Guru Gaonkar');
  });
  it('recent people leave out the user themself', async () => {
    query.mockResolvedValue([]);
    await recentPeople('T', 2);
    expect(query.mock.calls[0][0]).toContain('IS DISTINCT FROM (SELECT lower(email) FROM users WHERE id = $2)');
  });
});

describe('the pack', () => {
  it('carries it: approved by the founder, 5 Nov', () => {
    expect(PHASE2_IN_PACK).toBe(true);
  });
  it('with the switch on, the fields are there', async () => {
    db({ version: 2 });
    const f = await phase2Fields('T', 2);
    expect(Object.keys(f).sort()).toEqual(['people', 'rules', 'rules_md', 'rules_version']);
  });
  it('a part that can\'t be read stays out, and the rest still comes', async () => {
    db();
    const real = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, ...a: any[]) => {
      if (sql.includes('INSERT INTO suzi_rules_version')) throw new Error('no table');
      return real(sql, ...a);
    });
    const f = await phase2Fields('T', 2);
    expect(f.rules).toBeUndefined();
    expect(f.rules_version).toBeUndefined();
    expect(f.people).toEqual([]);
  });
});
