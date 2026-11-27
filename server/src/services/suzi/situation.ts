/**
 * D-328 (T48, proposed by Suzi-Builder 26 Nov 12:51, Nexeo AGREE 27 Nov in T49). Founder 26 Nov: "Suzi/Nexeo should
 * know everything: what is new, what has been done/sent and what should be done. Suzi/Nexeo is not only a robotic
 * operator, it is my living assistant and advisor as well."
 *
 * One current picture in the day pack, built from the parts the pack already read (no second read of anything):
 *   new    what arrived since he last looked (seen.update), newest first
 *   done   today and yesterday, whoever did it: him, Suzi or Nexeo
 *   to_do  ranked, each with why and what it rests on: replies he owes, his tasks, what he gave others
 *   advice at most 3, written by the advisor step (advisor.ts), each resting on facts he can open
 *
 * new, done and to_do are computed, never judged by a model: every word in them comes from a record.
 */
import type { SuziAction } from './suziActions';
import type { PackEmail, PackFyi } from './dayPack';
import type { PackLevelProposal } from './proposals';
import type { RecordedMeeting } from './packMeetings';
import type { PackDecision } from './decisions';

export type Ref = { email_id?: string; thread_id?: string; task_id?: string; meeting_id?: string; event_id?: string; proposal_id?: string; job_id?: string; id?: string };
export interface SituationNew { at: string; kind: 'email' | 'reply' | 'meeting_record' | 'task_change' | 'proposal' | 'job_result'; what: string; ref: Ref }
export interface SituationDone { at: string; by: 'him' | 'suzi' | 'nexeo'; kind: 'sent' | 'task_update' | 'delegated' | 'ignored' | 'decided' | 'booked'; what: string; to?: string; ref: Ref }
export interface SituationToDo { rank: number; what: string; why: string; due?: string; ref: Ref; risk?: 'slipping' | 'overdue' | 'waiting_long' | 'no_owner'; goal?: string }
export interface SituationAdvice { id: string; what: string; why: string; rests_on: string[]; goal?: string }
export interface Situation { as_of: string; seen_at: string | null; new: SituationNew[]; done: SituationDone[]; to_do: SituationToDo[]; advice: SituationAdvice[] }

export const NEW_MAX = 20;
export const DONE_MAX = 30;
export const TODO_MAX = 12;
export const ADVICE_MAX = 3;
/** With no "seen" on record, new means the last day. */
export const NEW_DEFAULT_MS = 24 * 3600_000;
export const WAITING_LONG_DAYS = 3;

const DONE_KIND: Record<string, SituationDone['kind']> = {
  replied: 'sent',
  done: 'task_update', moved: 'task_update', cancelled: 'task_update', reopened: 'task_update', not_yet: 'task_update', taken_back: 'task_update',
  helper_added: 'task_update', helper_removed: 'task_update', proposal_done: 'task_update', followed_up: 'sent',
  delegated: 'delegated', rule_delegated: 'delegated',
  ignored: 'ignored', handled: 'ignored', proposal_dismissed: 'ignored',
  booked: 'booked', meeting_changed: 'booked', meeting_cancelled: 'booked',
};

const ms = (v: unknown) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : NaN; };
const cut = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface SituationParts {
  now: Date; asOf: string; today: string;
  /** When he last looked (the newest seen.update), or null. */
  seenAt: Date | null;
  actions: SuziAction[]; emails: PackEmail[]; fyi: PackFyi[]; proposals: PackLevelProposal[]; recorded: RecordedMeeting[];
  decisions: PackDecision[];
  /** The advisor's stored advice (advisor.ts), already limited to what he has not marked. */
  advice?: SituationAdvice[];
  /** Which goal an item serves, by ref key ("task:<id>", "email:<thread>"), from the advisor step. */
  goals?: Map<string, string>;
  /** Results of scheduled jobs (T50), newest first. */
  jobs?: Array<{ at: string; job_id: string; what: string }>;
}

/** What is new to him: after his last look, or the last day when he never looked. Newest first, at most 20. */
export function situationNew(p: SituationParts): SituationNew[] {
  const since = p.seenAt ? p.seenAt.getTime() : p.now.getTime() - NEW_DEFAULT_MS;
  const out: SituationNew[] = [];
  const after = (at: unknown) => { const t = ms(at); return Number.isFinite(t) && t > since && t <= p.now.getTime() + 60_000; };
  for (const e of p.emails) {
    if (e.by_rule || !after(e.received_at)) continue;
    out.push({ at: e.received_at, kind: 'email', what: cut(`${e.from}: ${e.subject}`, 200), ref: { thread_id: e.thread_id } });
  }
  for (const f of p.fyi) {
    if (!after(f.received_at)) continue;
    out.push({ at: f.received_at, kind: 'email', what: cut(`For your knowledge, ${f.from}: ${f.subject}`, 200), ref: { email_id: f.email_id, thread_id: f.thread_id } });
  }
  for (const a of p.actions) {
    const lu = a.last_update;
    if (!lu || !after(lu.at)) continue;
    const who = String(lu.who ?? '');
    if (/^you\b/i.test(who)) continue; // his own change is not news to him
    const reply = /repl/i.test(lu.change);
    out.push({ at: lu.at, kind: reply ? 'reply' : 'task_change', what: cut(`${who ? `${who}: ` : ''}${lu.change} on "${a.title}"`, 200), ref: { task_id: a.id } });
  }
  for (const m of p.recorded) {
    if (m.outcome !== 'record_ready' || !after(m.updated_at)) continue;
    out.push({ at: m.updated_at, kind: 'meeting_record', what: cut(`The record of "${m.title}" is ready${m.action_items_proposed ? `, ${m.action_items_proposed} action item${m.action_items_proposed === 1 ? '' : 's'} proposed` : ''}`, 200), ref: { meeting_id: m.meeting_id } });
  }
  const proposals: Array<{ id: string; why: string; task_id: string; title: string }> = [
    ...p.proposals.map((x) => ({ id: x.id, why: x.why, task_id: x.task.id, title: x.task.title })),
    ...p.actions.flatMap((a) => (a.proposals ?? []).map((x) => ({ id: x.id, why: x.why, task_id: a.id, title: a.title }))),
  ];
  // A suggestion carries no time of its own in the pack; it is new for as long as it is open and unseen is unknown,
  // so it is listed once, at the pack's time, only when he has never looked or looked before today.
  if (!p.seenAt || p.seenAt.toISOString().slice(0, 10) < p.now.toISOString().slice(0, 10)) {
    for (const x of proposals.slice(0, 5)) out.push({ at: p.asOf, kind: 'proposal', what: cut(`Suggestion on "${x.title}": ${x.why}`, 200), ref: { task_id: x.task_id, proposal_id: x.id } });
  }
  for (const j of p.jobs ?? []) if (after(j.at)) out.push({ at: j.at, kind: 'job_result', what: cut(j.what, 600), ref: { job_id: j.job_id } });
  return out.sort((a, b) => ms(b.at) - ms(a.at)).slice(0, NEW_MAX);
}

/** Today and yesterday, whoever did it. Newest first, at most 30. */
export function situationDone(p: SituationParts): SituationDone[] {
  const from = addDay(p.today, -1);
  return p.decisions
    .filter((d) => d.at.slice(0, 10) >= from && d.at.slice(0, 10) <= p.today)
    .map((d) => {
      const { person, ...ref } = d.about;
      return { at: d.at, by: d.by, kind: DONE_KIND[d.kind] ?? 'decided', what: d.what, ...(person ? { to: person } : {}), ref: ref as Ref };
    })
    .slice(0, DONE_MAX);
}

/**
 * What he should do, ranked. One scale, highest first:
 *   his own task overdue 100 + days late (max +30) · a reply he owes, critical 90 / else 60, + days waiting (max +20)
 *   his own task due today 80 · someone else's task overdue 70 + days late (max +20) · his own task due tomorrow 50
 *   his own task with no deadline 20. A task with a suggestion waiting gains 5 (one click settles it).
 * An item that serves one of his goals gains 15 and says which.
 */
export function situationToDo(p: SituationParts): SituationToDo[] {
  const rows: Array<Omit<SituationToDo, 'rank'> & { score: number }> = [];
  const goalOf = (key: string) => p.goals?.get(key);
  for (const a of p.actions) {
    const mine = a.owner === 'me';
    const late = a.due ? dayDiff(p.today, a.due) : 0;
    const bump = (a.proposals?.length ? 5 : 0);
    const ref: Ref = { task_id: a.id };
    const goal = goalOf(`task:${a.id}`);
    const g = goal ? { goal } : {};
    if (mine && a.due && late > 0) rows.push({ score: 100 + Math.min(late, 30) + bump, what: a.title, why: `Yours, due ${a.due}, ${late} day${late === 1 ? '' : 's'} overdue`, due: a.due, ref, risk: 'overdue', ...g });
    else if (mine && a.due && late === 0) rows.push({ score: 80 + bump, what: a.title, why: 'Yours, due today', due: a.due, ref, ...g });
    else if (mine && a.due && late === -1) rows.push({ score: 50 + bump, what: a.title, why: 'Yours, due tomorrow', due: a.due, ref, ...g });
    else if (mine && !a.due) rows.push({ score: 20 + bump, what: a.title, why: 'Yours, with no deadline', ref, risk: 'no_owner', ...g });
    else if (!mine && a.due && late > 0) rows.push({ score: 70 + Math.min(late, 20) + bump, what: `Follow up with ${a.owner}: ${a.title}`, why: `With ${a.owner}, due ${a.due}, ${late} day${late === 1 ? '' : 's'} overdue`, due: a.due, ref, risk: 'slipping', ...g });
  }
  for (const e of p.emails) {
    if (e.by_rule) continue;
    const waited = Math.max(0, Math.floor((p.now.getTime() - ms(e.received_at)) / 86_400_000)) || 0;
    const critical = /critical|high|urgent/i.test(String(e.urgency));
    const goal = goalOf(`email:${e.thread_id}`);
    rows.push({
      score: (critical ? 90 : 60) + Math.min(waited, 20),
      what: cut(`Reply to ${e.from}: ${e.subject}`, 200),
      why: cut(`${e.point || e.summary || 'Needs your answer'}${waited >= 1 ? `. Waiting ${waited} day${waited === 1 ? '' : 's'}` : ''}`, 300),
      ref: { thread_id: e.thread_id, ...(e.task_id ? { task_id: e.task_id } : {}) },
      ...(waited >= WAITING_LONG_DAYS ? { risk: 'waiting_long' as const } : {}),
      ...(goal ? { goal } : {}),
    });
  }
  for (const r of rows) if (r.goal) r.score += 15;
  return rows
    .sort((a, b) => b.score - a.score || String(a.due ?? '9999').localeCompare(String(b.due ?? '9999')) || a.what.localeCompare(b.what))
    .slice(0, TODO_MAX)
    .map(({ score: _s, ...r }, i) => ({ rank: i + 1, ...r }));
}

export function buildSituation(p: SituationParts): Situation {
  return {
    as_of: p.asOf,
    seen_at: p.seenAt ? p.seenAt.toISOString() : null,
    new: situationNew(p),
    done: situationDone(p),
    to_do: situationToDo(p),
    advice: (p.advice ?? []).slice(0, ADVICE_MAX),
  };
}
