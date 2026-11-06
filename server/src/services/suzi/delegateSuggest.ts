/**
 * Link T24 (both AGREE, 6 Nov 2026): who a task could go to, for Suzi to offer. A read, built by code
 * with no model: the user's own delegation rules and his own past delegations. It ends, on his click or
 * spoken choice, in `task.update {update: "assign", person_id}`; nothing here assigns or tells anyone.
 *
 *   rule           the company's delegation table, when its area appears as a whole word or phrase in the
 *                  task's title; and his own per-type routing list (route "delegate"), on the task's type
 *   past_practice  how often HE has delegated to that person: tasks (including a person later replaced) and
 *                  email delegations, counted once each. Never anyone else's, and never called "similar"
 *
 * Everyone is matched to his own contacts by email, so `person_id` is always one `task.update` assign takes.
 * Whoever can't be matched is counted in `skipped`, never returned. Any source that can't be read makes
 * `checked: false`, so an empty list with `checked: true` honestly means nothing on record.
 */
import prisma from '../../db/prisma';
import { displayName } from './suziPeople';

export const MAX_SUGGESTIONS = 3;

export interface Suggestion {
  person_id: string; name: string; email: string; reason: string; source: 'rule' | 'past_practice';
  rule?: { kind: 'area'; area: string } | { kind: 'type'; item_type: string };
  count?: number; last_at?: string;
}
export type SuggestAnswer =
  | { ok: true; suggestions: Suggestion[]; skipped: number; checked: boolean }
  | { ok: false; error: 'not_found' | 'bad_state'; detail: string };

type RuleHit = { email: string | null; rule: NonNullable<Suggestion['rule']> };
type Past = { email: string; n: number; first_at: Date; last_at: Date };

const FINISHED = ['CLOSED', 'CANCELLED'];
const norm = (e: string | null | undefined) => String(e ?? '').trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The area as a whole word or phrase of the title, any case. "AP" doesn't match "apple". */
export function areaInTitle(area: string, title: string): boolean {
  const a = area.trim();
  if (a.length < 2) return false;
  const words = a.split(/\s+/).map(escapeRe).join('\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${words}($|[^\\p{L}\\p{N}])`, 'iu').test(title);
}

const shortDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function pastReason(p: Pick<Past, 'n' | 'first_at' | 'last_at'>): string {
  return p.n === 1 ? `You delegated to them once, on ${shortDate(p.last_at)}` : `You've delegated to them ${p.n} times since ${shortDate(p.first_at)}`;
}

export function ruleReason(r: Suggestion['rule']): string {
  return r!.kind === 'area' ? `Delegation rule: ${r!.area}` : `Delegation rule for ${r!.item_type} items`;
}

async function ruleHits(clientNumber: string, userId: number, task: { title: string; type: string }): Promise<RuleHit[]> {
  const [matrix, config] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ area: string; owner_email: string | null }>>(
      `SELECT area, owner_email FROM delegation_matrix WHERE client_number = $1 AND is_active = TRUE ORDER BY area`,
      clientNumber,
    ),
    prisma.brainConfig.findFirst({ where: { userId, clientNumber }, select: { delegationRules: true } }),
  ]);
  const hits: RuleHit[] = matrix
    .filter((m) => areaInTitle(m.area, task.title))
    .map((m) => ({ email: m.owner_email, rule: { kind: 'area' as const, area: m.area } }));
  const perType = Array.isArray(config?.delegationRules) ? (config!.delegationRules as any[]) : [];
  for (const r of perType) {
    if (r?.route !== 'delegate' || norm(r?.itemType) !== norm(task.type)) continue;
    hits.push({ email: typeof r.assigneeEmail === 'string' ? r.assigneeEmail : null, rule: { kind: 'type', item_type: String(r.itemType) } });
  }
  return hits;
}

/**
 * His own delegations, one per item and person: the task's current delegate, everyone in its trail (so a
 * person later replaced still counts), and email delegations not already counted through a task.
 */
async function pastPractice(clientNumber: string, userId: number): Promise<Past[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ email: string; n: number; first_at: Date; last_at: Date }>>(
    `WITH items AS (
       SELECT o.id AS item_id, lower(o.delegatee_email) AS email, o.source_feed_event_id AS fe,
              COALESCE((SELECT max(h.created_at) FROM item_status_history h
                         WHERE h.open_item_id = o.id AND h.client_number = $1 AND h.to_status = 'DELEGATED' AND h.outcome = 'accepted'),
                       o.created_at) AS at
         FROM open_items o
        WHERE o.client_number = $1 AND o.user_id = $2 AND o.delegatee_email IS NOT NULL
       UNION ALL
       SELECT o.id, lower(COALESCE(t->>'delegatedToEmail', CASE WHEN t->>'to' LIKE '%@%' THEN t->>'to' END)), o.source_feed_event_id,
              COALESCE(CASE WHEN t->>'delegatedAt' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (t->>'delegatedAt')::timestamptz END,
                       CASE WHEN t->>'at' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (t->>'at')::timestamptz END,
                       o.created_at)
         FROM open_items o
         CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.delegation_trail::jsonb) = 'array' THEN o.delegation_trail::jsonb ELSE '[]'::jsonb END) t
        WHERE o.client_number = $1 AND o.user_id = $2
     ),
     per_item AS (
       SELECT item_id, email, max(fe) AS fe, min(at) AS at FROM items
        WHERE email IS NOT NULL AND email <> '' GROUP BY item_id, email
     ),
     logs AS (
       SELECT lower(l.delegatee_email) AS email, l.created_at AS at FROM delegation_logs l
        WHERE l.client_number = $1 AND l.user_id = $2 AND l.delegatee_email IS NOT NULL AND l.delegatee_email <> ''
          AND NOT EXISTS (SELECT 1 FROM per_item p WHERE p.email = lower(l.delegatee_email) AND p.fe IS NOT NULL AND p.fe = l.entity_id)
     )
     SELECT email, count(*)::int AS n, min(at) AS first_at, max(at) AS last_at
       FROM (SELECT email, at FROM per_item UNION ALL SELECT email, at FROM logs) x
      GROUP BY email`,
    clientNumber, userId,
  );
  return rows.map((r) => ({ email: r.email, n: Number(r.n), first_at: new Date(r.first_at), last_at: new Date(r.last_at) }));
}

/** His own contacts by email. One email on several of his contacts: the verified one, then the most recently seen. */
async function contactsByEmail(clientNumber: string, userId: number, emails: string[]): Promise<Map<string, { id: string; name: string }>> {
  if (!emails.length) return new Map();
  const rows = await prisma.$queryRawUnsafe<Array<{ email: string; id: string; name: string }>>(
    `SELECT DISTINCT ON (lower(f.facet_value)) lower(f.facet_value) AS email, p.id, p.display_name AS name
       FROM person_facets f JOIN persons p ON p.id = f.person_id
      WHERE p.client_number = $1 AND p.user_id = $2 AND f.facet_type = 'email' AND lower(f.facet_value) = ANY($3::text[])
      ORDER BY lower(f.facet_value), f.verified DESC, f.last_seen_at DESC NULLS LAST, p.id`,
    clientNumber, userId, emails,
  );
  return new Map(rows.map((r) => [r.email, { id: r.id, name: displayName(r.name) }]));
}

export async function suggestDelegates(clientNumber: string, userId: number, taskId: string): Promise<SuggestAnswer> {
  const task = taskId && taskId.length <= 100
    ? await prisma.openItem.findFirst({ where: { id: taskId, clientNumber, userId }, select: { title: true, type: true, status: true, delegateeEmail: true } })
    : null;
  if (!task) return { ok: false, error: 'not_found', detail: 'no such task' };
  if (FINISHED.includes(String(task.status ?? '').toUpperCase())) return { ok: false, error: 'bad_state', detail: 'it is finished or cancelled; reopen it first' };

  let checked = true;
  const [rules, past, me] = await Promise.all([
    ruleHits(clientNumber, userId, { title: task.title ?? '', type: task.type ?? '' }).catch(() => { checked = false; return [] as RuleHit[]; }),
    pastPractice(clientNumber, userId).catch(() => { checked = false; return [] as Past[]; }),
    prisma.user.findFirst({ where: { id: userId, clientNumber }, select: { email: true, integrationEmail: true } }).catch(() => null),
  ]);
  const excluded = new Set([norm(me?.email), norm(me?.integrationEmail), norm(task.delegateeEmail)].filter(Boolean));
  const pastBy = new Map(past.map((p) => [p.email, p]));

  // One candidate per email, best first: rules in order, then his own past practice by count, then most recent.
  type Cand = { email: string | null; rule?: Suggestion['rule']; past?: Past };
  const cands: Cand[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    const e = norm(r.email);
    if (e && (excluded.has(e) || seen.has(e))) continue;
    if (e) seen.add(e);
    cands.push({ email: e || null, rule: r.rule, past: e ? pastBy.get(e) : undefined });
  }
  for (const p of [...past].sort((a, b) => b.n - a.n || b.last_at.getTime() - a.last_at.getTime())) {
    if (excluded.has(p.email) || seen.has(p.email)) continue;
    seen.add(p.email);
    cands.push({ email: p.email, past: p });
  }

  let contacts = new Map<string, { id: string; name: string }>();
  try {
    contacts = await contactsByEmail(clientNumber, userId, cands.map((c) => c.email).filter((e): e is string => !!e));
  } catch {
    return { ok: true, suggestions: [], skipped: 0, checked: false };
  }

  const suggestions: Suggestion[] = [];
  const shown = new Set<string>();
  let skipped = 0;
  // `skipped` counts only those that would have been shown: ranked above the last suggestion returned.
  for (const c of cands) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    const person = c.email ? contacts.get(c.email) : undefined;
    if (!person || !c.email) { skipped += 1; continue; }
    if (shown.has(person.id)) continue;
    shown.add(person.id);
    suggestions.push({
      person_id: person.id, name: person.name, email: c.email,
      reason: c.rule ? ruleReason(c.rule) : pastReason(c.past!),
      source: c.rule ? 'rule' : 'past_practice',
      ...(c.rule ? { rule: c.rule } : {}),
      ...(c.past ? { count: c.past.n, last_at: c.past.last_at.toISOString() } : {}),
    });
  }
  return { ok: true, suggestions, skipped, checked };
}
