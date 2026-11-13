/**
 * Functional Charter row 4; link T12, P1 and P2. The user's rules as one version-numbered document for
 * Suzi, built by code with no model:
 *
 *   rules_version: goes up only when the content changes
 *   rules:         {quiet_hours, language, delegations, action_rules, standing}
 *   rules_md:      the same content as Markdown
 *
 * Suzi's own check can only refuse. Nexeo decides at the moment of writing, from its own copy, so a stale
 * `rules_version` on `act` never refuses anything: Nexeo answers with the current number and Suzi refetches.
 */
import crypto from 'crypto';
import prisma from '../../db/prisma';
import { getActiveInstructions } from '../knowledge/instructionService';

export interface SuziRules {
  quiet_hours: { start: string; end: string };
  language: string;
  delegations: Array<{ area: string; owner: string; owner_email: string | null; escalate_to: string | null }>;
  action_rules: Array<{ id: string; name: string; text: string; mode: string; scope: string }>;
  standing: Array<{ id: string; text: string }>;
}
export interface RulesDocument { rules_version: number; rules: SuziRules; rules_md: string }

const LANGUAGE_CODES: Record<string, string> = { english: 'en', en: 'en', urdu: 'ur', ur: 'ur' };

export async function rulesContent(clientNumber: string, userId: number): Promise<SuziRules> {
  const [user, delegations, actionRules, instructions] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ bc: any }>>(
      `SELECT notification_preferences->'brain_channel' AS bc FROM users WHERE id = $1 AND client_number = $2`,
      userId, clientNumber,
    ),
    prisma.$queryRawUnsafe<Array<{ area: string; owner_name: string; owner_email: string | null; escalate_to_name: string | null }>>(
      `SELECT area, owner_name, owner_email, escalate_to_name FROM delegation_matrix
        WHERE client_number = $1 AND is_active = TRUE ORDER BY area`,
      clientNumber,
    ),
    prisma.$queryRawUnsafe<Array<{ id: unknown; name: string; nl_original: string | null; mode: string; scope: string }>>(
      `SELECT id, name, nl_original, mode, scope FROM user_action_rules
        WHERE client_number = $1 AND user_id = $2 AND is_active = TRUE ORDER BY id`,
      clientNumber, userId,
    ),
    // Throws when the rules cannot be read: the pack then leaves the rules out and the desktop keeps its last copy.
    getActiveInstructions(clientNumber, userId),
  ]);
  const bc = user[0]?.bc ?? {};
  return {
    quiet_hours: { start: bc.quietStart || '22:00', end: bc.quietEnd || '08:00' },
    language: LANGUAGE_CODES[String(bc.replyLanguage ?? '').toLowerCase()] ?? 'en',
    delegations: delegations.map((d) => ({ area: d.area, owner: d.owner_name, owner_email: d.owner_email, escalate_to: d.escalate_to_name })),
    action_rules: actionRules.map((r) => ({ id: String(r.id), name: r.name, text: r.nl_original || r.name, mode: r.mode, scope: r.scope })),
    // Sorted so the same instructions always give the same version, whatever order they were read in.
    standing: instructions
      .map((i) => ({ id: i.id, text: i.originalText || i.title }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function rulesMarkdown(r: SuziRules): string {
  const section = (title: string, lines: string[]) => (lines.length ? ['', `## ${title}`, ...lines.map((l) => `- ${l}`)] : []);
  return [
    '# Rules',
    '',
    `Quiet hours: ${r.quiet_hours.start} to ${r.quiet_hours.end}`,
    `Language: ${r.language}`,
    ...section('Delegations', r.delegations.map((d) => `${d.area}: ${d.owner}${d.escalate_to ? `, escalates to ${d.escalate_to}` : ''}`)),
    ...section('Action rules', r.action_rules.map((a) => `${a.text} (${a.mode})`)),
    ...section('Standing instructions', r.standing.map((s) => s.text)),
  ].join('\n');
}

/** The number moves only when the content does, and two readers at once can't both move it. */
async function versionFor(clientNumber: string, userId: number, rules: SuziRules): Promise<number> {
  const hash = crypto.createHash('sha256').update(JSON.stringify(rules)).digest('hex');
  const rows = await prisma.$queryRawUnsafe<Array<{ version: number }>>(
    `INSERT INTO suzi_rules_version (client_number, user_id, content_hash, version, updated_at)
     VALUES ($1, $2, $3, 1, now())
     ON CONFLICT (client_number, user_id) DO UPDATE SET
       version = suzi_rules_version.version + CASE WHEN suzi_rules_version.content_hash = EXCLUDED.content_hash THEN 0 ELSE 1 END,
       updated_at = CASE WHEN suzi_rules_version.content_hash = EXCLUDED.content_hash THEN suzi_rules_version.updated_at ELSE now() END,
       content_hash = EXCLUDED.content_hash
     RETURNING version`,
    clientNumber, userId, hash,
  );
  return Number(rows[0].version);
}

export async function rulesDocument(clientNumber: string, userId: number): Promise<RulesDocument> {
  const rules = await rulesContent(clientNumber, userId);
  return { rules_version: await versionFor(clientNumber, userId, rules), rules, rules_md: rulesMarkdown(rules) };
}

/**
 * For `act`: the current number if the caller's is out of date, otherwise nothing. A failure here also gives
 * nothing, because the operation has already been decided and this is only a hint to refetch.
 */
export async function newerRulesVersion(clientNumber: string, userId: number, given: unknown): Promise<number | undefined> {
  if (typeof given !== 'number') return undefined;
  try {
    const current = await versionFor(clientNumber, userId, await rulesContent(clientNumber, userId));
    return current === given ? undefined : current;
  } catch {
    return undefined;
  }
}
