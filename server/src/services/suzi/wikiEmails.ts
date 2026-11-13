/**
 * DEF-465, W-1.E (founder 13 Nov: "all emails should be land in wiki and marked with rules … Suzi will extract emails …
 * from wiki"; Suzi Master AGREE 13 Nov 15:20 with n1 rule_id kept, n2 email.mark answers unchanged). Emails are read
 * from the Wiki's marked email sources, not from the in-memory triage partition:
 *   attention needs_you, or NOT judged yet (safe default: never hidden) -> emails needing him
 *   attention for_your_knowledge                                         -> fyi
 *   attention brief / own, or a handled mark                             -> neither
 * and each email's rule mark (kind 'rule', key = the rule's id) is written from his Suzi email rules, so a rule set
 * from Suzi marks the matching emails already in the Wiki.
 */
import createLogger from '../../utils/logger';
import type { SuziEmailRule } from './suziEmailRules';

const log = createLogger('wiki-emails');
export const WIKI_EMAIL_WINDOW_DAYS = 7;
export const RULE_SWEEP_DAYS = 30;
const MAX_EMAILS = 60;
const MAX_FYI = 10;

type Mark = { kind: string; key?: string; value?: any };
const attentionOf = (marks: Mark[]) => marks.find((m) => m.kind === 'attention')?.value as { class?: string; reason?: string; why?: string; urgency?: string; point?: string } | undefined;

/** The place an email takes from its marks. */
export function placeOf(marks: Mark[]): 'email' | 'fyi' | 'none' {
  if (marks.some((m) => m.kind === 'handled')) return 'none';
  const a = attentionOf(marks);
  if (!a?.class || a.class === 'needs_you') return 'email';
  if (a.class === 'for_your_knowledge') return 'fyi';
  return 'none';
}

const nameOf = (p: unknown) => String(p ?? '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || String(p ?? '');
const addressOf = (p: unknown) => (String(p ?? '').match(/<([^>]+)>/)?.[1] ?? String(p ?? '')).trim().toLowerCase();

/** The day pack's and the spoken brief's emails, read from the Wiki. Item shape = what toPackEmail and the brief read. */
export async function loadWikiEmails(clientNumber: string, userId: number, now = new Date()) {
  const { listMarkedSources } = await import('../wiki/wikiStore');
  const { readSource } = await import('../wiki/wikiSources');
  const rows: any[] = await (listMarkedSources as any)(clientNumber, userId, {
    kinds: ['email'], since: new Date(now.getTime() - WIKI_EMAIL_WINDOW_DAYS * 86_400_000), until: now, limit: 500,
  });
  const seen = new Set<string>();
  const emails: any[] = []; const fyi: any[] = [];
  for (const r of rows) { // newest first
    const thread = r.threadKey ?? r.id;
    if (seen.has(thread)) continue; // the thread's newest email speaks for it
    seen.add(thread);
    const place = placeOf(r.marks ?? []);
    if (place === 'none') continue;
    if (place === 'email' ? emails.length >= MAX_EMAILS : fyi.length >= MAX_FYI) continue;
    const src = await readSource(clientNumber, userId, r.id).catch(() => null);
    const a = attentionOf(r.marks ?? []);
    const from = String((src?.details as any)?.from ?? (Array.isArray(r.participants) ? r.participants[0] : '') ?? '');
    const item = {
      feedEventId: r.externalId, threadId: thread, from, fromDisplay: nameOf(from), fromEmail: addressOf(from),
      subject: r.title || '(no subject)', preview: String(src?.body ?? '').replace(/\s+/g, ' ').slice(0, 200),
      receivedAt: (r.occurredAt instanceof Date ? r.occurredAt : new Date(r.occurredAt)).toISOString(),
      criticality: a?.urgency ? { band: a.urgency } : null, critical: a?.urgency === 'critical',
      rationale: a?.point ?? null, forYourKnowledge: a?.class === 'for_your_knowledge' ? { kind: a.reason ?? 'escalation', why: a.why ?? '' } : null,
    };
    (place === 'email' ? emails : fyi).push(item);
  }
  return { emails, fyi };
}

/** The rule mark one email should carry under his rules; clears a stale one. Never throws. */
export async function markRulesOn(writer: { clientNumber: string; userId: number }, sourceId: string, email: { from?: string | null; subject?: string | null }, rules: SuziEmailRule[], current: Mark[] = []): Promise<void> {
  try {
    const { ruleFor } = await import('./suziEmailRules');
    const { markSource, clearMark } = await import('../wiki/wikiStore');
    const r = rules.length ? ruleFor(rules, email) : null;
    for (const m of current.filter((x) => x.kind === 'rule' && x.key !== r?.id)) await clearMark(writer, sourceId, 'rule' as any, m.key ?? '');
    if (r) await markSource(writer, sourceId, { kind: 'rule', key: r.id, by: `rule:${r.id}`, value: { action: r.kind === 'email_delegate' ? 'delegate' : 'ignore', ...(r.person_id ? { person_id: r.person_id } : {}) } });
  } catch (e: any) {
    log.warn('rule mark failed', { sourceId, error: String(e?.message ?? e).slice(0, 120) });
  }
}

/** After rule.set / rule.remove: re-mark his emails of the last 30 days in the Wiki under his current rules. */
export async function sweepRuleMarks(clientNumber: string, userId: number, now = new Date()): Promise<number> {
  const { listMarkedSources } = await import('../wiki/wikiStore');
  const { suziEmailRules } = await import('./suziEmailRules');
  const rules = await suziEmailRules(clientNumber, userId);
  const rows: any[] = await (listMarkedSources as any)(clientNumber, userId, { kinds: ['email'], since: new Date(now.getTime() - RULE_SWEEP_DAYS * 86_400_000), until: now, limit: 2000 });
  let n = 0;
  for (const r of rows) {
    const from = Array.isArray(r.participants) ? r.participants[0] : '';
    const had = (r.marks ?? []).filter((m: Mark) => m.kind === 'rule');
    const { ruleFor } = await import('./suziEmailRules');
    const want = rules.length ? ruleFor(rules, { from, subject: r.title }) : null;
    if (!want && had.length === 0) continue;
    if (want && had.length === 1 && had[0].key === want.id) continue;
    await markRulesOn({ clientNumber, userId }, r.id, { from, subject: r.title }, rules, r.marks ?? []);
    n += 1;
  }
  return n;
}
