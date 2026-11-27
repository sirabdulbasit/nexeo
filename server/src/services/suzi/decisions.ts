/**
 * D-327 (T49; Suzi-Builder 26 Nov 12:50 and 12:58, Nexeo AGREE 27 Nov). Founder 26 Nov: "Suzi will only be able to
 * think correctly if it has Knowledge, Actionable Items, Rules, Delegations, Past Decisions, Instructions: Nexeo Wiki."
 *
 * Past decisions, newest first: what he decided (through Suzi), and what Nexeo did by his rules or by itself.
 * Nothing is kept twice: the list is READ from where each decision was already recorded,
 *   - his acts through Suzi  (suzi_act_log, ok only; a held send is not a decision);
 *   - emails a rule forwarded (the forward's own record);
 *   - tasks the assistant step made from his sent mail (the task itself);
 * and written to his Wiki as the page "Past decisions", so a knowledge search on a person or topic finds how he
 * decided before. A rule that ignores an email is not listed per email (it is counted in emails_hidden.ignored):
 * the decision is the rule, and `rule_set` is in the list.
 */
import prisma from '../../db/prisma';
import { toZonedIso } from './zonedTime';

export interface PackDecision {
  at: string;
  kind: string;
  by: 'him' | 'suzi' | 'nexeo';
  about: { task_id?: string; thread_id?: string; email_id?: string; event_id?: string; person?: string; rule_id?: string; id?: string };
  what: string;
  why?: string;
}

export const DECISIONS_MAX = 50;
export const DECISION_OPS = [
  'task.update', 'task.create', 'task.followup', 'email.send', 'email.delegate', 'email.forward', 'email.mark',
  'rule.set', 'rule.remove', 'instruction.add', 'instruction.remove', 'delegation.set', 'delegation.remove',
  'calendar.create', 'calendar.update', 'calendar.cancel', 'proposal.dismiss', 'advice.feedback',
] as const;

export interface ActRow { op: string; args: any; result: any; at: Date; confirmed: boolean }
export interface DecisionContext {
  /** Email subjects by thread id. */
  subjects: Map<string, string>;
  /** Drafts by id: who it went to and its subject. */
  drafts: Map<string, { to: string; subject: string }>;
  /** T47 proposals by id: the task and the evidence. */
  proposals: Map<string, { task_id: string; title: string; why: string }>;
}

const q = (s: unknown, n = 120) => `"${String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)}"`;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** task.update's kinds that are decisions. A note, a rename and a new description change no course. */
const TASK_KIND: Record<string, string> = { done: 'done', move: 'moved', assign: 'delegated', forward: 'delegated', cancel: 'cancelled', reopen: 'reopened', take_back: 'taken_back', not_yet: 'not_yet', helper_add: 'helper_added', helper_remove: 'helper_removed' };

/** One act as a decision, or null when it is not one. Pure: every name and subject comes from the record. */
export function decisionOf(r: ActRow, ctx: DecisionContext, tz: string): PackDecision | null {
  const a = r.args ?? {};
  const item = r.result?.item ?? {};
  const base = { at: toZonedIso(r.at, tz), by: (r.confirmed ? 'him' : 'suzi') as PackDecision['by'] };
  const subj = (t: unknown) => ctx.subjects.get(str(t)) || '';

  if (r.op === 'task.update') {
    const upd = str(a.update) || str(a.action);
    const title = str(item.title);
    const id = str(a.id);
    const pid = str(a.proposal_id);
    if (pid && TASK_KIND[upd]) {
      const p = ctx.proposals.get(pid);
      return { ...base, kind: 'proposal_done', about: { task_id: id }, what: `Accepted a suggestion: ${upd === 'done' ? 'done' : `moved to ${str(a.due)}`}, ${q(title || p?.title)}`, ...(p?.why ? { why: p.why.slice(0, 300) } : {}) };
    }
    const kind = TASK_KIND[upd];
    if (!kind || !title) return null;
    const owner = str(item.owner);
    const what = upd === 'done' ? `Marked done: ${q(title)}`
      : upd === 'move' ? `Moved ${q(title)} to ${str(a.due)}`
      : upd === 'assign' || upd === 'forward' ? `Gave ${q(title)} to ${owner || 'someone'}`
      : upd === 'cancel' ? `Cancelled ${q(title)}`
      : upd === 'reopen' ? `Reopened ${q(title)}`
      : upd === 'take_back' ? `Took back ${q(title)}`
      : upd === 'not_yet' ? `Said not yet: ${q(title)}`
      : upd === 'helper_add' ? `Added a helper on ${q(title)}`
      : `Removed a helper on ${q(title)}`;
    return { ...base, kind, about: { task_id: id, ...(owner && owner !== 'me' && kind === 'delegated' ? { person: owner } : {}) }, what, ...(str(a.note) ? { why: str(a.note).slice(0, 300) } : {}) };
  }
  if (r.op === 'task.create') {
    const title = str(item.title) || str(a.title);
    if (!title) return null;
    const owner = str(item.owner);
    const given = !!owner && owner !== 'me';
    return { ...base, kind: given ? 'delegated' : 'task_created', about: { task_id: str(item.id), ...(given ? { person: owner } : {}) }, what: given ? `Gave ${owner} a task: ${q(title)}` : `Created a task: ${q(title)}` };
  }
  if (r.op === 'task.followup') {
    const title = str(item.title);
    if (!title) return null;
    const owner = str(item.owner);
    return { ...base, kind: 'followed_up', about: { task_id: str(a.id), ...(owner && owner !== 'me' ? { person: owner } : {}) }, what: `Followed up on ${q(title)}${owner && owner !== 'me' ? ` with ${owner}` : ''}` };
  }
  if (r.op === 'email.send') {
    if (item.sent !== true) return null; // held or saved as a draft: nothing was decided for anyone else to see
    const d = ctx.drafts.get(str(a.draft_id));
    if (!d) return null;
    return { ...base, kind: 'replied', about: { id: str(a.draft_id), ...(d.to ? { person: d.to } : {}) }, what: `Sent ${q(d.subject)}${d.to ? ` to ${d.to}` : ''}` };
  }
  if (r.op === 'email.forward' || r.op === 'email.delegate') {
    const to = str(item.to) || str(a.to) || str(item.person_name) || str(a.person_name);
    const thread = str(a.thread_id) || str(item.thread_id);
    const s = str(item.subject) || subj(thread);
    if (!to && !s) return null;
    return { ...base, kind: 'delegated', about: { ...(thread ? { thread_id: thread } : {}), ...(to ? { person: to } : {}) }, what: `Forwarded ${s ? q(s) : 'an email'}${to ? ` to ${to}` : ''}` };
  }
  if (r.op === 'email.mark') {
    const state = str(a.state);
    const thread = str(a.thread_id);
    if (!state || !thread) return null;
    return { ...base, kind: state === 'ignored' ? 'ignored' : 'handled', about: { thread_id: thread }, what: `Marked ${subj(thread) ? q(subj(thread)) : 'an email'} as ${state}` };
  }
  if (r.op === 'rule.set') {
    const m = a.match ?? item.match ?? {};
    const k = str(a.kind) || str(item.kind);
    if (!k) return null;
    const which = str(m.by) === 'subject' ? `with ${q(m.value, 80)} in the subject` : str(m.by) === 'to' ? `sent to ${str(m.value)}` : str(m.value) ? `from ${str(m.value)}` : '';
    const person = str(item.person_name) || str(a.person_name);
    return { ...base, kind: 'rule_set', about: { ...(str(item.rule_id) ? { rule_id: str(item.rule_id) } : {}), ...(person ? { person } : {}) }, what: `New rule: ${k === 'email_ignore' ? 'ignore' : k === 'email_delegate' ? `delegate${person ? ` to ${person}` : ''}` : k.replace(/_/g, ' ')}${which ? ` emails ${which}` : ''}` };
  }
  if (r.op === 'rule.remove') return { ...base, kind: 'rule_removed', about: { rule_id: str(a.rule_id) || str(a.id) }, what: 'Removed a rule' };
  if (r.op === 'instruction.add') {
    const text = str(a.text);
    return text ? { ...base, kind: 'instruction_added', about: { ...(str(item.id) ? { id: str(item.id) } : {}) }, what: `New standing instruction: ${text.slice(0, 240)}` } : null;
  }
  if (r.op === 'instruction.remove') return { ...base, kind: 'instruction_removed', about: { id: str(a.id) }, what: 'Removed a standing instruction' };
  if (r.op === 'delegation.set') {
    const area = str(a.area);
    return area ? { ...base, kind: 'delegation_set', about: { ...(str(item.owner) ? { person: str(item.owner) } : {}) }, what: `Delegation: ${area}${str(item.owner) ? ` goes to ${str(item.owner)}` : ''}` } : null;
  }
  if (r.op === 'delegation.remove') return str(a.area) ? { ...base, kind: 'delegation_removed', about: {}, what: `Removed the delegation for ${str(a.area)}` } : null;
  if (r.op === 'calendar.create' || r.op === 'calendar.update' || r.op === 'calendar.cancel') {
    const title = str(item.title) || str(a.title);
    if (!title) return null;
    const ev = str(item.event_id) || str(a.event_id);
    const kind = r.op === 'calendar.create' ? 'booked' : r.op === 'calendar.cancel' ? 'meeting_cancelled' : 'meeting_changed';
    const start = str(item.start) || str(a.start);
    return { ...base, kind, about: { ...(ev ? { event_id: ev } : {}) }, what: kind === 'booked' ? `Booked ${q(title)}${start ? ` for ${start.slice(0, 16).replace('T', ' ')}` : ''}` : kind === 'meeting_cancelled' ? `Cancelled the meeting ${q(title)}` : `Changed the meeting ${q(title)}` };
  }
  if (r.op === 'proposal.dismiss') {
    const p = ctx.proposals.get(str(a.id));
    return { ...base, kind: 'proposal_dismissed', about: { id: str(a.id), ...(p ? { task_id: p.task_id } : {}) }, what: `Dismissed a suggestion${p ? ` on ${q(p.title)}` : ''}`, ...(p?.why ? { why: p.why.slice(0, 300) } : {}) };
  }
  if (r.op === 'advice.feedback') {
    const verdict = str(a.verdict);
    if (!verdict) return null;
    return { ...base, kind: 'advice_feedback', about: { id: str(a.id) }, what: `Marked advice ${verdict.replace(/_/g, ' ')}${str(a.what) || str(item.what) ? `: ${(str(a.what) || str(item.what)).slice(0, 200)}` : ''}` };
  }
  return null;
}

/** Newest first, the same decision never twice, at most `limit`. */
export function mergeDecisions(lists: PackDecision[][], limit: number = DECISIONS_MAX): PackDecision[] {
  const seen = new Set<string>();
  const out: PackDecision[] = [];
  for (const d of lists.flat().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const key = `${d.at}|${d.kind}|${d.what}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out.slice(0, limit);
}

/** His past decisions for the pack. `days` back, newest `limit`. */
export async function packDecisions(clientNumber: string, userId: number, tz: string, opts: { limit?: number; days?: number } = {}): Promise<PackDecision[]> {
  const days = opts.days ?? 60;
  const since = new Date(Date.now() - days * 24 * 3600_000);
  const acts = await prisma.$queryRawUnsafe<Array<{ op: string; args: any; result: any; created_at: Date; confirmed_by_user: boolean | null }>>(
    `SELECT op, args, result, created_at, confirmed_by_user FROM suzi_act_log
      WHERE client_number = $1 AND user_id = $2 AND status = 'ok' AND op = ANY($3::text[]) AND created_at >= $4
      ORDER BY created_at DESC LIMIT 400`,
    clientNumber, userId, DECISION_OPS as unknown as string[], since,
  );
  const threads = [...new Set(acts.map((r) => str(r.args?.thread_id)).filter(Boolean))];
  const draftIds = [...new Set(acts.filter((r) => r.op === 'email.send').map((r) => Number(r.args?.draft_id)).filter((n) => Number.isInteger(n)))];
  const proposalIds = [...new Set(acts.map((r) => str(r.op === 'proposal.dismiss' ? r.args?.id : r.args?.proposal_id)).filter(Boolean))];
  const [subjRows, draftRows, propRows, byRule, made] = await Promise.all([
    threads.length
      ? prisma.$queryRawUnsafe<Array<{ thread_key: string; title: string | null }>>(
          `SELECT DISTINCT ON (thread_key) thread_key, title FROM wiki_sources
            WHERE client_number = $1 AND user_id = $2 AND kind = 'email' AND thread_key = ANY($3::text[]) ORDER BY thread_key, occurred_at ASC`,
          clientNumber, userId, threads,
        ).catch(() => [])
      : [],
    draftIds.length
      ? prisma.$queryRawUnsafe<Array<{ id: number; to: string | null; subject: string | null }>>(
          `SELECT id, output->>'to' AS to, output->>'subject' AS subject FROM agent_actions WHERE client_number = $1 AND user_id = $2 AND id = ANY($3::int[])`,
          clientNumber, userId, draftIds,
        ).catch(() => [])
      : [],
    proposalIds.length
      ? prisma.$queryRawUnsafe<Array<{ id: string; title: string; pid: string; why: string | null }>>(
          `SELECT o.id, o.title, x->>'id' AS pid, x->>'why' AS why FROM open_items o, jsonb_array_elements(COALESCE(o.metadata->'proposals', '[]'::jsonb)) x
            WHERE o.client_number = $1 AND o.user_id = $2 AND x->>'id' = ANY($3::text[])`,
          clientNumber, userId, proposalIds,
        ).catch(() => [])
      : [],
    import('./suziEmailRules').then((m) => m.delegatedByRule(clientNumber, userId, since)).catch(() => []),
    prisma.$queryRawUnsafe<Array<{ id: string; title: string; created_at: Date; watch: any }>>(
      `SELECT id, title, created_at, metadata->'watch' AS watch FROM open_items
        WHERE client_number = $1 AND user_id = $2 AND metadata ? 'assistantKey' AND created_at >= $3 ORDER BY created_at DESC LIMIT 100`,
      clientNumber, userId, since,
    ).catch(() => []),
  ]);
  const ctx: DecisionContext = {
    subjects: new Map(subjRows.map((r) => [r.thread_key, String(r.title ?? '')])),
    drafts: new Map(draftRows.map((r) => [String(r.id), { to: String(r.to ?? ''), subject: String(r.subject ?? '') }])),
    proposals: new Map(propRows.map((r) => [r.pid, { task_id: r.id, title: r.title, why: String(r.why ?? '') }])),
  };
  const his = acts.map((r) => decisionOf({ op: r.op, args: r.args, result: r.result, at: r.created_at, confirmed: r.confirmed_by_user === true }, ctx, tz)).filter((d): d is PackDecision => !!d);
  const rule: PackDecision[] = byRule
    .filter((d) => !d.state || d.state === 'sent')
    .map((d) => {
      const t = new Date(d.at);
      return isNaN(t.getTime()) ? null : { at: toZonedIso(t, tz), kind: 'rule_delegated', by: 'nexeo' as const, about: { thread_id: d.thread_id, rule_id: d.rule_id, ...(d.task_id ? { task_id: d.task_id } : {}), ...(d.person_name ? { person: d.person_name } : {}) }, what: `Forwarded ${q(d.subject)} to ${d.person_name || 'the person in your rule'}, by your rule` };
    })
    .filter((d): d is NonNullable<typeof d> => !!d);
  const mine: PackDecision[] = made.map((t) => {
    const who = str(t.watch?.person) && !str(t.watch?.person).includes('@') ? str(t.watch.person) : '';
    return { at: toZonedIso(t.created_at, tz), kind: 'task_created', by: 'nexeo' as const, about: { task_id: t.id, ...(who ? { person: who } : {}) }, what: t.watch ? `Started watching what you asked${who ? ` ${who}` : ''}: ${q(t.title)}` : `Made a task from your own email: ${q(t.title)}` };
  });
  // T53: a follow-up Nexeo sent by his standing rule, one day before the deadline.
  const chased: PackDecision[] = (await import('./chase').then((m) => m.chaseDecisions(clientNumber, userId, since)).catch(() => []))
    .filter((c) => c.people.length && !isNaN(Date.parse(c.at)))
    .map((c) => ({ at: toZonedIso(new Date(c.at), tz), kind: 'followed_up', by: 'nexeo' as const, about: { task_id: c.task_id, person: c.people.join(', ') }, what: `Followed up by rule: one day before the deadline, ${c.people.join(', ')} on ${q(c.title)}` }));
  return mergeDecisions([his, rule, mine, chased], opts.limit ?? DECISIONS_MAX);
}

/** The page's text: one decision per line, newest first, grouped by day. */
export function decisionsPageBody(list: PackDecision[]): string {
  const lines: string[] = ['How he decided before, newest first. Read from his own acts, his rules and the assistant step.', ''];
  let day = '';
  for (const d of list) {
    const dd = d.at.slice(0, 10);
    if (dd !== day) { day = dd; lines.push('', `## ${dd}`); }
    const who = d.by === 'him' ? 'He' : d.by === 'suzi' ? 'Suzi' : 'Nexeo';
    lines.push(`- ${d.at.slice(11, 16)} ${who}: ${d.what}${d.about.person && !d.what.includes(d.about.person) ? ` (${d.about.person})` : ''}${d.why ? `. Why: ${d.why}` : ''}`);
  }
  return lines.join('\n');
}

/**
 * His Wiki page "Past decisions" (the newest 200 of the last 180 days). Written only when it changed, so a run that
 * finds nothing new writes nothing. Returns whether it wrote.
 */
export async function writeDecisionsPage(clientNumber: string, userId: number, tz: string = 'Asia/Karachi'): Promise<{ wrote: boolean; count: number }> {
  const list = await packDecisions(clientNumber, userId, tz, { limit: 200, days: 180 });
  if (!list.length) return { wrote: false, count: 0 };
  const body = decisionsPageBody(list);
  const { createHash } = await import('crypto');
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 32);
  const id = `decisions:user:${userId}`;
  const had = await prisma.$queryRawUnsafe<Array<{ h: string | null }>>(
    `SELECT metadata->'properties'->>'decisions_hash' AS h FROM wiki_pages WHERE client_number = $1 AND user_id = $2 AND status = 'active' AND metadata->'ids' ? $3 LIMIT 1`,
    clientNumber, userId, id,
  ).catch(() => [] as Array<{ h: string | null }>);
  if (had[0]?.h === hash) return { wrote: false, count: list.length };
  const { writeNote } = await import('../wiki/wikiStore');
  await writeNote({
    clientNumber, userId, type: 'decision', title: 'Past decisions', scope: 'user', actor: 'nexeo', body,
    properties: { decisions_hash: hash, decisions_count: list.length, newest_at: list[0].at }, ids: [id],
  } as any);
  return { wrote: true, count: list.length };
}
