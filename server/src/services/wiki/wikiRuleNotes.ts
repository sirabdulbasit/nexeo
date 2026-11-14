/**
 * Rule notes — every rule Nexeo and Suzi follow is a note in the Wiki
 * (docs/Wiki-Knowledge.md §0.9, §0.10, §0.13 part 9; docs/Rules.md).
 *
 * One note per rule, built from the stores that hold rules today, facts only,
 * no model. The stores stay the working copy that acts (Rules.md); the note is
 * the rule as knowledge: what it says in his words, what it applies to (linked
 * to the person or company note), what it does, who made it, whether it acts.
 *
 * The owner's ruling of 13 Nov 2026, 17:10 PKT decides "acts":
 *   - a rule, a delegation, a standing instruction, a permission: acts by itself;
 *   - a learned pattern: only suggests, never acts.
 *
 * A rule is carried over, never rebuilt from a feed: no feed holds what he
 * typed (Wiki-Knowledge §0.13). Each note carries the store and row it was read
 * from as its outside identifier, so a typed instruction and the email rule
 * made from it are one note.
 */
import prisma from '../../db/prisma';
import { writeNote, retireNote, normalizeIds, WIKI_GENERATION, type NoteInput } from './wikiStore';
import { cleanTitle, titleKey, wikiLink } from './wikiLinks';

export const RULE_ACTOR = 'wiki_rules';
export const RULE_TYPE = 'rule';

export type RuleKind = 'instruction' | 'rule' | 'delegation' | 'permission' | 'suggestion' | 'system';

/** A rule as read from its store, before it is a note. */
export interface RuleRow {
  kind: RuleKind;
  /** The store and row: `instruction:<id>`, `action_rule:<id>`, … */
  ids: string[];
  title: string;
  /** His own words, when he typed or said it. */
  words?: string | null;
  /** What it applies to: an email address, a domain, a phone, or plain words. */
  appliesTo?: { email?: string | null; domain?: string | null; phone?: string | null; text?: string | null };
  /** What it does, in plain words. */
  does: string;
  /** on | paused | off */
  status: 'on' | 'paused' | 'off';
  /** Who set it: 'him (My Rules)', 'him (Suzi)', 'Brain (learned)', 'Nexeo (system)', 'the company'. */
  setBy: string;
  setOn?: Date | string | null;
  /** The company's rule (every user of the client) rather than his own. */
  shared?: boolean;
  store: string;
  storeId: string;
  extra?: Record<string, unknown>;
}

/** A rule acts by itself unless it is a learned pattern, and only while it is on (owner, 13 Nov 2026). */
export function actsByItself(kind: RuleKind, status: RuleRow['status']): boolean {
  return kind !== 'suggestion' && status === 'on';
}

const KIND_WORDS: Record<RuleKind, string> = {
  instruction: 'Standing instruction',
  rule: 'Rule',
  delegation: 'Delegation',
  permission: 'Permission',
  suggestion: 'Learned pattern (suggests only)',
  system: 'System rule',
};

function day(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

/**
 * Rule rows in, notes out. Pure. `personByEmail` maps a mailbox to the title of
 * its person note, `companyByDomain` a domain to its company note, so a rule
 * links to what it is about.
 */
export function buildRuleNotes(
  rows: RuleRow[],
  ctx: { personByEmail: Map<string, string>; companyByDomain: Map<string, string> },
): Array<Omit<NoteInput, 'clientNumber' | 'userId' | 'actor'>> {
  // A typed instruction and the email rule read from it are one rule: fold rows that share an id.
  const merged: RuleRow[] = [];
  for (const r of rows) {
    const ids = normalizeIds(r.ids);
    const into = merged.find((m) => normalizeIds(m.ids).some((x) => ids.includes(x)));
    if (into) {
      into.ids = normalizeIds([...into.ids, ...ids]);
      into.extra = { ...(into.extra ?? {}), alsoIn: [...((into.extra?.alsoIn as string[]) ?? []), `${r.store} ${r.storeId}`] };
      if (into.kind === 'instruction' && r.kind === 'rule') into.does = `${into.does} Applied to his email as: ${r.does}`;
      continue;
    }
    merged.push({ ...r, ids });
  }

  // Titles are unique per note type and user: a repeated title gets the row it came from.
  const seen = new Map<string, number>();
  for (const r of merged) seen.set(titleKey(cleanTitle(r.title)), (seen.get(titleKey(cleanTitle(r.title))) ?? 0) + 1);

  return merged.map((r) => {
    const base = cleanTitle(r.title) || `${KIND_WORDS[r.kind]} ${r.storeId}`;
    const title = (seen.get(titleKey(base)) ?? 0) > 1 ? cleanTitle(`${base} (${r.storeId.slice(-6)})`) : base;
    const email = r.appliesTo?.email?.toLowerCase() ?? null;
    const domain = r.appliesTo?.domain?.toLowerCase() ?? (email ? email.split('@')[1] : null);
    const person = email ? ctx.personByEmail.get(email) : undefined;
    const company = domain ? ctx.companyByDomain.get(domain) : undefined;
    const applies = person ? wikiLink(person)
      : company && !email ? wikiLink(company)
        : r.appliesTo?.email ?? r.appliesTo?.phone ?? r.appliesTo?.domain ?? r.appliesTo?.text ?? null;
    const acts = actsByItself(r.kind, r.status);
    const lines = [
      `**Kind:** ${KIND_WORDS[r.kind]}`,
      `**Acts by itself:** ${acts ? 'yes' : r.kind === 'suggestion' ? 'no, it only suggests' : `no, it is ${r.status}`}`,
      `**Status:** ${r.status}`,
      ...(applies ? [`**Applies to:** ${applies}`] : []),
      ...(company && person ? [`**Company:** ${wikiLink(company)}`] : []),
      `**Does:** ${r.does}`,
      ...(r.words ? [`**In his words:** "${r.words.replace(/\s+/g, ' ').trim()}"`] : []),
      `**Set by:** ${r.setBy}${day(r.setOn) ? `, ${day(r.setOn)}` : ''}`,
      `**Kept in:** \`${r.store}\` ${r.storeId}${r.extra?.alsoIn ? `; also ${(r.extra.alsoIn as string[]).map((x) => `\`${x.split(' ')[0]}\` ${x.split(' ')[1]}`).join(', ')}` : ''}`,
    ];
    return {
      type: RULE_TYPE,
      title,
      body: lines.join('\n'),
      scope: r.shared ? ('tenant' as const) : ('user' as const),
      ids: r.ids,
      properties: {
        kind: r.kind, acts, status: r.status, store: r.store, storeId: r.storeId, setBy: r.setBy,
        setOn: day(r.setOn), words: r.words ?? null, appliesTo: email ?? r.appliesTo?.phone ?? domain ?? r.appliesTo?.text ?? null,
        ...(r.extra?.mode ? { mode: r.extra.mode } : {}),
      },
    };
  });
}

/** Read every rule of one user from the stores that hold rules today (docs/Rules.md). */
export async function loadRuleRows(clientNumber: string, userId: number): Promise<RuleRow[]> {
  const q = <T = any>(sql: string, ...args: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...args);
  const rows: RuleRow[] = [];

  // Standing instructions: his own, and the company's (client rules).
  for (const r of await q(
    `SELECT id, title, metadata FROM wiki_pages
      WHERE client_number = $1 AND page_type = 'instruction' AND status <> 'deleted'
        AND (COALESCE(metadata->>'scope','user') = 'client' OR user_id = $2)`,
    clientNumber, userId,
  )) {
    const m = r.metadata ?? {};
    const st = String(m.status ?? 'active');
    if (st === 'archived' || st === 'fulfilled') continue;
    rows.push({
      kind: 'instruction', ids: [`rule:instruction:${r.id}`], title: r.title, words: m.originalText ?? null,
      appliesTo: { text: m.subject ?? null }, does: [m.condition, m.action].filter(Boolean).join(' → ') || 'Followed in every answer and action.',
      status: st === 'paused' ? 'paused' : 'on', setBy: m.scope === 'client' ? 'the company (an admin)' : 'him (My Rules)',
      setOn: m.createdAt ?? null, shared: m.scope === 'client', store: 'wiki_pages instruction', storeId: r.id, extra: { mode: m.kind ?? null },
    });
  }

  // Action rules, Suzi's email rules among them. A removed rule (is_active false) is not a rule.
  for (const r of await q(
    `SELECT id, scope, name, nl_original, action_type, action_payload, mode, created_at FROM user_action_rules
      WHERE client_number = $1 AND is_active = TRUE AND (user_id = $2 OR scope = 'tenant')`,
    clientNumber, userId,
  )) {
    const s = r.action_payload?.suzi ?? {};
    const ids = [`rule:action_rule:${r.id}`, ...(s.instruction_id ? [`rule:instruction:${s.instruction_id}`] : [])];
    const delegate = s.kind === 'email_delegate';
    rows.push({
      kind: delegate ? 'delegation' : 'rule', ids, title: r.name, words: r.nl_original ?? s.note ?? null,
      appliesTo: s.kind === 'meeting_attend'
        ? (s.by === 'organizer' || s.by === 'attendee' ? { email: String(s.value ?? '') } : { text: s.by === 'title' ? `meeting title contains: ${s.value}` : 'every meeting with a join link' })
        : s.by === 'sender' ? { email: String(s.value ?? '') } : s.by === 'domain' ? { domain: String(s.value ?? '') } : { text: s.value ? `${s.by ?? 'match'}: ${s.value}` : null },
      does: delegate ? `Forward to ${s.person_name ?? s.person_email ?? 'the delegate'}${s.person_email ? ` (${s.person_email})` : ''}.` : s.kind === 'email_ignore' ? 'Mark ignored by this rule; send nothing.'
        : s.kind === 'meeting_attend' ? (s.attend === 'never' ? 'Never take notes at these meetings (F-4.2); never beats always.' : 'Take notes at these meetings (F-4.2), unless a never rule or his choice for that meeting says otherwise.')
        : `${r.action_type}`,
      status: 'on', setBy: s.by ? 'him (Suzi)' : 'him', setOn: r.created_at, shared: r.scope === 'tenant',
      store: 'user_action_rules', storeId: r.id, extra: { mode: r.mode },
    });
  }

  // Learned patterns: they only suggest (owner, 13 Nov 2026).
  for (const r of await q(
    `SELECT id, name, description, action, mode, trigger_condition, created_at FROM shadow_rules
      WHERE client_number = $1 AND user_id = $2 AND mode <> 'FROZEN'`,
    clientNumber, userId,
  )) {
    const t = r.trigger_condition ?? {};
    rows.push({
      kind: 'suggestion', ids: [`rule:pattern:${r.id}`], title: String(r.name).replace(/^auto:\s*/i, 'Learned: '),
      appliesTo: { domain: t.senderDomain ?? null, text: t.itemType ? `${t.itemType}s` : null },
      does: `Suggests "${r.action}" next time (${r.description ?? 'from his past choices'}).`,
      status: 'on', setBy: 'Brain (learned from his choices)', setOn: r.created_at, store: 'shadow_rules', storeId: r.id, extra: { mode: r.mode },
    });
  }

  // Muted senders: never surfaced.
  for (const r of await q(
    `SELECT id, channel, identifier, display_name, reason, created_at FROM muted_senders WHERE client_number = $1 AND user_id = $2`,
    clientNumber, userId,
  )) {
    const isEmail = r.channel === 'email';
    rows.push({
      kind: 'rule', ids: [`rule:muted:${r.id}`], title: `Muted: ${r.display_name || r.identifier}`,
      appliesTo: isEmail ? { email: r.identifier } : { phone: r.identifier }, does: `Never surfaced to him (${r.channel}).`,
      words: r.reason || null, status: 'on', setBy: 'him', setOn: r.created_at, store: 'muted_senders', storeId: r.id,
    });
  }

  // Who Nexeo may answer on WhatsApp: a decided policy is a permission; a pending one is not a rule yet.
  for (const r of await q(
    `SELECT phone, policy, display_name, decided_by, decided_at FROM wa_sender_policy
      WHERE client_number = $1 AND owner_user_id = $2 AND policy IN ('allowed','blocked')`,
    clientNumber, userId,
  )) {
    rows.push({
      kind: 'permission', ids: [`rule:wa_policy:${r.phone}`], title: `WhatsApp ${r.policy}: ${r.display_name || r.phone}`,
      appliesTo: { phone: r.phone }, does: r.policy === 'allowed' ? 'May be answered on WhatsApp.' : 'Never answered on WhatsApp.',
      status: 'on', setBy: r.decided_by === 'owner_decision' ? 'him' : 'Nexeo (from evidence)', setOn: r.decided_at,
      store: 'wa_sender_policy', storeId: r.phone,
    });
  }

  // Who owns which area.
  for (const r of await q(
    `SELECT id, area, owner_name, owner_email, escalate_to_name, notes, created_at FROM delegation_matrix WHERE client_number = $1 AND is_active = TRUE`,
    clientNumber,
  )) {
    rows.push({
      kind: 'delegation', ids: [`rule:delegation_matrix:${r.id}`], title: `Owner of ${r.area}`, appliesTo: { email: r.owner_email, text: r.area },
      does: `${r.owner_name ?? r.owner_email} owns ${r.area}${r.escalate_to_name ? `; escalates to ${r.escalate_to_name}` : ''}.`,
      words: r.notes ?? null, status: 'on', setBy: 'the company', setOn: r.created_at, shared: true, store: 'delegation_matrix', storeId: String(r.id),
    });
  }

  // Risk Radar and item-gate rules: Nexeo's own (system), the company's, and his.
  for (const [table, what] of [['risk_rules', 'Raises a flag on the Risk Radar'], ['gate_rules', 'Decides whether an email becomes an action item']] as const) {
    for (const r of await q(
      `SELECT id, scope, name, description, enabled, created_at FROM ${table}
        WHERE scope = 'system' OR client_number = $1 AND (scope = 'tenant' OR user_id = $2)`,
      clientNumber, userId,
    )) {
      const system = r.scope === 'system';
      rows.push({
        kind: system ? 'system' : 'rule', ids: [`rule:${table}:${r.id}`], title: r.name,
        does: `${what}: ${r.description ?? r.name}`, status: r.enabled ? 'on' : 'off',
        setBy: system ? 'Nexeo (system)' : r.scope === 'tenant' ? 'the company' : 'him', setOn: r.created_at,
        shared: r.scope !== 'user', store: table, storeId: String(r.id),
      });
    }
  }
  return rows;
}

/** Write one user's rule notes; retire those whose rule is gone. Returns counts. */
export async function rebuildRuleNotesForUser(clientNumber: string, userId: number): Promise<{ rules: number; written: number; unchanged: number; retired: number }> {
  const rows = await loadRuleRows(clientNumber, userId);
  const people = await prisma.wikiPage.findMany({
    where: { clientNumber, userId, status: 'active', pageType: { in: ['person', 'company'] }, metadata: { path: ['wiki'], equals: WIKI_GENERATION } },
    select: { title: true, pageType: true, metadata: true },
  });
  const personByEmail = new Map<string, string>();
  const companyByDomain = new Map<string, string>();
  for (const p of people as any[]) {
    for (const id of (p.metadata?.ids ?? []) as string[]) {
      if (p.pageType === 'person' && id.startsWith('email:')) personByEmail.set(id.slice(6), p.title);
      if (p.pageType === 'company' && id.startsWith('domain:')) companyByDomain.set(id.slice(7), p.title);
    }
  }
  // A company or system rule is one note for the whole client, written by one user (the client's
  // first active user); every user reads it as a shared note. Two users must not write two copies.
  const firstActive = await prisma.user.findFirst({ where: { clientNumber, isActive: true } as any, orderBy: { id: 'asc' }, select: { id: true } });
  const writesShared = firstActive?.id === userId;
  const notes = buildRuleNotes(rows, { personByEmail, companyByDomain }).filter((n) => n.scope !== 'tenant' || writesShared);
  const existing = await prisma.wikiPage.findMany({
    where: { clientNumber, userId, pageType: RULE_TYPE, lastUpdatedBy: RULE_ACTOR },
    select: { id: true, title: true, bodyMarkdown: true, status: true, metadata: true, scope: true },
  });
  const byTitle = new Map(existing.map((e: any) => [e.title, e]));
  const kept = new Set<string>();
  let written = 0;
  let unchanged = 0;
  for (const n of notes) {
    const have: any = byTitle.get(cleanTitle(n.title));
    if (have && have.status === 'active' && have.bodyMarkdown === n.body && have.scope === n.scope
      && JSON.stringify(normalizeIds(have.metadata?.ids)) === JSON.stringify(normalizeIds(n.ids))) {
      kept.add(have.id);
      unchanged += 1;
      continue;
    }
    const r = await writeNote({ ...n, clientNumber, userId, actor: RULE_ACTOR, exact: true });
    kept.add(r.id);
    written += 1;
  }
  let retired = 0;
  for (const e of existing as any[]) {
    if (kept.has(e.id) || e.status === 'superseded') continue;
    await retireNote(e.id, RULE_ACTOR);
    retired += 1;
  }
  return { rules: notes.length, written, unchanged, retired };
}
