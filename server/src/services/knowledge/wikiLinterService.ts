/**
 * MyOS Knowledge — Wiki Linter.
 *
 * Runs hourly. Maintains the `wiki_pages.status` field based on link density
 * and freshness. Also reconciles the denormalized `inboundLinks`,
 * `outboundLinks`, `sourceCount` counters against the join tables so they
 * stay honest.
 *
 * Status values:
 *   - active       : has at least 1 source OR link. Fresh enough (<60 days).
 *   - stale        : last_updated_at > 60 days. Not touched recently.
 *   - orphan       : no sources, no links. Disconnected from everything.
 *   - contradicted : has a WikiPageLink of type 'contradicts'. Needs MD attn.
 *   - draft        : (left alone — set explicitly by wiki_scribe for low-conf)
 *
 * The linter NEVER deletes. It only labels. The MD sees stale/orphan in the
 * Knowledge Center index and decides what to do.
 *
 * It labels only pages whose status is its to set (`linterOwns`, DEF-458).
 * Until 2026-11-13 it relabelled every row of `wiki_pages`, which
 *   - made every standing instruction 'orphan' within the hour (an instruction
 *     has no links), so Brain and My Rules, which read status 'active', saw none;
 *   - turned every deleted or retired page back into a live one.
 */
import prisma from '../../db/prisma';
import { WIKI_STALE_DAYS } from '../wiki/wikiStaleness';

export interface LintSummary {
  scanned: number;
  marked_active: number;
  marked_stale: number;
  marked_orphan: number;
  marked_contradicted: number;
  unchanged: number;
  /** Pages whose status belongs to someone else: left exactly as they are. */
  not_owned: number;
  durationMs: number;
}

/** The four labels the linter gives. A page in any other status was put there by its owner. */
export const LINT_LABELS = ['active', 'stale', 'orphan', 'contradicted'];

/**
 * Is this page's status the linter's to set?
 *  - not when its status is not one of the linter's own labels (deleted,
 *    superseded, draft, …): that is a decision somebody made;
 *  - not when the page keeps its own lifecycle (`metadata.status`: a standing
 *    instruction is active, paused, fulfilled or archived by the user's word);
 *  - not when it is a note of the new wiki (`metadata.wiki`): the wiki store
 *    sets its status, its link counts and its source count.
 */
export function linterOwns(page: { status: string; ownLifecycle: boolean; isNote: boolean }): boolean {
  return LINT_LABELS.includes(page.status) && !page.ownLifecycle && !page.isNote;
}

/** The label for a page the linter owns. */
export function lintLabel(
  r: { inbound_refs: number; outbound_refs: number; source_refs: number; contradicts_refs: number; last_updated_at: Date },
  staleCutoff: Date,
): string {
  if (r.contradicts_refs > 0) return 'contradicted';
  if (r.inbound_refs === 0 && r.outbound_refs === 0 && r.source_refs === 0) return 'orphan';
  if (new Date(r.last_updated_at) < staleCutoff) return 'stale';
  return 'active';
}

const STALE_DAYS = WIKI_STALE_DAYS;

export async function lintAllWikiPages(): Promise<LintSummary> {
  const t0 = Date.now();
  const summary: LintSummary = {
    scanned: 0,
    marked_active: 0,
    marked_stale: 0,
    marked_orphan: 0,
    marked_contradicted: 0,
    unchanged: 0,
    not_owned: 0,
    durationMs: 0,
  };

  // One SQL pass: classify every wiki_page row by its link/source counts +
  // freshness. Using raw SQL keeps it cheap and atomic.
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    status: string;
    own_lifecycle: boolean;
    is_note: boolean;
    last_updated_at: Date;
    inbound_refs: number;
    outbound_refs: number;
    source_refs: number;
    contradicts_refs: number;
  }>>(
    `SELECT wp.id,
            wp.status,
            (wp.metadata ? 'status') AS own_lifecycle,
            (wp.metadata ? 'wiki') AS is_note,
            wp.last_updated_at,
            COALESCE((SELECT COUNT(*) FROM wiki_page_links WHERE to_page_id  = wp.id),0)::int AS inbound_refs,
            COALESCE((SELECT COUNT(*) FROM wiki_page_links WHERE from_page_id = wp.id),0)::int AS outbound_refs,
            COALESCE((SELECT COUNT(*) FROM wiki_page_sources WHERE wiki_page_id = wp.id),0)::int AS source_refs,
            COALESCE((SELECT COUNT(*) FROM wiki_page_links
                       WHERE (from_page_id = wp.id OR to_page_id = wp.id) AND link_type = 'contradicts'),0)::int AS contradicts_refs
       FROM wiki_pages wp`,
  );
  summary.scanned = rows.length;

  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  for (const r of rows) {
    if (!linterOwns({ status: r.status, ownLifecycle: r.own_lifecycle === true, isNote: r.is_note === true })) {
      summary.not_owned += 1;
      continue;
    }
    const newStatus = lintLabel(r, staleCutoff);

    const countsDifferent = false; // counters updated below
    if (newStatus === r.status && !countsDifferent) { summary.unchanged += 1; }

    await prisma.wikiPage.update({
      where: { id: r.id },
      data: {
        status: newStatus,
        inboundLinks: r.inbound_refs,
        outboundLinks: r.outbound_refs,
        sourceCount: r.source_refs,
      },
    }).catch(() => { /* best-effort */ });

    if (newStatus !== r.status) {
      if (newStatus === 'active') summary.marked_active += 1;
      else if (newStatus === 'stale') summary.marked_stale += 1;
      else if (newStatus === 'orphan') summary.marked_orphan += 1;
      else if (newStatus === 'contradicted') summary.marked_contradicted += 1;
    }
  }

  summary.durationMs = Date.now() - t0;
  return summary;
}

/** Read view for the UI — counts by status for this user's wiki. */
export async function wikiHealth(clientNumber: string, userId: number) {
  const rows = await prisma.$queryRawUnsafe<Array<{ status: string; n: number }>>(
    `SELECT status, COUNT(*)::int AS n
       FROM wiki_pages
      WHERE client_number = $1 AND user_id = $2
      GROUP BY status`,
    clientNumber, userId,
  );
  const counts: Record<string, number> = { active: 0, stale: 0, orphan: 0, contradicted: 0, draft: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}
