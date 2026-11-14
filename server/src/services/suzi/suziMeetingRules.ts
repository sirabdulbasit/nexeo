/**
 * F-4.2 (charter, agreed 13 Nov 2026): his meeting-attendance rules, set by Suzi.
 *
 *   rule.set  {kind: "meeting_attend", match: {by: organizer | attendee | title | all, value?}, attend: always | never,
 *              note?} → {rule_id, rules_version, existing?}
 *   confirmed, unsigned, set only by him (voice or click). rule.remove {rule_id} is the shared one (suziEmailRules).
 *
 * Kept in Nexeo's one rule store (`user_action_rules`), at mode DRAFT with trigger 'manual', so the store's own
 * executor never fires it; only the meeting assistant reads it. Its name and nl_original are one readable line
 * ("Meetings organised by x@y.com: always take notes"), which My Rules, the pack's rules.action_rules and the
 * rule's Wiki note all show. The Wiki note is rebuilt right after a set (wikiRuleNotes), not only at the hourly
 * build.
 *
 * Matching: title contains, case-insensitive and trimmed; organizer and attendee by exact email, lowercase;
 * all = every event with a join link. never beats always; a single-meeting choice beats both; of two equal rules
 * the oldest rule_id is reported.
 */
import crypto from 'crypto';
import prisma from '../../db/prisma';

type Args = Record<string, unknown>;
type Result = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const fail = (error: string, detail?: string): Result => ({ ok: false, error, ...(detail ? { detail } : {}) });

export const MEETING_RULE_TYPE = 'suzi_meeting_attend';
export const MEETING_BY = ['organizer', 'attendee', 'title', 'all'] as const;
export type MeetingBy = (typeof MEETING_BY)[number];
export type Attend = 'always' | 'never';
export interface MeetingAttendRule { id: string; by: MeetingBy; value?: string; attend: Attend; note?: string; created_at?: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The one readable line for the rule, as My Rules, the pack and the Wiki note show it. */
export function meetingRuleText(by: MeetingBy, value: string | undefined, attend: Attend): string {
  const which = by === 'organizer' ? `Meetings organised by ${value}`
    : by === 'attendee' ? `Meetings with ${value}`
    : by === 'title' ? `Meetings with "${value}" in the title`
    : 'Every meeting with a join link';
  return `${which}: ${attend === 'always' ? 'always take notes' : 'never take notes'}`;
}

async function rulesVersion(clientNumber: string, userId: number): Promise<number | undefined> {
  const { rulesDocument } = await import('./suziRules');
  return (await rulesDocument(clientNumber, userId).catch(() => null))?.rules_version;
}

function refreshNote(clientNumber: string, userId: number): void {
  void import('../wiki/wikiRuleNotes').then(({ rebuildRuleNotesForUser }) => rebuildRuleNotesForUser(clientNumber, userId)).catch(() => undefined);
}

export async function meetingAttendSet(clientNumber: string, userId: number, a: Args, confirmed: boolean): Promise<Result> {
  if (!confirmed) return fail('needs_confirmation');
  const m: any = a.match && typeof a.match === 'object' ? a.match : {};
  const by = text(m.by).toLowerCase() as MeetingBy;
  if (!MEETING_BY.includes(by)) return fail('bad_rule', 'match is {by: organizer|attendee|title|all, value?}');
  const attend = text(a.attend).toLowerCase() as Attend;
  if (attend !== 'always' && attend !== 'never') return fail('bad_rule', 'attend is always or never');
  let value: string | undefined;
  if (by !== 'all') {
    value = text(m.value).toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
    if (!value) return fail('bad_rule', `a ${by} match needs a value`);
    if ((by === 'organizer' || by === 'attendee') && !EMAIL.test(value)) return fail('bad_rule', `an ${by} match is an email address`);
  }
  const note = text(a.note).slice(0, 500);
  const line = meetingRuleText(by, value, attend);
  const condition = { meeting: by, ...(value ? { value } : {}) };
  const payload = { suzi: { kind: 'meeting_attend', by, ...(value ? { value } : {}), attend, ...(note ? { note } : {}) } };
  // The same match again folds into his existing rule (its attend and note take the new values): one rule per match.
  const same = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM user_action_rules
      WHERE client_number = $1 AND user_id = $2 AND scope = 'user' AND is_active = TRUE AND action_type = $3
        AND trigger_condition = $4::jsonb
      ORDER BY created_at ASC LIMIT 1`,
    clientNumber, userId, MEETING_RULE_TYPE, JSON.stringify(condition),
  );
  let id: string;
  if (same[0]) {
    id = same[0].id;
    await prisma.$executeRawUnsafe(
      `UPDATE user_action_rules SET name = $2, nl_original = $3, action_payload = $4::jsonb, updated_at = now() WHERE id = $1`,
      id, line.slice(0, 200), (note ? `${line}. ${note}` : line).slice(0, 2000), JSON.stringify(payload),
    );
  } else {
    id = `uar_${crypto.randomBytes(6).toString('hex')}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO user_action_rules (id, client_number, user_id, scope, name, nl_original, trigger_kind, trigger_condition,
         action_type, action_payload, mode, confidence_threshold, is_active, created_by)
       VALUES ($1, $2, $3, 'user', $4, $5, 'manual', $6::jsonb, $7, $8::jsonb, 'DRAFT', 0.85, TRUE, $3)`,
      id, clientNumber, userId, line.slice(0, 200), (note ? `${line}. ${note}` : line).slice(0, 2000), JSON.stringify(condition), MEETING_RULE_TYPE, JSON.stringify(payload),
    );
  }
  refreshNote(clientNumber, userId);
  return { ok: true, item: { rule_id: id, kind: 'meeting_attend', match: { by, ...(value ? { value } : {}) }, attend, text: line, ...(same[0] ? { existing: true } : {}), rules_version: await rulesVersion(clientNumber, userId) } };
}

/** His active meeting-attendance rules, oldest first. */
export async function meetingAttendRules(clientNumber: string, userId: number): Promise<MeetingAttendRule[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; p: any; created_at: Date }>>(
    `SELECT id, action_payload->'suzi' AS p, created_at FROM user_action_rules
      WHERE client_number = $1 AND user_id = $2 AND scope = 'user' AND is_active = TRUE AND action_type = $3
      ORDER BY created_at, id`,
    clientNumber, userId, MEETING_RULE_TYPE,
  );
  return rows.filter((r) => r.p?.kind === 'meeting_attend').map((r) => ({ id: r.id, by: r.p.by, ...(r.p.value ? { value: r.p.value } : {}), attend: r.p.attend, ...(r.p.note ? { note: r.p.note } : {}), created_at: new Date(r.created_at).toISOString() }));
}

export interface AttendEvent { title?: string | null; organizer?: string | null; attendees?: Array<string | null | undefined>; hasJoinLink?: boolean; choice?: Attend | null }
export type AttendDecision = { decision: Attend | 'ask'; rule_id?: string };

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** The decision for one event. Rules are oldest first, as meetingAttendRules returns them. */
export function meetingAttendFor(rules: MeetingAttendRule[], ev: AttendEvent): AttendDecision {
  if (ev.choice === 'always' || ev.choice === 'never') return { decision: ev.choice }; // a single-meeting choice beats both
  const title = lower(ev.title).replace(/\s+/g, ' ');
  const org = lower(ev.organizer);
  const people = new Set((ev.attendees ?? []).map(lower).filter(Boolean));
  const hits = rules.filter((r) =>
    r.by === 'all' ? !!ev.hasJoinLink
      : r.by === 'title' ? !!r.value && title.includes(r.value)
      : r.by === 'organizer' ? !!r.value && org === r.value
      : r.by === 'attendee' ? !!r.value && people.has(r.value)
      : false);
  const never = hits.find((r) => r.attend === 'never'); // never beats always; the first is the oldest
  if (never) return { decision: 'never', rule_id: never.id };
  const always = hits.find((r) => r.attend === 'always');
  if (always) return { decision: 'always', rule_id: always.id };
  return { decision: 'ask' };
}
