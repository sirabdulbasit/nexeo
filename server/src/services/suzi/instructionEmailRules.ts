/**
 * One set of rules (founder, 13 Nov 2026, on My Rules: "don't do anything by yourself, it should be part of Nexeo
 * rules"; DEF-457). Until the Wiki holds rules as notes (W-1 A3), the two stores are tied together here:
 *
 *   - a standing instruction he types (My Rules, Brain, or Suzi's instruction.add) that is an EMAIL rule ("always
 *     ignore Demo VM alerts", "always delegate Raazia's emails to Asad") also becomes the email rule Suzi's pack
 *     applies (user_action_rules through ruleSet), linked by `instruction_id`; pausing or archiving the instruction
 *     turns the rule off, re-activating turns it on;
 *   - the email rules set through Suzi are listed on My Rules (`listEmailRules`), with Remove = rule.remove;
 *     a rule tied to an instruction is shown once, as the instruction.
 *
 * The model only reads what kind of rule the text is; the match value must appear in his words, a delegate's person
 * must resolve to exactly one of his people with an email, and anything unsure stays an instruction only.
 */
import prisma from '../../db/prisma';
import createLogger from '../../utils/logger';
import { SUZI_RULE_TYPE } from './suziEmailRules';

const log = createLogger('instruction-email-rule');

const SYSTEM = `You read ONE standing instruction an executive gave his assistant and decide whether it is a rule about handling his INCOMING EMAILS by who sent them or by words in the subject. Output ONLY JSON:
{"email_rule": false}
or
{"email_rule": true, "kind": "ignore" | "delegate", "by": "sender" | "domain" | "subject" | "person", "value": "...", "delegate_to": "name or null"}

- kind=ignore: he wants such emails ignored, not shown, archived, muted. kind=delegate: handed to a named person.
- by=sender with value = an email address written in the text; by=domain with value = a domain written in the text;
  by=subject with value = the words that identify the emails (e.g. "Demo VM"); by=person with value = the sender's
  name when he names a person rather than an address ("Raazia's emails").
- value MUST be copied from his text. Never invent an address, a domain or a person.
- Anything else (meetings, WhatsApp, tasks, reminders, tone, "notify me if", one-off requests): {"email_rule": false}.`;

export interface EmailRuleRead { kind: 'ignore' | 'delegate'; by: 'sender' | 'domain' | 'subject' | 'person'; value: string; delegate_to: string | null }

export function parseEmailRuleRead(raw: string, text: string): EmailRuleRead | null {
  let j: any;
  try { j = JSON.parse((raw.match(/\{[\s\S]*\}/) ?? [''])[0]); } catch { return null; }
  if (!j?.email_rule) return null;
  const kind = j.kind === 'ignore' || j.kind === 'delegate' ? j.kind : null;
  const by = ['sender', 'domain', 'subject', 'person'].includes(j.by) ? j.by : null;
  const value = typeof j.value === 'string' ? j.value.trim() : '';
  if (!kind || !by || !value) return null;
  // His words, never the model's: the value must be in what he wrote.
  if (!text.toLowerCase().includes(value.toLowerCase())) return null;
  const to = typeof j.delegate_to === 'string' && j.delegate_to.trim() ? j.delegate_to.trim() : null;
  if (kind === 'delegate' && (!to || !text.toLowerCase().includes(to.toLowerCase()))) return null;
  return { kind, by, value, delegate_to: to };
}

async function onePerson(clientNumber: string, userId: number, name: string) {
  const { searchPeople } = await import('./suziPeople');
  const found = (await searchPeople(clientNumber, userId, name)).filter((p) => p.email);
  // Exactly one, or the best match clearly named: anything ambiguous stays an instruction only.
  const exact = found.filter((p) => p.name.toLowerCase().split(/\s+/).includes(name.toLowerCase().split(/\s+/)[0]));
  return exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : null;
}

/** Called when he gives a standing instruction. Returns the email rule's id when one was made (or folded into). */
export async function emailRuleFromInstruction(clientNumber: string, userId: number, instructionId: string, text: string): Promise<string | null> {
  try {
    const { callLLM } = await import('../llmRouter');
    const r = await callLLM(SYSTEM, text.slice(0, 1000), { clientNumber, userId, purpose: 'instruction_email_rule', maxTokens: 150, timeoutMs: 8000 } as any);
    const read = parseEmailRuleRead(String(r?.text ?? ''), text);
    if (!read) return null;
    let match: { by: 'sender' | 'domain' | 'subject'; value: string };
    if (read.by === 'person') {
      const sender = await onePerson(clientNumber, userId, read.value);
      if (!sender?.email) return null;
      match = { by: 'sender', value: sender.email };
    } else match = { by: read.by, value: read.value };
    let personId: string | undefined;
    if (read.kind === 'delegate') {
      const to = await onePerson(clientNumber, userId, read.delegate_to!);
      if (!to) return null;
      personId = to.id;
    }
    const { ruleSet } = await import('./suziEmailRules');
    const made: any = await ruleSet(clientNumber, userId, {
      kind: read.kind === 'ignore' ? 'email_ignore' : 'email_delegate', match, person_id: personId, instruction_id: instructionId,
    }, true);
    if (!made.ok) { log.info('instruction is not an email rule we can apply', { userId, instructionId, error: made.error }); return null; }
    log.info('instruction applies to email too', { userId, instructionId, ruleId: made.item.rule_id });
    return made.item.rule_id;
  } catch (e: any) {
    log.warn('email rule from instruction failed; the instruction stands', { userId, instructionId, error: e?.message?.slice(0, 160) });
    return null;
  }
}

/**
 * The instruction's status carries to its email rule: paused or archived = off, active = on. Returned UNRUN (a Prisma
 * query is lazy) so the caller puts it in the same transaction as the instruction's own write (third review item 1).
 */
export function followInstructionStatus(clientNumber: string, userId: number, instructionId: string, active: boolean) {
  return prisma.$executeRawUnsafe(
    `UPDATE user_action_rules SET is_active = $4, updated_at = now()
      WHERE client_number = $1 AND user_id = $2 AND action_payload->'suzi'->>'instruction_id' = $3`,
    clientNumber, userId, instructionId, active,
  );
}

export interface ListedEmailRule { id: string; text: string; kind: 'email_ignore' | 'email_delegate'; instruction_id: string | null }

/** His active email rules (Suzi's), for My Rules. */
export async function listEmailRules(clientNumber: string, userId: number): Promise<ListedEmailRule[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; kind: string | null; instruction_id: string | null }>>(
    `SELECT id, name, action_payload->'suzi'->>'kind' AS kind, action_payload->'suzi'->>'instruction_id' AS instruction_id
       FROM user_action_rules
      WHERE client_number = $1 AND user_id = $2 AND scope = 'user' AND is_active = TRUE AND action_type = ANY($3::text[])
      ORDER BY created_at ASC`,
    clientNumber, userId, Object.values(SUZI_RULE_TYPE),
  );
  return rows.map((r) => ({ id: r.id, text: r.name, kind: r.kind === 'email_delegate' ? 'email_delegate' : 'email_ignore', instruction_id: r.instruction_id || null }));
}
