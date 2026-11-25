/**
 * D-322, T47 proposals (founder 25 Nov: "think/act like real assistant"; Suzi-Builder AGREE 14:28 with six conditions).
 * The assistant step (assistantReasoner) stores proposals on the task (metadata.proposals); this module is the one place
 * that shows them, does them and dismisses them.
 *
 * Suzi's conditions, as built:
 *  1. `why` names who, the subject and the date, with the quote (made when stored; see evidenceWhy).
 *  2. Do it = the op with `proposal_id` in its args: a replay is a no-op, a task that changed answers `proposal_stale`.
 *  4. Dismiss is learnt: a dismissed proposal never returns, nor the same change on the same task.
 *  6. At most 3 per action, newest first.
 * Shown now: `done` and `due` (both map to task.update). `lead` stays stored until a person id can be resolved for it.
 */
import prisma from '../../db/prisma';

export type StoredProposal = { id: string; change: 'done' | 'due' | 'lead'; value: string | null; why: string; from: { email_id: string; direction: 'in' | 'out' }; at: string; state?: 'done' | 'dismissed' };
export type PackProposal = { id: string; op: 'task.update'; args: Record<string, string>; why: string; from: { email_id: string; direction: 'in' | 'out' } };

const OPEN = ['NEW', 'TRIAGED', 'IN_PROGRESS', 'WAITING_INFO', 'DELEGATED', 'SNOOZED'];
export const MAX_SHOWN = 3;

/** Condition 1: "Sofia Rana wrote on 24 Nov 'done, sent the deck' (Re: Q4 deck)". */
export function evidenceWhy(p: { sent: boolean; fromRaw: string | null; subject: string | null; date: Date | null; quote: string }): string {
  const who = p.sent ? 'You' : (String(p.fromRaw ?? '').replace(/<[^>]+>/, '').replace(/"/g, '').trim() || String(p.fromRaw ?? '').trim() || 'Someone');
  const day = p.date && !isNaN(p.date.getTime()) ? ` on ${p.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' })}` : '';
  const q = p.quote.replace(/\s+/g, ' ').replace(/^"|"$/g, '').trim().slice(0, 160);
  const subj = String(p.subject ?? '').trim().slice(0, 80);
  return `${who.slice(0, 60)} wrote${day} "${q}"${subj ? ` (${subj})` : ''}`;
}

/** The proposals an action shows: open ones only, done/due only, newest first, at most 3. */
export function packProposals(taskId: string, status: string, meta: any): PackProposal[] {
  if (!OPEN.includes(String(status ?? '').toUpperCase())) return [];
  const list: StoredProposal[] = Array.isArray(meta?.proposals) ? meta.proposals : [];
  return list
    .filter((p) => p && !p.state && (p.change === 'done' || (p.change === 'due' && /^\d{4}-\d{2}-\d{2}$/.test(String(p.value)))))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, MAX_SHOWN)
    .map((p) => ({
      id: p.id, op: 'task.update' as const,
      args: (p.change === 'done' ? { id: taskId, update: 'done', proposal_id: p.id } : { id: taskId, update: 'move', due: String(p.value), proposal_id: p.id }) as Record<string, string>,
      why: p.why, from: p.from,
    }));
}

/** Condition 4: once dismissed, the same change on the same task is never proposed again. */
export function wasDismissed(meta: any, change: string): boolean {
  return (Array.isArray(meta?.proposals) ? meta.proposals : []).some((p: StoredProposal) => p?.state === 'dismissed' && p.change === change);
}

async function setState(taskId: string, proposalId: string, state: 'done' | 'dismissed'): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE open_items SET metadata = jsonb_set(metadata, '{proposals}',
       (SELECT COALESCE(jsonb_agg(CASE WHEN x->>'id' = $2 THEN x || jsonb_build_object('state', $3::text, 'state_at', now()::text) ELSE x END), '[]'::jsonb)
          FROM jsonb_array_elements(COALESCE(metadata->'proposals', '[]'::jsonb)) x))
     WHERE id = $1`,
    taskId, proposalId, state,
  );
}

type Item = { id: string; status: string; dueDate: Date | null; metadata: any };

/**
 * Condition 2, before Do it runs. 'go' = do it; 'replay' = already done, answer with the task as it is; 'stale' = the
 * task changed since (closed, or already on that date); 'unknown' = no such proposal on this task.
 */
export function checkProposal(item: Item, proposalId: string, update: string): 'go' | 'replay' | 'stale' | 'unknown' {
  const p = (Array.isArray(item.metadata?.proposals) ? item.metadata.proposals : []).find((x: StoredProposal) => x?.id === proposalId) as StoredProposal | undefined;
  if (!p) return 'unknown';
  if (p.state === 'done') return 'replay';
  if (p.state === 'dismissed') return 'stale';
  const want = p.change === 'done' ? 'done' : p.change === 'due' ? 'move' : null;
  if (!want || want !== update) return 'unknown';
  if (!OPEN.includes(String(item.status ?? '').toUpperCase())) return 'stale';
  if (p.change === 'due' && item.dueDate && item.dueDate.toISOString().slice(0, 10) === p.value) return 'stale';
  return 'go';
}

export async function loadItem(clientNumber: string, userId: number, id: string): Promise<Item | null> {
  return (await prisma.openItem.findFirst({ where: { id, clientNumber, userId } as any, select: { id: true, status: true, dueDate: true, metadata: true } as any })) as any;
}

export const markDone = (taskId: string, proposalId: string) => setState(taskId, proposalId, 'done');

/** proposal.dismiss {id, task_id?}: internal, no signature. The proposal is found on his own tasks by its id. */
export async function dismissProposal(clientNumber: string, userId: number, a: Record<string, unknown>): Promise<{ ok: true; item: unknown } | { ok: false; error: string; detail?: string }> {
  const id = typeof a.id === 'string' ? a.id.trim() : '';
  if (!id) return { ok: false, error: 'bad_args', detail: 'id is required' };
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM open_items WHERE client_number = $1 AND user_id = $2
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(metadata->'proposals', '[]'::jsonb)) x WHERE x->>'id' = $3) LIMIT 1`,
    clientNumber, userId, id,
  );
  if (!rows[0]) return { ok: false, error: 'not_found' };
  await setState(rows[0].id, id, 'dismissed');
  return { ok: true, item: { id, dismissed: true } };
}
