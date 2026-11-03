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
 *
 * Only the user's OWN items: an id from another user or tenant is "not found", never touched.
 * Facts only, no wording: Suzi's model says the one-sentence confirmation.
 */
import prisma from '../../db/prisma';
import { changeStatus } from '../openItemsService';
import { recordActionLifecycleReply } from '../openItems/actionLifecycleService';
import { localDate, safeTimezone } from './dayBriefFacts';

const OPEN = ['NEW', 'TRIAGED', 'IN_PROGRESS', 'WAITING_INFO', 'DELEGATED'];
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface SuziAction { id: string; title: string; priority: string; status: string; due: string | null; overdue: boolean }

export async function listPendingActions(clientNumber: string, userId: number, opts: { limit?: number; timezone?: string; now?: Date } = {}): Promise<{ total: number; overdue: number; actions: SuziAction[] }> {
  const tz = safeTimezone(opts.timezone);
  const today = localDate(opts.now ?? new Date(), tz);
  const rows = await prisma.openItem.findMany({
    where: { clientNumber, userId, status: { in: OPEN }, NOT: { type: 'email' } } as any,
    select: { id: true, title: true, priority: true, status: true, dueDate: true },
    take: 200,
  });
  const actions = rows.map((r) => {
    const due = r.dueDate ? localDate(r.dueDate, tz) : null;
    return { id: r.id, title: r.title.slice(0, 200), priority: r.priority, status: r.status, due, overdue: !!due && due < today };
  }).sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  return { total: actions.length, overdue: actions.filter((a) => a.overdue).length, actions: actions.slice(0, limit) };
}

export type FollowUp = 'done' | 'cancel' | 'move' | 'not_yet';

export type FollowUpResult =
  | { ok: true; update: FollowUp; action: SuziAction }
  | { ok: false; error: 'not_found' | 'bad_update' | 'bad_date' | 'rejected'; detail?: string };

export async function applyFollowUp(
  clientNumber: string, userId: number,
  p: { actionId: string; update: string; due?: string; note?: string; timezone?: string },
): Promise<FollowUpResult> {
  const update = p.update as FollowUp;
  if (!['done', 'cancel', 'move', 'not_yet'].includes(update)) return { ok: false, error: 'bad_update' };
  const item = await prisma.openItem.findFirst({ where: { id: p.actionId, clientNumber, userId }, select: { id: true } });
  if (!item) return { ok: false, error: 'not_found' };
  const said = `Suzi follow-up from the owner: ${update}${p.due ? ` → ${p.due}` : ''}${p.note ? ` (${String(p.note).slice(0, 300)})` : ''}`;
  let dueDate: Date | null = null;
  if (update === 'move') {
    if (!p.due || !/^\d{4}-\d{2}-\d{2}$/.test(p.due) || isNaN(Date.parse(`${p.due}T12:00:00Z`))) return { ok: false, error: 'bad_date' };
    dueDate = new Date(`${p.due}T12:00:00Z`);
  }
  try {
    if (update === 'cancel') {
      await changeStatus(item.id, clientNumber, 'CANCELLED' as any, said, `user:${userId}`);
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
  const after = await prisma.openItem.findFirst({ where: { id: item.id, clientNumber, userId }, select: { id: true, title: true, priority: true, status: true, dueDate: true } });
  const tz = safeTimezone(p.timezone);
  const due = after?.dueDate ? localDate(after.dueDate, tz) : null;
  return {
    ok: true, update,
    action: { id: item.id, title: after?.title ?? '', priority: after?.priority ?? '', status: after?.status ?? '', due, overdue: !!due && due < localDate(new Date(), tz) },
  };
}
