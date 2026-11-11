/**
 * F-2.4 / F-2.5 (Functional Charter, agreed 11 Nov 2026). Pinned:
 *  SET       confirmed only; kind, match and person checked before anything is written; stored as a DRAFT rule of
 *            his own (scope user), so the rule store's executor never fires it;
 *  REMOVE    only his own, active rule; anything else is not_found;
 *  MATCH     sender = the address itself; domain = the domain or a subdomain, never a longer name that ends the same;
 *            subject = case-insensitive substring; the oldest rule wins;
 *  PACK      a delegate rule marks an email "ready" with the person; an ignore rule "ignored"; others untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const exec = vi.fn();
const query = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { $executeRawUnsafe: (...a: any[]) => exec(...a), $queryRawUnsafe: (...a: any[]) => query(...a) } }));
vi.mock('../src/services/suzi/suziPeople', () => ({ personById: async (_c: string, _u: number, id: string) => (id === 'p1' ? { id: 'p1', name: 'Ali Raza', email: 'ali@x.com' } : id === 'p2' ? { id: 'p2', name: 'No Mail' } : null) }));
vi.mock('../src/services/suzi/suziRules', () => ({ rulesDocument: async () => ({ rules_version: 12 }) }));

import { ruleSet, ruleRemove, ruleFor, type SuziEmailRule } from '../src/services/suzi/suziEmailRules';

beforeEach(() => { exec.mockReset(); query.mockReset(); exec.mockResolvedValue(1); });

describe('rule.set', () => {
  it('a delegate rule is stored as his own DRAFT rule, with the person', async () => {
    const r: any = await ruleSet('T', 2, { kind: 'email_delegate', match: { by: 'domain', value: '@Vendor.com' }, person_id: 'p1', note: 'handle quotes' }, true);
    expect(r.item).toMatchObject({ kind: 'email_delegate', match: { by: 'domain', value: 'vendor.com' }, person_name: 'Ali Raza', rules_version: 12 });
    const [sql, , client, user, , , cond, type, payload] = exec.mock.calls[0];
    expect(sql).toContain("'DRAFT'");
    expect(sql).toContain("'user'");
    expect([client, user]).toEqual(['T', 2]);
    expect(JSON.parse(cond)).toEqual({ senderDomain: 'vendor.com' });
    expect(type).toBe('forward_email');
    expect(JSON.parse(payload).suzi).toMatchObject({ kind: 'email_delegate', person_id: 'p1', person_email: 'ali@x.com', note: 'handle quotes' });
  });
  it('refuses before writing: no confirmation, bad kind, bad match, unknown person, no email', async () => {
    expect(await ruleSet('T', 2, { kind: 'email_ignore', match: { by: 'subject', value: 'newsletter' } }, false)).toEqual({ ok: false, error: 'needs_confirmation' });
    expect(await ruleSet('T', 2, { kind: 'email_archive', match: { by: 'subject', value: 'x' } }, true)).toMatchObject({ error: 'bad_rule' });
    expect(await ruleSet('T', 2, { kind: 'email_ignore', match: { by: 'body', value: 'x' } }, true)).toMatchObject({ error: 'bad_rule' });
    expect(await ruleSet('T', 2, { kind: 'email_ignore', match: { by: 'sender', value: 'not-an-address' } }, true)).toMatchObject({ error: 'bad_rule' });
    expect(await ruleSet('T', 2, { kind: 'email_delegate', match: { by: 'subject', value: 'x' }, person_id: 'zz' }, true)).toMatchObject({ error: 'not_found' });
    expect(await ruleSet('T', 2, { kind: 'email_delegate', match: { by: 'subject', value: 'x' }, person_id: 'p2' }, true)).toMatchObject({ error: 'no_email' });
    expect(exec).not.toHaveBeenCalled();
  });
  it('an ignore rule has no person and its own action type', async () => {
    await ruleSet('T', 2, { kind: 'email_ignore', match: { by: 'subject', value: 'Newsletter' } }, true);
    expect(exec.mock.calls[0][7]).toBe('suzi_email_ignore');
    expect(JSON.parse(exec.mock.calls[0][6])).toEqual({ subjectContains: 'newsletter' });
  });
});

describe('rule.remove', () => {
  it('only his own active rule', async () => {
    expect(await ruleRemove('T', 2, { rule_id: 'uar_1' }, true)).toMatchObject({ ok: true, item: { removed: true, rules_version: 12 } });
    expect(exec.mock.calls[0][0]).toMatch(/user_id = \$3 AND scope = 'user' AND is_active = TRUE/);
    expect(exec.mock.calls[0].slice(1)).toEqual(['uar_1', 'T', 2]);
    exec.mockResolvedValue(0);
    expect(await ruleRemove('T', 2, { rule_id: 'someone-elses' }, true)).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('matching', () => {
  const rules: SuziEmailRule[] = [
    { id: 'r1', kind: 'email_delegate', by: 'domain', value: 'vendor.com', person_id: 'p1', person_name: 'Ali Raza' },
    { id: 'r2', kind: 'email_ignore', by: 'subject', value: 'newsletter' },
    { id: 'r3', kind: 'email_ignore', by: 'sender', value: 'boss@x.com' },
  ];
  it('domain: the domain or a subdomain, never a longer name ending the same', () => {
    expect(ruleFor(rules, { from: 'Sam <sam@vendor.com>' })?.id).toBe('r1');
    expect(ruleFor(rules, { from: 'sam@eu.vendor.com' })?.id).toBe('r1');
    expect(ruleFor(rules, { from: 'sam@badvendor.com' })).toBeNull();
  });
  it('subject: case-insensitive substring; sender: the exact address', () => {
    expect(ruleFor(rules, { from: 'a@y.com', subject: 'Weekly NEWSLETTER #4' })?.id).toBe('r2');
    expect(ruleFor(rules, { from: 'Boss <BOSS@x.com>' })?.id).toBe('r3');
    expect(ruleFor(rules, { from: 'notboss@x.com' })).toBeNull();
  });
  it('the oldest matching rule wins', () => {
    expect(ruleFor(rules, { from: 'sam@vendor.com', subject: 'newsletter' })?.id).toBe('r1');
  });
});
