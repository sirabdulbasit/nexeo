/**
 * F-2.4 / F-2.5 (Functional Charter, agreed 11 Nov 2026): his email rules, set by Suzi.
 *
 *   rule.set     {kind: email_delegate | email_ignore, match: {by: sender | domain | subject, value}, person_id?, note?}
 *                → {rule_id, rules_version}
 *   rule.remove  {rule_id} → {removed: true, rules_version}
 *   pack         emails[].by_rule {action: ready | ignored | delegated, rule_id, person_name?, task_id?, at}
 *
 * Kept in Nexeo's one rule store (`user_action_rules`, the rules the portal shows), at mode DRAFT, so no other path
 * fires them: nothing is ever sent by a rule. A delegate rule PREPARES and HOLDS (founder's option a): the email is
 * listed "ready to delegate to X by your rule", and his one signed yes sends the batch, each as email.delegate
 * {email_id} with no person_id; the person comes from the rule (409 rule_removed if it is gone). An ignore rule
 * sends nothing; the email is listed as ignored by the rule, apart from those needing a reply.
 *
 * Only he sets rules on his own mailbox (scope "user", his own user id). A subject match is a case-insensitive
 * substring; a domain match is the sender's domain or a subdomain of it; a sender match is the address itself.
 */
import crypto from 'crypto';
import prisma from '../../db/prisma';
import { personById } from './suziPeople';

type Args = Record<string, unknown>;
type Result = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const fail = (error: string, detail?: string): Result => ({ ok: false, error, ...(detail ? { detail } : {}) });
const KINDS = ['email_delegate', 'email_ignore'] as const;
const BY = ['sender', 'domain', 'subject'] as const;
export const SUZI_RULE_TYPE = { email_delegate: 'forward_email', email_ignore: 'suzi_email_ignore' } as const;

export interface SuziEmailRule {
  id: string; kind: (typeof KINDS)[number]; by: (typeof BY)[number]; value: string;
  person_id?: string; person_name?: string; person_email?: string; note?: string;
}

async function rulesVersion(clientNumber: string, userId: number): Promise<number | undefined> {
  const { rulesDocument } = await import('./suziRules');
  return (await rulesDocument(clientNumber, userId).catch(() => null))?.rules_version;
}

export async function ruleSet(clientNumber: string, userId: number, a: Args, confirmed: boolean): Promise<Result> {
  if (!confirmed) return fail('needs_confirmation');
  const kind = text(a.kind) as SuziEmailRule['kind'];
  if (!KINDS.includes(kind)) return fail('bad_rule', 'kind is email_delegate or email_ignore');
  const m: any = a.match && typeof a.match === 'object' ? a.match : {};
  const by = text(m.by) as SuziEmailRule['by'];
  let value = text(m.value).toLowerCase().slice(0, 200);
  if (!BY.includes(by) || !value) return fail('bad_rule', 'match is {by: sender|domain|subject, value}');
  if (by === 'domain') value = value.replace(/^.*@/, '').replace(/^\./, '');
  if (by === 'sender' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return fail('bad_rule', 'a sender match is an email address');
  if (by === 'domain' && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return fail('bad_rule', 'a domain match is a domain such as example.com');
  let person: Awaited<ReturnType<typeof personById>> = null;
  if (kind === 'email_delegate') {
    person = await personById(clientNumber, userId, text(a.person_id));
    if (!person) return fail('not_found', 'no such person');
    if (!person.email) return fail('no_email', 'delegating needs the person\'s email on record');
  }
  const note = text(a.note).slice(0, 500);
  const condition = by === 'sender' ? { sender: value } : by === 'domain' ? { senderDomain: value } : { subjectContains: value };
  const what = kind === 'email_delegate'
    ? `Emails ${by === 'subject' ? `with "${value}" in the subject` : `from ${value}`}: ready to delegate to ${person!.name}`
    : `Emails ${by === 'subject' ? `with "${value}" in the subject` : `from ${value}`}: ignore`;
  // instruction_id: the standing instruction this rule was read from (DEF-457), so the two are one rule until A3.
  const instructionId = text(a.instruction_id).slice(0, 100);
  const payload = { suzi: { kind, by, value, ...(person ? { person_id: person.id, person_name: person.name, person_email: person.email } : {}), ...(note ? { note } : {}), ...(instructionId ? { instruction_id: instructionId } : {}) } };
  // The same kind and match again folds into his existing rule (its person and note take the new values), so saving
  // a rule twice never leaves two (Suzi Master, 13 Nov: the founder saved the Demo VM rule twice).
  const same = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM user_action_rules
      WHERE client_number = $1 AND user_id = $2 AND scope = 'user' AND is_active = TRUE AND action_type = $3
        AND trigger_condition = $4::jsonb
      ORDER BY created_at ASC LIMIT 1`,
    clientNumber, userId, SUZI_RULE_TYPE[kind], JSON.stringify(condition),
  );
  if (same[0]) {
    await prisma.$executeRawUnsafe(
      // A link to an instruction, once made, is kept when the same rule is saved again from Suzi.
      `UPDATE user_action_rules SET name = $2, nl_original = $3, updated_at = now(),
         action_payload = CASE WHEN $4::jsonb->'suzi' ? 'instruction_id' OR NOT (action_payload->'suzi' ? 'instruction_id') THEN $4::jsonb
                               ELSE jsonb_set($4::jsonb, '{suzi,instruction_id}', action_payload->'suzi'->'instruction_id') END
       WHERE id = $1`,
      same[0].id, what.slice(0, 200), what.slice(0, 2000), JSON.stringify(payload),
    );
    return { ok: true, item: { rule_id: same[0].id, kind, match: { by, value }, ...(person ? { person_name: person.name } : {}), existing: true, rules_version: await rulesVersion(clientNumber, userId) } };
  }
  const id = `uar_${crypto.randomBytes(6).toString('hex')}`;
  // DRAFT: the rule store's own executor never fires it. Suzi's flow is the only one that acts on it.
  await prisma.$executeRawUnsafe(
    `INSERT INTO user_action_rules (id, client_number, user_id, scope, name, nl_original, trigger_kind, trigger_condition,
       action_type, action_payload, mode, confidence_threshold, is_active, created_by)
     VALUES ($1, $2, $3, 'user', $4, $5, 'inbound_email', $6::jsonb, $7, $8::jsonb, 'DRAFT', 0.85, TRUE, $3)`,
    id, clientNumber, userId, what.slice(0, 200), what.slice(0, 2000), JSON.stringify(condition), SUZI_RULE_TYPE[kind], JSON.stringify(payload),
  );
  return { ok: true, item: { rule_id: id, kind, match: { by, value }, ...(person ? { person_name: person.name } : {}), rules_version: await rulesVersion(clientNumber, userId) } };
}

export async function ruleRemove(clientNumber: string, userId: number, a: Args, confirmed: boolean): Promise<Result> {
  if (!confirmed) return fail('needs_confirmation');
  const id = text(a.rule_id);
  // Third review item 1 (owner approved 13 Nov 2026): removing an email rule read from one of his instructions
  // archives that instruction too, in the same transaction (they are one rule, DEF-457); both or neither.
  const removed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ instruction_id: string | null }>>(
      `UPDATE user_action_rules SET is_active = FALSE, updated_at = now()
        WHERE id = $1 AND client_number = $2 AND user_id = $3 AND scope = 'user' AND is_active = TRUE
        RETURNING action_payload->'suzi'->>'instruction_id' AS instruction_id`,
      id, clientNumber, userId,
    );
    if (!rows.length) return null;
    const ins = rows[0].instruction_id;
    if (ins) {
      await tx.$executeRawUnsafe(
        `UPDATE wiki_pages SET status = 'deleted', metadata = jsonb_set(metadata, '{status}', '"archived"'),
                last_updated_at = now(), last_updated_by = 'suzi_rule_remove'
          WHERE id = $1 AND client_number = $2 AND user_id = $3 AND page_type = 'instruction'`,
        ins, clientNumber, userId,
      );
    }
    return { instructionId: ins };
  });
  if (!removed) return fail('not_found');
  if (removed.instructionId) {
    void import('../../utils/redisClient').then(({ invalidate }) => invalidate(`instructions:${clientNumber}:*`)).catch(() => {});
  }
  return { ok: true, item: { rule_id: id, removed: true, ...(removed.instructionId ? { instruction_archived: removed.instructionId } : {}), rules_version: await rulesVersion(clientNumber, userId) } };
}

/** His active Suzi email rules, oldest first, so the first one he made wins a tie. */
export async function suziEmailRules(clientNumber: string, userId: number): Promise<SuziEmailRule[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; p: any }>>(
    `SELECT id, action_payload->'suzi' AS p FROM user_action_rules
      WHERE client_number = $1 AND user_id = $2 AND scope = 'user' AND is_active = TRUE AND action_payload ? 'suzi'
      ORDER BY created_at`,
    clientNumber, userId,
  );
  return rows.filter((r) => r.p && KINDS.includes(r.p.kind)).map((r) => ({ id: r.id, ...r.p }));
}

const addressOf = (from: string | null | undefined) => {
  const s = String(from ?? '').toLowerCase();
  return (s.match(/<([^>]+)>/)?.[1] ?? s).trim();
};

/** The first rule that matches this email, or null. */
export function ruleFor(rules: SuziEmailRule[], email: { from?: string | null; subject?: string | null }): SuziEmailRule | null {
  const addr = addressOf(email.from);
  const domain = addr.split('@')[1] ?? '';
  const subject = String(email.subject ?? '').toLowerCase();
  for (const r of rules) {
    if (r.by === 'sender' && addr && addr === r.value) return r;
    if (r.by === 'domain' && domain && (domain === r.value || domain.endsWith(`.${r.value}`))) return r;
    if (r.by === 'subject' && r.value && subject.includes(r.value)) return r;
  }
  return null;
}

/** Emails delegated by a rule in the last day, for the pack's "delegated by your rule". */
export async function delegatedByRule(clientNumber: string, userId: number, since: Date): Promise<Array<{ thread_id: string; subject: string; person_name: string; rule_id: string; task_id: string | null; at: string }>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ d: any; task_id: string | null; sent_at: string | null }>>(
    `SELECT input->'delegate' AS d, output->'send'->>'task_id' AS task_id, output->'send'->>'sent_at' AS sent_at FROM agent_actions
      WHERE client_number = $1 AND user_id = $2 AND action_type = 'draft_reply' AND output->'send'->>'state' = 'sent'
        AND input->'delegate'->>'rule_id' IS NOT NULL AND updated_at >= $3
      ORDER BY updated_at DESC LIMIT 50`,
    clientNumber, userId, since,
  ).catch(() => []);
  return rows.map((r) => ({ thread_id: String(r.d.thread_id), subject: String(r.d.subject ?? ''), person_name: String(r.d.person_name ?? ''), rule_id: String(r.d.rule_id), task_id: r.task_id, at: r.sent_at ?? '' }));
}
