/**
 * T32 (both AGREE 17 Nov 2026, founder by voice 12:02:08: "read drafts too ... discard it, change something in it, or send it"):
 *
 *   email.drafts {draft_id?}        unsigned, read only. No draft_id → {drafts: [row], total}; with one → the full draft (body).
 *                                   row {draft_id, gmail_draft_id?, thread_id?, to[], cc[], subject, preview, updated_at, made_by}
 *   email.discard_draft {draft_id}  confirmed, unsigned (nothing leaves his mailbox) → {draft_id, discarded: true}; not_found = gone.
 *   pack drafts_count               (dayPack)
 *
 * Two kinds, one list: drafts Suzi made through Nexeo (made_by suzi, draft_id = Nexeo's id) and his own Gmail drafts
 * (made_by user, draft_id = "g:<gmail draft id>"). On the first change or send of a "g:" draft, Nexeo takes it into its own
 * draft record with the same Gmail draft id (`adoptGmailDraft`), so email.update_draft and email.send work unchanged
 * and the send goes out from that same Gmail draft.
 */
import prisma from '../../db/prisma';

type Result = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
const fail = (error: string, detail?: string): Result => ({ ok: false, error, ...(detail ? { detail } : {}) });
const DRAFT_TYPE = 'draft_reply';
export const DRAFTS_MAX = 50;
const PREVIEW = 200;
const list = (v: string | null | undefined) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const preview = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, PREVIEW);

interface Row { draft_id: string; gmail_draft_id?: string; thread_id?: string; to: string[]; cc: string[]; subject: string; preview: string; updated_at: string | null; made_by: 'suzi' | 'user' }

/** Nexeo's own drafts that have not gone and were not discarded (last 14 days). */
async function nexeoDrafts(clientNumber: string, userId: number) {
  return prisma.$queryRawUnsafe<Array<{ id: number; o: any; updated_at: Date }>>(
    `SELECT id, output AS o, updated_at FROM agent_actions
      WHERE client_number = $1 AND user_id = $2 AND action_type = '${DRAFT_TYPE}' AND status = 'done'
        AND input->'delegate' IS NULL AND COALESCE(output->>'discarded', '') <> 'true'
        AND COALESCE(output->'send'->>'state', '') NOT IN ('held', 'sending', 'sent', 'cancelled', 'failed', 'bounced')
        AND updated_at > now() - interval '14 days'
      ORDER BY updated_at DESC LIMIT ${DRAFTS_MAX}`,
    clientNumber, userId,
  );
}

export async function listDrafts(clientNumber: string, userId: number): Promise<{ drafts: Row[]; total: number } | null> {
  const { listGmailDrafts } = await import('../gmailService');
  const [g, mine] = await Promise.all([listGmailDrafts(userId, DRAFTS_MAX), nexeoDrafts(clientNumber, userId)]);
  if (!g) return null; // Gmail unreadable: never an empty list by mistake
  const byGmail = new Map(mine.filter((m) => m.o?.gmailDraftId).map((m) => [String(m.o.gmailDraftId), m]));
  const rows: Row[] = g.drafts.map((d) => {
    const n = byGmail.get(d.gmailDraftId);
    return {
      draft_id: n ? String(n.id) : `g:${d.gmailDraftId}`, gmail_draft_id: d.gmailDraftId, ...(d.threadId ? { thread_id: d.threadId } : {}),
      to: list(d.to), cc: list(d.cc), subject: d.subject || '(no subject)', preview: preview(d.snippet), updated_at: d.updatedAt, made_by: n ? 'suzi' : 'user',
    };
  });
  // Suzi's drafts not yet saved to Gmail (made, not sent) are his drafts too.
  for (const n of mine) {
    if (n.o?.gmailDraftId && rows.some((r) => r.gmail_draft_id === String(n.o.gmailDraftId))) continue;
    if (n.o?.gmailDraftId) continue; // a Gmail draft no longer there: he removed it in Gmail
    rows.push({ draft_id: String(n.id), ...(n.o?.threadId ? { thread_id: String(n.o.threadId) } : {}), to: list(n.o?.to), cc: list(n.o?.cc), subject: String(n.o?.subject || '(no subject)'), preview: preview(String(n.o?.body ?? '')), updated_at: new Date(n.updated_at).toISOString(), made_by: 'suzi' });
  }
  rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return { drafts: rows.slice(0, DRAFTS_MAX), total: Math.max(g.total, rows.length) };
}

export async function openDraft(clientNumber: string, userId: number, draftId: string): Promise<Result> {
  if (draftId.startsWith('g:')) {
    const { getGmailDraft } = await import('../gmailService');
    const d = await getGmailDraft(userId, draftId.slice(2), true);
    if (!d) return fail('not_found');
    return { ok: true, item: { draft_id: draftId, gmail_draft_id: d.gmailDraftId, ...(d.threadId ? { thread_id: d.threadId } : {}), to: list(d.to), cc: list(d.cc), subject: d.subject, body: d.body ?? '', updated_at: d.updatedAt, made_by: 'user' } };
  }
  const id = parseInt(draftId, 10);
  const r = Number.isFinite(id) ? await prisma.agentAction.findFirst({ where: { id, clientNumber, userId, actionType: DRAFT_TYPE } as any }) : null;
  const o: any = r?.output;
  if (!r || o?.discarded) return fail('not_found');
  return { ok: true, item: { draft_id: String(r.id), ...(o.gmailDraftId ? { gmail_draft_id: o.gmailDraftId } : {}), ...(o.threadId ? { thread_id: o.threadId } : {}), to: list(o.to), cc: list(o.cc), subject: o.subject ?? '', body: o.body ?? '', updated_at: new Date((r as any).updatedAt ?? Date.now()).toISOString(), made_by: 'suzi', ...(o.send?.state ? { state: o.send.state } : {}) } };
}

/** "g:<id>" → Nexeo's own draft record for that Gmail draft (made once; the same Gmail draft id). Null when gone. */
export async function adoptGmailDraft(clientNumber: string, userId: number, draftId: string): Promise<string | null> {
  if (!draftId.startsWith('g:')) return draftId;
  const gid = draftId.slice(2);
  const have = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `SELECT id FROM agent_actions WHERE client_number = $1 AND user_id = $2 AND action_type = '${DRAFT_TYPE}' AND output->>'gmailDraftId' = $3 ORDER BY id DESC LIMIT 1`,
    clientNumber, userId, gid,
  );
  if (have[0]) return String(have[0].id);
  const { getGmailDraft } = await import('../gmailService');
  const d = await getGmailDraft(userId, gid, true);
  if (!d) return null;
  const row = await prisma.agentAction.create({
    data: {
      clientNumber, userId, actionType: DRAFT_TYPE, status: 'done', requiresApproval: false,
      input: { itemType: 'email', source: 'gmail_draft', adoptedFrom: gid } as any,
      output: { channel: 'email', to: d.to, ...(d.cc ? { cc: d.cc } : {}), subject: d.subject, body: d.body ?? '', mode: 'gmail_draft', gmailDraftId: gid, ...(d.threadId ? { threadId: d.threadId } : {}) } as any,
    } as any,
  });
  return String(row.id);
}

export async function discardDraft(clientNumber: string, userId: number, draftId: string, confirmed: boolean): Promise<Result> {
  if (!confirmed) return fail('needs_confirmation');
  if (!draftId) return fail('bad_args', 'draft_id is required');
  const { deleteGmailDraft } = await import('../gmailService');
  if (draftId.startsWith('g:')) {
    const r = await deleteGmailDraft(userId, draftId.slice(2));
    return r.success ? { ok: true, item: { draft_id: draftId, discarded: true } } : fail('not_found');
  }
  const id = parseInt(draftId, 10);
  const row = Number.isFinite(id) ? await prisma.agentAction.findFirst({ where: { id, clientNumber, userId, actionType: DRAFT_TYPE } as any }) : null;
  const o: any = row?.output;
  if (!row || o?.discarded) return fail('not_found');
  if (['held', 'sending', 'sent'].includes(String(o?.send?.state ?? ''))) return fail('bad_state', 'it is being sent or has gone');
  if (o?.gmailDraftId) await deleteGmailDraft(userId, String(o.gmailDraftId)).catch(() => undefined);
  await prisma.$executeRawUnsafe(
    `UPDATE agent_actions SET output = COALESCE(output, '{}'::jsonb) || jsonb_build_object('discarded', true, 'discarded_at', now()::text), updated_at = now() WHERE id = $1`,
    row.id,
  );
  return { ok: true, item: { draft_id: draftId, discarded: true } };
}

/** For the pack: how many drafts wait. Null when Gmail cannot be read (the field is then left out). */
export async function draftsCount(clientNumber: string, userId: number): Promise<number | null> {
  const r = await listDrafts(clientNumber, userId).catch(() => null);
  return r ? r.total : null;
}
