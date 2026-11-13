/**
 * DEF-457 (founder, 13 Nov 2026, Wiki-Knowledge §0.9: rules are one set, everywhere). Pinned:
 *  READ      the model only says what kind of rule the text is; a match value or person not in his words is refused;
 *            anything that is not an incoming-email rule stays an instruction only;
 *  APPLY     an email-rule instruction becomes the email rule Suzi's list applies, through ruleSet (confirmed by his
 *            typing it), linked by instruction_id; a sender named as a person resolves to exactly one of his people;
 *            a delegate's person must resolve, or nothing is made;
 *  FOLLOW    the instruction's status carries to its rule (paused/archived off, active on), only his own rows;
 *  LIST      My Rules lists his active Suzi email rules, with the instruction link, so a linked one shows once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const exec = vi.fn(async () => 1);
const query = vi.fn(async () => [] as any[]);
vi.mock('../src/db/prisma', () => ({ default: { $executeRawUnsafe: (...a: any[]) => (exec as any)(...a), $queryRawUnsafe: (...a: any[]) => (query as any)(...a) } }));
let llm = '{"email_rule": false}';
vi.mock('../src/services/llmRouter', () => ({ callLLM: async () => ({ text: llm }) }));
const people: Record<string, any[]> = {
  Raazia: [{ id: 'p1', name: 'Raazia Khan', email: 'raazia@x.com' }],
  Asad: [{ id: 'p2', name: 'Asad Ali', email: 'asad@x.com' }],
  Ali: [{ id: 'p3', name: 'Ali Raza', email: 'ali@x.com' }, { id: 'p4', name: 'Ali Shah', email: 'shah@x.com' }],
};
vi.mock('../src/services/suzi/suziPeople', () => ({ searchPeople: async (_c: string, _u: number, q: string) => people[q] ?? [] }));
const ruleSet = vi.fn(async () => ({ ok: true, item: { rule_id: 'uar_1' } }));
vi.mock('../src/services/suzi/suziEmailRules', () => ({ SUZI_RULE_TYPE: { email_delegate: 'forward_email', email_ignore: 'suzi_email_ignore' }, ruleSet: (...a: any[]) => (ruleSet as any)(...a) }));

import { parseEmailRuleRead, emailRuleFromInstruction, followInstructionStatus, listEmailRules } from '../src/services/suzi/instructionEmailRules';

beforeEach(() => { exec.mockClear(); query.mockReset(); query.mockResolvedValue([]); ruleSet.mockClear(); llm = '{"email_rule": false}'; });

describe('reading his words', () => {
  it('takes a match that is in his words; refuses one that is not; not an email rule stays an instruction', () => {
    expect(parseEmailRuleRead('{"email_rule":true,"kind":"ignore","by":"subject","value":"Demo VM","delegate_to":null}', 'always ignore Demo VM alerts'))
      .toEqual({ kind: 'ignore', by: 'subject', value: 'Demo VM', delegate_to: null });
    expect(parseEmailRuleRead('{"email_rule":true,"kind":"ignore","by":"sender","value":"alerts@demo.com"}', 'always ignore Demo VM alerts')).toBeNull();
    expect(parseEmailRuleRead('{"email_rule":true,"kind":"delegate","by":"person","value":"Raazia","delegate_to":"Salman"}', "always delegate Raazia's emails to Asad")).toBeNull();
    expect(parseEmailRuleRead('{"email_rule": false}', 'remind me every Friday')).toBeNull();
    expect(parseEmailRuleRead('not json', 'x')).toBeNull();
  });
});

describe('an email-rule instruction applies to Suzi\'s list too', () => {
  it('ignore by subject: one ruleSet, confirmed, linked to the instruction', async () => {
    llm = '{"email_rule":true,"kind":"ignore","by":"subject","value":"Demo VM","delegate_to":null}';
    expect(await emailRuleFromInstruction('T', 2, 'ins_9', 'always ignore Demo VM alerts')).toBe('uar_1');
    expect(ruleSet).toHaveBeenCalledWith('T', 2, { kind: 'email_ignore', match: { by: 'subject', value: 'Demo VM' }, person_id: undefined, instruction_id: 'ins_9' }, true);
  });
  it("delegate by person: Raazia's address is the match, Asad is the person", async () => {
    llm = '{"email_rule":true,"kind":"delegate","by":"person","value":"Raazia","delegate_to":"Asad"}';
    await emailRuleFromInstruction('T', 2, 'ins_1', "Always delegate Raazia's emails to Asad");
    expect(ruleSet).toHaveBeenCalledWith('T', 2, { kind: 'email_delegate', match: { by: 'sender', value: 'raazia@x.com' }, person_id: 'p2', instruction_id: 'ins_1' }, true);
  });
  it('an ambiguous or unknown person makes nothing; a model failure makes nothing', async () => {
    llm = '{"email_rule":true,"kind":"delegate","by":"subject","value":"invoice","delegate_to":"Ali"}';
    expect(await emailRuleFromInstruction('T', 2, 'ins_2', 'always delegate invoice emails to Ali')).toBeNull();
    llm = '{"email_rule":true,"kind":"ignore","by":"person","value":"Nobody","delegate_to":null}';
    expect(await emailRuleFromInstruction('T', 2, 'ins_3', 'always ignore Nobody')).toBeNull();
    llm = '{"email_rule": false}';
    expect(await emailRuleFromInstruction('T', 2, 'ins_4', 'remind me to call Kate')).toBeNull();
    expect(ruleSet).not.toHaveBeenCalled();
  });
});

describe('status and listing', () => {
  it('the instruction status carries to its rule, his rows only', async () => {
    await followInstructionStatus('T', 2, 'ins_9', false);
    const [sql, ...args] = exec.mock.calls[0] as any[];
    expect(sql).toMatch(/client_number = \$1 AND user_id = \$2 AND action_payload->'suzi'->>'instruction_id' = \$3/);
    expect(args).toEqual(['T', 2, 'ins_9', false]);
  });
  it('lists his active Suzi email rules with their link', async () => {
    query.mockResolvedValue([{ id: 'uar_6', name: 'Emails from demo_vm@tmcltd.com: ignore', kind: 'email_ignore', instruction_id: null }, { id: 'uar_7', name: 'x', kind: 'email_delegate', instruction_id: 'ins_1' }]);
    expect(await listEmailRules('T', 2)).toEqual([
      { id: 'uar_6', text: 'Emails from demo_vm@tmcltd.com: ignore', kind: 'email_ignore', instruction_id: null },
      { id: 'uar_7', text: 'x', kind: 'email_delegate', instruction_id: 'ins_1' },
    ]);
    const [sql, c, u, types] = query.mock.calls[0] as any[];
    expect(sql).toMatch(/is_active = TRUE AND action_type = ANY/);
    expect([c, u, types]).toEqual(['T', 2, ['forward_email', 'suzi_email_ignore']]);
  });
});
