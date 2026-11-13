/**
 * DEF-474 / DEF-475 (CL-091, 13 Nov 2026): what an email card says must agree with what Nexeo already knows.
 *
 *  - An email with an OPEN task made from it (open_items.metadata.derivedFrom: the same thread or feed row, or the
 *    message id) takes the task's priority as its band and the task's description as its line. The Green Belt card
 *    said "Medium" and "forwarding a request for your approval" while its task said high, "be the sponsor", by 14 Nov.
 *  - A calendar invitation he has answered is not something that needs him (inviteResponses.ts).
 *
 * Used by BOTH readers of his emails: the web's My Attention (buildAttentionList) and the Wiki-first list behind
 * Suzi's pack and the spoken brief (loadAttentionEmails), so the two cannot disagree. A read that fails changes
 * nothing.
 */
import prisma from '../../db/prisma';

const OPEN = ['NEW', 'TRIAGED', 'DRAFT', 'DELEGATED'];
const BANDS = new Set(['critical', 'high', 'medium', 'low']);

type Card = {
  feedEventId: string; threadId?: string | null; threadFeedEventIds?: string[];
  criticality?: { band?: string; [k: string]: unknown } | null; critical?: boolean; rationale?: string | null;
  openItem?: { id: string; priority: string; dueDate: string | null; title: string } | null;
};

export async function applyOpenItems(items: Card[], clientNumber: string, userId: number): Promise<void> {
  if (!items.length) return;
  const threads = [...new Set(items.map((i) => i.threadId).filter(Boolean) as string[])];
  const feeds = [...new Set(items.flatMap((i) => [i.feedEventId, ...(i.threadFeedEventIds ?? [])]).filter(Boolean))];
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; title: string; description: string | null; priority: string; due_date: Date | null; th: string | null; fe: string | null; sr: string | null; created_at: Date }>>(
    `SELECT id, title, description, priority, due_date, metadata->'derivedFrom'->>'threadId' AS th,
            metadata->'derivedFrom'->>'feedEventId' AS fe, source_ref AS sr, created_at
       FROM open_items
      WHERE client_number = $1 AND user_id = $2 AND status::text = ANY($3::text[])
        AND (metadata->'derivedFrom'->>'threadId' = ANY($4::text[]) OR metadata->'derivedFrom'->>'feedEventId' = ANY($5::text[])
             OR source_ref = ANY($5::text[]) OR source_ref = ANY($4::text[]))
      ORDER BY created_at DESC LIMIT 200`,
    clientNumber, userId, OPEN, threads, feeds,
  ).catch(() => null);
  if (!rows?.length) return;
  for (const it of items) {
    const ids = new Set([it.feedEventId, ...(it.threadFeedEventIds ?? [])]);
    const r = rows.find((x) => (x.fe && ids.has(x.fe)) || (x.sr && ids.has(x.sr)) || (it.threadId && (x.th === it.threadId || x.sr === it.threadId)));
    if (!r) continue;
    const band = String(r.priority ?? '').toLowerCase();
    if (BANDS.has(band)) {
      it.criticality = { ...(it.criticality ?? {}), band };
      it.critical = band === 'critical';
    }
    const due = r.due_date ? new Date(r.due_date) : null;
    const line = String(r.description ?? '').split('\n')[0].trim() || r.title;
    if (line) it.rationale = line;
    it.openItem = { id: r.id, priority: band, dueDate: due && !isNaN(due.getTime()) ? due.toISOString() : null, title: r.title };
  }
}

/** Both corrections, for a list of email cards. Returns the cards that still need him (answered invitations out). */
export async function cardTruth<T extends Card & { itemType?: string; subject: string; inviteResponse?: string | null; conversationSummary?: string }>(
  items: T[], clientNumber: string, userId: number,
): Promise<T[]> {
  const { markInviteResponses } = await import('./inviteResponses');
  await markInviteResponses(items.map((i) => { if (!i.itemType) (i as any).itemType = 'email'; return i as any; }), userId).catch(() => undefined);
  const keep = items.filter((i) => !(i.inviteResponse && i.inviteResponse !== 'needsAction'));
  await applyOpenItems(keep, clientNumber, userId).catch(() => undefined);
  return keep;
}
