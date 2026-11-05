/**
 * DEF-385 (CL-063) — the Action Center for Suzi. Suzi's server reads a user's pending
 * actions and records their answers to follow-ups ("done", "move it to Friday",
 * "cancel it", "not yet"), so Suzi can drop its sample data.
 *
 *   listPendingActions  the user's open actions (not emails), most urgent first
 *   applyFollowUp       done / move / not_yet → recordActionLifecycleReply (the one path for the
 *                       owner's own answer: his done is the approval, DEF-281); cancel →
 *                       changeStatus CANCELLED. Both go through the transition matrix and
 *                       ItemStatusHistory.
 *                       reopen (link T21, R1) → TRIAGED from finished or cancelled, owner only;
 *                       assign (link T21, D1) → DELEGATED to one of the user's own people.
 *                       Assign records only: it tells nobody (founder's call), and leaves
 *                       `delegation_emailed_at` empty so no chaser treats the person as told.
 *
 * Only the user's OWN items: an id from another user or tenant is "not found", never touched.
 * Facts only, no wording: Suzi's model says the one-sentence confirmation.
 */
import prisma from '../../db/prisma';
import { changeStatus, delegateItem } from '../openItemsService';
import { recordActionLifecycleReply } from '../openItems/actionLifecycleService';
import { localDate, safeTimezone } from './dayBriefFacts';
import { toZonedIso } from './zonedTime';
import { personById } from './suziPeople';

const OPEN = ['NEW', 'TRIAGED', 'IN_PROGRESS', 'WAITING_INFO', 'DELEGATED'];
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface SuziAction { id: string; title: string; owner: string; priority: string; status: string; due: string | null; overdue: boolean; updated_at: string | null }

const ITEM_SELECT = { id: true, title: true, priority: true, status: true, dueDate: true, delegateeName: true, updatedAt: true } as const;

/** An open item as Suzi sees it. `owner` is the delegate when delegated, else 'me'. */
function toSuziAction(r: any, tz: string, today: string): SuziAction {
  const due = r.dueDate ? localDate(r.dueDate, tz) : null;
  return {
    id: r.id, title: String(r.title ?? '').slice(0, 200), owner: r.delegateeName || 'me',
    priority: r.priority ?? '', status: r.status ?? '', due, overdue: !!due && due < today,
    updated_at: r.updatedAt ? toZonedIso(r.updatedAt, tz) : null,
  };
}

export async function listPendingActions(clientNumber: string, userId: number, opts: { limit?: number; timezone?: string; now?: Date } = {}): Promise<{ total: number; overdue: number; actions: SuziAction[] }> {
  const tz = safeTimezone(opts.timezone);
  const today = localDate(opts.now ?? new Date(), tz);
  const rows = await prisma.openItem.findMany({
    where: { clientNumber, userId, status: { in: OPEN }, NOT: { type: 'email' } } as any,
    select: ITEM_SELECT,
    take: 500,
  });
  const actions = rows.map((r) => toSuziAction(r, tz, today)).sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 500);
  return { total: actions.length, overdue: actions.filter((a) => a.overdue).length, actions: actions.slice(0, limit) };
}

export type FollowUp = 'done' | 'cancel' | 'move' | 'not_yet' | 'note' | 'reopen' | 'assign';
export const FOLLOW_UPS: readonly FollowUp[] = ['done', 'cancel', 'move', 'not_yet', 'note', 'reopen', 'assign'];

/** Back to the open list from these (R1). CANCELLED → TRIAGED was already there; CLOSED → TRIAGED came with R1. */
const REOPENABLE = ['CLOSED', 'CANCELLED'];
/** The way to DELEGATED from each open state, through the matrix only (D1). */
const BEFORE_DELEGATING: Record<string, string | null> = { TRIAGED: null, IN_PROGRESS: null, NEW: 'TRIAGED', SNOOZED: 'TRIAGED', WAITING_INFO: 'IN_PROGRESS', DELEGATED: 'IN_PROGRESS' };

export type FollowUpResult =
  | { ok: true; update: FollowUp; action: SuziAction }
  | { ok: false; error: 'not_found' | 'bad_update' | 'bad_date' | 'bad_state' | 'no_email' | 'rejected'; detail?: string };

export async function applyFollowUp(
  clientNumber: string, userId: number,
  p: { actionId: string; update: string; due?: string; note?: string; personId?: string; timezone?: string },
): Promise<FollowUpResult> {
  const update = p.update as FollowUp;
  if (!FOLLOW_UPS.includes(update)) return { ok: false, error: 'bad_update' };
  const item = await prisma.openItem.findFirst({ where: { id: p.actionId, clientNumber, userId }, select: { id: true, notes: true, status: true } });
  if (!item) return { ok: false, error: 'not_found' };
  const status = String(item.status ?? '').toUpperCase();
  if (update === 'reopen' && !REOPENABLE.includes(status)) return { ok: false, error: 'bad_state', detail: 'it is already open' };
  if (update !== 'reopen' && update !== 'note' && REOPENABLE.includes(status)) return { ok: false, error: 'bad_state', detail: 'it is finished or cancelled; reopen it first' };
  let person: Awaited<ReturnType<typeof personById>> = null;
  if (update === 'assign') {
    if (!(status in BEFORE_DELEGATING)) return { ok: false, error: 'bad_state', detail: `it can't be delegated from ${status}` };
    person = await personById(clientNumber, userId, String(p.personId ?? ''));
    if (!person) return { ok: false, error: 'not_found', detail: 'no such person' };
    if (!person.email) return { ok: false, error: 'no_email', detail: 'a delegated task needs the person\'s email on record' };
  }
  if (update === 'note' && !String(p.note ?? '').trim()) return { ok: false, error: 'bad_update', detail: 'note text is required' };
  const said = `Suzi follow-up from the owner: ${update}${p.due ? ` → ${p.due}` : ''}${p.note ? ` (${String(p.note).slice(0, 300)})` : ''}`;
  let dueDate: Date | null = null;
  if (update === 'move') {
    if (!p.due || !/^\d{4}-\d{2}-\d{2}$/.test(p.due) || isNaN(Date.parse(`${p.due}T12:00:00Z`))) return { ok: false, error: 'bad_date' };
    dueDate = new Date(`${p.due}T12:00:00Z`);
  }
  const actor = `user:${userId}`;
  try {
    if (update === 'reopen') {
      await changeStatus(item.id, clientNumber, 'TRIAGED' as any, 'The owner reopened it through Suzi', actor);
    } else if (update === 'assign') {
      const step = BEFORE_DELEGATING[status];
      if (step) await changeStatus(item.id, clientNumber, step as any, `Delegating to ${person!.name}`, actor);
      await delegateItem(item.id, clientNumber, null, person!.name, person!.email, 'The owner delegated it through Suzi', actor);
    } else if (update === 'cancel') {
      await changeStatus(item.id, clientNumber, 'CANCELLED' as any, said, actor);
    } else if (update === 'note') {
      // A note changes nothing about the item's state or its follow-up clock.
      const notes = Array.isArray(item.notes) ? [...(item.notes as unknown[])] : [];
      notes.push({ text: String(p.note).slice(0, 2000), at: new Date().toISOString(), by: `user:${userId}`, source: 'suzi' });
      await prisma.openItem.update({ where: { id: item.id }, data: { notes: notes as any } });
    } else {
      // One implementation of "the owner's own answer" (DEF-281): his "done" IS the approval
      // and is recorded as such; a new date moves the deadline and the follow-up; "not yet"
      // is kept as a response. The interpretation is given, never guessed by a model.
      const r = await recordActionLifecycleReply({
        openItemId: item.id, clientNumber, body: said, source: 'user', sourceId: 'suzi',
        interpretation: {
          outcome: update === 'done' ? 'completed' : 'in_progress',
          summary: said,
          newDeadline: dueDate,
          delayReason: update === 'not_yet' ? (p.note ? String(p.note).slice(0, 300) : 'not yet') : null,
          completionEvidence: update === 'done' ? 'The owner told Suzi it is done' : null,
          needsUserIntervention: false,
          confidence: 1,
        },
      });
      if (!r.handled) return { ok: false, error: 'not_found' };
      if (update === 'done' && !r.closed) return { ok: false, error: 'rejected', detail: r.closeBlocked ?? 'the close was refused' };
    }
  } catch (e: any) {
    return { ok: false, error: 'rejected', detail: String(e?.message ?? 'rejected').slice(0, 200) };
  }
  const after = await prisma.openItem.findFirst({ where: { id: item.id, clientNumber, userId }, select: ITEM_SELECT });
  const tz = safeTimezone(p.timezone);
  return { ok: true, update, action: toSuziAction(after ?? { id: item.id }, tz, localDate(new Date(), tz)) };
}
