/**
 * DEF-462 (owner, 13 Nov 2026, Wiki-Knowledge §0.12): "all emails should be land in wiki and marked with rules".
 * Each email the triage judges carries its attention mark on its Wiki source, through the Wiki's one door
 * (markSource, D-229). Shape agreed with the Wiki session (§0.12.1):
 *   attention = { class: needs_you | for_your_knowledge | brief, reason?: escalation | risk | own_thread | team, why? }
 *   by 'triage:v2' (the reasoner's prompt version).
 * Not judged (the model gave no needsYou) writes NO mark: the email reads as unmarked, which countUnmarked reports.
 * The same value again is a no-op, so re-judging is safe. A refusal (the email is not landed in the Wiki yet) is
 * logged with the feed event, never swallowed silently; the next judgement retries it.
 */
import prisma from '../../db/prisma';
import createLogger from '../../utils/logger';
import type { AttentionItem } from './triageSuggester';

const log = createLogger('triage-marks');
export const TRIAGE_MARK_BY = 'triage:v2';

export function attentionMarkOf(it: Pick<AttentionItem, 'needsYou' | 'forYourKnowledge'>): Record<string, unknown> | null {
  if (it.needsYou === true) return { class: 'needs_you' };
  if (it.needsYou !== false) return null;
  if (it.forYourKnowledge) return { class: 'for_your_knowledge', reason: it.forYourKnowledge.kind, why: it.forYourKnowledge.why };
  return { class: 'brief' };
}

/** Write the email's attention mark onto its Wiki source. Never throws. Returns what happened, for logs and tests. */
export async function writeAttentionMark(
  row: { id: string; clientNumber: string; userId: number; sourceType: string },
  it: Pick<AttentionItem, 'needsYou' | 'forYourKnowledge'>,
): Promise<'marked' | 'unchanged' | 'not_judged' | 'not_email' | 'refused' | 'failed'> {
  if (row.sourceType !== 'gmail') return 'not_email';
  const value = attentionMarkOf(it);
  if (!value) return 'not_judged';
  try {
    const fe = await prisma.$queryRawUnsafe<Array<{ source_id: string | null }>>(
      `SELECT source_id FROM feed_events WHERE id = $1 AND client_number = $2 AND user_id = $3`, row.id, row.clientNumber, row.userId,
    );
    const gmailId = fe[0]?.source_id;
    if (!gmailId) { log.warn('email has no message id; not marked', { feedEventId: row.id }); return 'failed'; }
    const { sourceId } = await import('../wiki/wikiSources');
    const { markSource } = await import('../wiki/wikiStore');
    const r = await markSource({ clientNumber: row.clientNumber, userId: row.userId }, sourceId(row.clientNumber, row.userId, 'email', gmailId),
      { kind: 'attention', value, by: TRIAGE_MARK_BY });
    return r.changed ? 'marked' : 'unchanged';
  } catch (e: any) {
    const refused = e?.name === 'MarkRefused';
    log.warn(refused ? 'attention mark refused (email not landed in the Wiki yet); retried at the next judgement' : 'attention mark failed',
      { feedEventId: row.id, userId: row.userId, error: String(e?.message ?? e).slice(0, 160) });
    return refused ? 'refused' : 'failed';
  }
}
