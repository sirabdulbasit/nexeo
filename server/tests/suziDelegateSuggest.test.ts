/**
 * Link T24 (both AGREE, 6 Nov 2026): who a task could go to. Pinned:
 *  1. only his own task: anyone else's is 404 not_found; a finished or cancelled one is 400 bad_state;
 *  2. person_id is always one of HIS contacts (what `task.update` assign takes), matched by email;
 *     whoever can't be matched is counted in `skipped`, never returned;
 *  3. rules first (the company table by whole word of the title; his per-type list), then his own past
 *     practice by count, then the most recent; at most 3, each person once; never him or the current delegate;
 *  4. past practice is HIS only (user_id in every read), and the reason never says "similar";
 *  5. any source that fails makes checked:false; nothing found is [] with checked:true;
 *  6. no model: the module imports no LLM, triage or criticality code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import path from 'path';

const query = vi.fn();
const itemFind = vi.fn();
const configFind = vi.fn();
const userFindFirst = vi.fn();
const userFindUnique = vi.fn();
vi.mock('../src/db/prisma', () => ({
  default: {
    $queryRawUnsafe: (...a: any[]) => query(...a),
    openItem: { findFirst: (...a: any[]) => itemFind(...a) },
    brainConfig: { findFirst: (...a: any[]) => configFind(...a) },
    user: { findFirst: (...a: any[]) => userFindFirst(...a), findUnique: (...a: any[]) => userFindUnique(...a) },
  },
}));
vi.mock('../src/services/suzi/gatewayAdminClient', () => ({ verifyGatewaySecret: async (t: any) => t === 'right-secret' }));

import { suggestDelegates, areaInTitle, pastReason } from '../src/services/suzi/delegateSuggest';
import router from '../src/routes/suziGatewayRoutes';

const AUG = new Date('2026-08-03T10:00:00Z');
const NOV = new Date('2026-11-03T10:00:00Z');
let matrix: any[]; let past: any[]; let contacts: any[];
let failOn: string | null;

function wire() {
  query.mockImplementation(async (sql: string, ...args: any[]) => {
    if (failOn && sql.includes(failOn)) throw new Error('db down');
    if (sql.includes('FROM delegation_matrix')) return matrix;
    if (sql.includes('WITH items AS')) return past;
    if (sql.includes('FROM person_facets')) return contacts.filter((c) => (args[2] as string[]).includes(c.email));
    return [];
  });
}

beforeEach(() => {
  for (const f of [query, itemFind, configFind, userFindFirst, userFindUnique]) f.mockReset();
  matrix = []; past = []; contacts = []; failOn = null;
  itemFind.mockResolvedValue({ title: 'Pay the vendor invoices for October', type: 'task', status: 'TRIAGED', delegateeEmail: null });
  configFind.mockResolvedValue({ delegationRules: [] });
  userFindFirst.mockResolvedValue({ email: 'me@x.com', integrationEmail: 'me@x.com' });
  userFindUnique.mockResolvedValue({ clientNumber: 'TMC-0001', isActive: true });
  wire();
});

describe('his own task only', () => {
  it('someone else\'s task is not found, scoped by tenant and user', async () => {
    itemFind.mockResolvedValue(null);
    expect(await suggestDelegates('T', 2, 'x')).toMatchObject({ ok: false, error: 'not_found' });
    expect(itemFind.mock.calls[0][0].where).toEqual({ id: 'x', clientNumber: 'T', userId: 2 });
    expect(query).not.toHaveBeenCalled();
  });
  it('a finished or cancelled task is bad_state, as assign is', async () => {
    for (const status of ['CLOSED', 'CANCELLED']) {
      itemFind.mockResolvedValue({ title: 't', type: 'task', status, delegateeEmail: null });
      expect(await suggestDelegates('T', 2, 'x')).toMatchObject({ ok: false, error: 'bad_state' });
    }
  });
});

describe('who is suggested', () => {
  it('a company rule whose area is in the title, as one of his contacts', async () => {
    matrix = [{ area: 'Vendor invoices', owner_email: 'Ali@X.com' }, { area: 'Payroll', owner_email: 'p@x.com' }];
    contacts = [{ email: 'ali@x.com', id: 'per_ali', name: 'Ali Raza' }];
    const r: any = await suggestDelegates('T', 2, 'x');
    expect(r).toMatchObject({ ok: true, checked: true, skipped: 0 });
    expect(r.suggestions).toEqual([{ person_id: 'per_ali', name: 'Ali Raza', email: 'ali@x.com', reason: 'Delegation rule: Vendor invoices', source: 'rule', rule: { kind: 'area', area: 'Vendor invoices' } }]);
  });
  it('his per-type routing list, on the task\'s type, delegate routes only', async () => {
    configFind.mockResolvedValue({ delegationRules: [
      { itemType: 'task', route: 'delegate', assigneeEmail: 'sara@x.com' },
      { itemType: 'task', route: 'escalate', assigneeEmail: 'boss@x.com' },
      { itemType: 'email', route: 'delegate', assigneeEmail: 'mail@x.com' },
    ] });
    contacts = [{ email: 'sara@x.com', id: 'per_sara', name: 'Sara' }, { email: 'boss@x.com', id: 'per_boss', name: 'Boss' }, { email: 'mail@x.com', id: 'per_mail', name: 'Mail' }];
    const r: any = await suggestDelegates('T', 2, 'x');
    expect(r.suggestions.map((s: any) => s.person_id)).toEqual(['per_sara']);
    expect(r.suggestions[0]).toMatchObject({ source: 'rule', rule: { kind: 'type', item_type: 'task' }, reason: 'Delegation rule for task items' });
  });
  it('past practice by count, then most recent; a rule comes first and carries his count', async () => {
    matrix = [{ area: 'vendor invoices', owner_email: 'ali@x.com' }];
    past = [
      { email: 'b@x.com', n: 2, first_at: AUG, last_at: NOV },
      { email: 'c@x.com', n: 5, first_at: AUG, last_at: AUG },
      { email: 'ali@x.com', n: 3, first_at: AUG, last_at: NOV },
      { email: 'd@x.com', n: 2, first_at: AUG, last_at: AUG },
    ];
    contacts = ['ali', 'b', 'c', 'd'].map((n) => ({ email: `${n}@x.com`, id: `per_${n}`, name: n }));
    const r: any = await suggestDelegates('T', 2, 'x');
    expect(r.suggestions.map((s: any) => s.person_id)).toEqual(['per_ali', 'per_c', 'per_b']);
    expect(r.suggestions[0]).toMatchObject({ source: 'rule', count: 3, last_at: NOV.toISOString() });
    expect(r.suggestions[1]).toMatchObject({ source: 'past_practice', count: 5, reason: "You've delegated to them 5 times since 3 Aug" });
  });
  it('never him, never the person it is already with', async () => {
    itemFind.mockResolvedValue({ title: 't', type: 'task', status: 'DELEGATED', delegateeEmail: 'Now@x.com' });
    past = [{ email: 'me@x.com', n: 9, first_at: AUG, last_at: NOV }, { email: 'now@x.com', n: 8, first_at: AUG, last_at: NOV }, { email: 'b@x.com', n: 1, first_at: NOV, last_at: NOV }];
    contacts = ['me', 'now', 'b'].map((n) => ({ email: `${n}@x.com`, id: `per_${n}`, name: n }));
    const r: any = await suggestDelegates('T', 2, 'x');
    expect(r.suggestions.map((s: any) => s.person_id)).toEqual(['per_b']);
  });
  it('at most three; someone not in his contacts is skipped, counted only when they would have been shown', async () => {
    past = ['a', 'ghost', 'b', 'c', 'd', 'ghost2'].map((n, i) => ({ email: `${n}@x.com`, n: 10 - i, first_at: AUG, last_at: NOV }));
    contacts = ['a', 'b', 'c', 'd'].map((n) => ({ email: `${n}@x.com`, id: `per_${n}`, name: n }));
    const r: any = await suggestDelegates('T', 2, 'x');
    expect(r.suggestions.map((s: any) => s.person_id)).toEqual(['per_a', 'per_b', 'per_c']);
    expect(r.skipped).toBe(1);
  });
  it('a rule with no email is skipped, not returned', async () => {
    matrix = [{ area: 'vendor invoices', owner_email: null }];
    const r: any = await suggestDelegates('T', 2, 'x');
    expect(r).toMatchObject({ suggestions: [], skipped: 1, checked: true });
  });
  it('one email on two of his contacts: the read picks deterministically (verified, then most recently seen)', async () => {
    past = [{ email: 'a@x.com', n: 1, first_at: NOV, last_at: NOV }];
    contacts = [{ email: 'a@x.com', id: 'per_a', name: 'a' }];
    await suggestDelegates('T', 2, 'x');
    const sql = query.mock.calls.find((c) => String(c[0]).includes('FROM person_facets'))![0];
    expect(sql).toContain('DISTINCT ON (lower(f.facet_value))');
    expect(sql).toContain('ORDER BY lower(f.facet_value), f.verified DESC, f.last_seen_at DESC NULLS LAST, p.id');
  });
  it('nothing on record: an empty list, checked', async () => {
    expect(await suggestDelegates('T', 2, 'x')).toEqual({ ok: true, suggestions: [], skipped: 0, checked: true });
  });
});

describe('his own data only', () => {
  it('every read is scoped to this tenant, and past practice and contacts to this user', async () => {
    past = [{ email: 'a@x.com', n: 1, first_at: NOV, last_at: NOV }];
    await suggestDelegates('TMC-0001', 2, 'x');
    const pastCall = query.mock.calls.find((c) => String(c[0]).includes('WITH items AS'))!;
    expect(pastCall.slice(1)).toEqual(['TMC-0001', 2]);
    expect(pastCall[0]).toContain('o.client_number = $1 AND o.user_id = $2');
    expect(pastCall[0]).toContain('l.client_number = $1 AND l.user_id = $2');
    const contactCall = query.mock.calls.find((c) => String(c[0]).includes('FROM person_facets'))!;
    expect(contactCall[0]).toContain('p.client_number = $1 AND p.user_id = $2');
    expect(configFind.mock.calls[0][0].where).toEqual({ userId: 2, clientNumber: 'TMC-0001' });
  });
  it('the reason never claims "similar"', () => {
    expect(pastReason({ n: 4, first_at: AUG, last_at: NOV })).toBe("You've delegated to them 4 times since 3 Aug");
    expect(pastReason({ n: 1, first_at: NOV, last_at: NOV })).toBe('You delegated to them once, on 3 Nov');
    const code = readFileSync(path.join(__dirname, '../src/services/suzi/delegateSuggest.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/similar/i);
  });
});

describe('honest about what it could read', () => {
  for (const failing of ['FROM delegation_matrix', 'WITH items AS', 'FROM person_facets']) {
    it(`a failing read (${failing}) gives checked:false`, async () => {
      failOn = failing;
      past = [{ email: 'a@x.com', n: 1, first_at: NOV, last_at: NOV }];
      contacts = [{ email: 'a@x.com', id: 'per_a', name: 'a' }];
      const r: any = await suggestDelegates('T', 2, 'x');
      expect(r.ok).toBe(true);
      expect(r.checked).toBe(false);
    });
  }
});

describe('areaInTitle', () => {
  it('a whole word or phrase, any case', () => {
    expect(areaInTitle('Vendor invoices', 'pay VENDOR  invoices today')).toBe(true);
    expect(areaInTitle('AP', 'call the apple supplier')).toBe(false);
    expect(areaInTitle('AP', 'AP backlog')).toBe(true);
    expect(areaInTitle('HR', 'Ask (HR) about leave')).toBe(true);
  });
});

describe('no model', () => {
  it('imports no LLM, triage or criticality code', () => {
    const src = readFileSync(path.join(__dirname, '../src/services/suzi/delegateSuggest.ts'), 'utf8');
    expect(src).not.toMatch(/callLLM|llmRouter|triageSuggester|criticality|gemini/i);
  });
});

describe('the route', () => {
  const app = express();
  app.use(express.json());
  app.use('/g', router);
  const q = 'user_id=2&tenant_id=TMC-0001';
  it('answers the agreed shape', async () => {
    past = [{ email: 'a@x.com', n: 2, first_at: AUG, last_at: NOV }];
    contacts = [{ email: 'a@x.com', id: 'per_a', name: 'a' }];
    const r = await request(app).get(`/g/delegate-suggestions?${q}&task_id=x`).set('Authorization', 'Bearer right-secret');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['checked', 'skipped', 'suggestions']);
    expect(r.body.suggestions[0]).toMatchObject({ person_id: 'per_a', source: 'past_practice', count: 2 });
  });
  it('404 not_found and 400 bad_state come as {error: {code, message}}', async () => {
    itemFind.mockResolvedValue(null);
    let r = await request(app).get(`/g/delegate-suggestions?${q}&task_id=x`).set('Authorization', 'Bearer right-secret');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
    itemFind.mockResolvedValue({ title: 't', type: 'task', status: 'CLOSED', delegateeEmail: null });
    r = await request(app).get(`/g/delegate-suggestions?${q}&task_id=x`).set('Authorization', 'Bearer right-secret');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('bad_state');
  });
  it('no task_id is 400; no secret is 401', async () => {
    expect((await request(app).get(`/g/delegate-suggestions?${q}`).set('Authorization', 'Bearer right-secret')).status).toBe(400);
    expect((await request(app).get(`/g/delegate-suggestions?${q}&task_id=x`)).status).toBe(401);
  });
});
