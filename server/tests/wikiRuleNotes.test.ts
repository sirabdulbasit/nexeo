/**
 * Rule notes (docs/Wiki-Knowledge.md §0.13 part 9; owner's ruling 13 Nov 2026,
 * 17:10 PKT: learned patterns only suggest; rules, delegations and standing
 * instructions act by themselves).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

import { buildRuleNotes, actsByItself, type RuleRow } from '../src/services/wiki/wikiRuleNotes';

const ctx = {
  personByEmail: new Map([['ali@acme.com', 'Ali Khan']]),
  companyByDomain: new Map([['acme.com', 'acme.com'], ['acme.ai', 'acme.com']]),
};
const row = (over: Partial<RuleRow>): RuleRow => ({
  kind: 'rule', ids: ['rule:action_rule:uar_1'], title: 'A rule', does: 'Does a thing.', status: 'on',
  setBy: 'him', store: 'user_action_rules', storeId: 'uar_1', ...over,
});

describe('rule notes', () => {
  it('acts by itself: a rule, delegation, instruction or permission that is on; never a learned pattern', () => {
    for (const k of ['rule', 'delegation', 'instruction', 'permission', 'system'] as const) expect(actsByItself(k, 'on'), k).toBe(true);
    expect(actsByItself('suggestion', 'on')).toBe(false);
    expect(actsByItself('instruction', 'paused')).toBe(false);
    expect(actsByItself('rule', 'off')).toBe(false);
  });

  it('says what it is, whether it acts, what it applies to, in his words, and where it is kept', () => {
    const [n] = buildRuleNotes([row({ kind: 'delegation', title: 'Ali\'s invoices to Salman', appliesTo: { email: 'ALI@acme.com' }, words: 'send Ali\'s invoices to Salman', does: 'Forward to Salman.' })], ctx);
    expect(n.type).toBe('rule');
    expect(n.body).toContain('**Kind:** Delegation');
    expect(n.body).toContain('**Acts by itself:** yes');
    expect(n.body).toContain('**Applies to:** [[Ali Khan]]');
    expect(n.body).toContain('**Company:** [[acme.com]]');
    expect(n.body).toContain('**In his words:** "send Ali\'s invoices to Salman"');
    expect(n.body).toContain('**Kept in:** `user_action_rules` uar_1');
    expect(n.properties).toMatchObject({ kind: 'delegation', acts: true, status: 'on', appliesTo: 'ali@acme.com' });
    expect(n.ids).toEqual(['rule:action_rule:uar_1']);
    expect(n.scope).toBe('user');
  });

  it('a learned pattern says it only suggests, and links the company it is about', () => {
    const [n] = buildRuleNotes([row({ kind: 'suggestion', ids: ['rule:pattern:p1'], title: 'Learned: archive acme.ai', appliesTo: { domain: 'acme.ai' }, store: 'shadow_rules', storeId: 'p1' })], ctx);
    expect(n.body).toContain('**Acts by itself:** no, it only suggests');
    expect(n.body).toContain('**Applies to:** [[acme.com]]');
    expect(n.properties!.acts).toBe(false);
  });

  it('a typed instruction and the email rule read from it are one note', () => {
    const notes = buildRuleNotes([
      row({ kind: 'instruction', ids: ['rule:instruction:i9'], title: 'Ignore Demo VM mail', store: 'wiki_pages instruction', storeId: 'i9', does: 'Ignore its mail.' }),
      row({ ids: ['rule:action_rule:uar_7', 'rule:instruction:i9'], title: 'Emails from demo@x.com: ignore', storeId: 'uar_7', does: 'Mark ignored by this rule; send nothing.' }),
    ], ctx);
    expect(notes).toHaveLength(1);
    expect([...notes[0].ids!].sort()).toEqual(['rule:action_rule:uar_7', 'rule:instruction:i9']);
    expect(notes[0].body).toContain('Applied to his email as: Mark ignored by this rule');
    expect(notes[0].body).toContain('also `user_action_rules` uar_7');
  });

  it('two rules with one name get two titles; a company or system rule is shared; a paused one says so', () => {
    const notes = buildRuleNotes([
      row({ title: 'Same', storeId: 'uar_aaaaaa1', ids: ['rule:action_rule:uar_aaaaaa1'] }),
      row({ title: 'Same', storeId: 'uar_bbbbbb2', ids: ['rule:action_rule:uar_bbbbbb2'] }),
      row({ kind: 'system', title: 'Hostile tone', shared: true, store: 'risk_rules', storeId: '6', ids: ['rule:risk_rules:6'] }),
      row({ kind: 'instruction', title: 'Paused one', status: 'paused', ids: ['rule:instruction:p'], storeId: 'p' }),
    ], ctx);
    expect(notes.map((n) => n.title)).toEqual(['Same (aaaaa1)', 'Same (bbbbb2)', 'Hostile tone', 'Paused one']);
    expect(notes[2].scope).toBe('tenant');
    expect(notes[3].body).toContain('**Acts by itself:** no, it is paused');
  });
});
