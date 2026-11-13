/**
 * Wiki reconcile — nothing a feed fetched stays outside the source store
 * (docs/Wiki-Knowledge.md §0.1.2 and §6b A1).
 *
 * The feed lands each item in the Wiki as it stores it, but that landing can
 * fail (a restart, a database hiccup), and a feed never offers the same item
 * twice. So the stored feed items are the checklist: each one's source is
 * looked up by its own id, and whatever the Wiki does not hold is landed.
 * Nothing is remembered between runs, so a run that is interrupted loses
 * nothing; the next run finds the same gap.
 *
 *  1. Every stored feed item has its source.
 *  2. Every email whose full text is known (today in an old `email_message`
 *     page) has that text as the text of its source. Emails whose feed item
 *     was already pruned are recreated from the page.
 *
 * `holdsFeedItem` is the same check for one item, asked by the feed pruner
 * before it deletes a row: the feed store may let go only of what the Wiki holds.
 */
import prisma from '../../db/prisma';
import { landEmailText, sourceFromFeedItem, type FeedItem } from './wikiIntake';
import { saveSource, sourceId, sourcesHeld, type SourceInput } from './wikiSources';

export interface ReconcileResult {
  /** Stored feed items looked at. */
  feedItems: number;
  /** Items whose source the Wiki did not hold, or held without the item's text. */
  missing: number;
  /** Of those, landed now. */
  landed: number;
  /** Emails whose full text the Wiki did not hold, landed now. */
  emailTexts: number;
  failed: number;
  /** The first few failures, in words. */
  errors: string[];
}

/** The text under `## Body` in an old email page. */
export function emailPageText(bodyMarkdown: string | null): string {
  if (!bodyMarkdown) return '';
  const i = bodyMarkdown.indexOf('\n## Body\n');
  return (i >= 0 ? bodyMarkdown.slice(i + '\n## Body\n'.length) : '').trim();
}

function hasText(src: SourceInput): boolean {
  const b: unknown = src.body;
  return typeof b === 'string' ? b.trim().length > 0 : b != null;
}

function idOf(src: SourceInput): string {
  return sourceId(src.clientNumber, src.userId, src.kind, String(src.externalId).trim());
}

/**
 * Land the full text of every email of this user that an old email page holds
 * and the source does not (no source at all, or a shorter text such as the
 * preview). With `gmailMessageId`, only that email. Returns how many were
 * landed; with `countOnly`, how many are missing, and nothing is written.
 */
async function landMissingEmailTexts(
  clientNumber: string,
  userId: number,
  gmailMessageId: string | null,
  onError: (what: string, err: unknown) => void,
  countOnly = false,
): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ body_markdown: string | null; metadata: any; last_updated_at: Date; have: number | null }>>(
    `SELECT p.body_markdown, p.metadata, p.last_updated_at,
            CASE WHEN s.id IS NULL THEN NULL ELSE length(coalesce(s.body_text, '')) END AS have
       FROM wiki_pages p
       LEFT JOIN wiki_sources s
         ON s.client_number = p.client_number AND s.user_id = p.user_id
        AND s.kind = 'email' AND s.external_id = p.metadata->>'gmailMessageId'
      WHERE p.client_number = $1 AND p.user_id = $2 AND p.page_type = 'email_message'
        AND p.metadata->>'gmailMessageId' IS NOT NULL
        AND ($3::text IS NULL OR p.metadata->>'gmailMessageId' = $3)
        AND position(E'\\n## Body\\n' in p.body_markdown) > 0
        AND (s.id IS NULL OR (s.body_enc IS NULL AND length(coalesce(s.body_text, '')) <
             length(btrim(substr(p.body_markdown, position(E'\\n## Body\\n' in p.body_markdown) + 9), E' \\t\\r\\n'))))`,
    clientNumber, userId, gmailMessageId,
  );
  let landed = 0;
  for (const pg of rows) {
    const m = (pg.metadata ?? {}) as Record<string, any>;
    const text = emailPageText(pg.body_markdown);
    // Counted the way the database counts, so a text the source already holds is never landed again.
    if (!text || (pg.have !== null && [...text].length <= Number(pg.have))) continue;
    if (countOnly) { landed += 1; continue; }
    const when = m.date && !Number.isNaN(new Date(m.date).getTime()) ? new Date(m.date) : pg.last_updated_at;
    try {
      await landEmailText({
        clientNumber, userId, gmailMessageId: String(m.gmailMessageId), feedEventId: m.feedEventId ?? null,
        threadId: m.threadId ?? null, subject: m.subject ?? null, from: m.from ?? m.senderEmail ?? null,
        to: m.to ?? null, cc: m.cc ?? null, receivedAt: when, bodyText: text,
      });
      landed += 1;
    } catch (err) { onError(`email ${m.gmailMessageId}`, err); }
  }
  return landed;
}

/** Land whatever this user's stored feed items and email pages hold that the source store does not. */
export async function reconcileSources(clientNumber: string, userId: number): Promise<ReconcileResult> {
  const out: ReconcileResult = { feedItems: 0, missing: 0, landed: 0, emailTexts: 0, failed: 0, errors: [] };
  const fail = (what: string, err: unknown) => {
    out.failed += 1;
    if (out.errors.length < 3) out.errors.push(`${what}: ${err instanceof Error ? err.message.replace(/\s+/g, ' ').slice(0, 200) : String(err)}`);
  };
  const PAGE = 500;

  // Paged by id, so a row landed or pruned meanwhile never shifts the pages.
  for (let after = ''; ; ) {
    const rows = await prisma.feedEvent.findMany({
      where: { clientNumber, userId, id: { gt: after } },
      select: { id: true, sourceType: true, sourceId: true, rawPayload: true, eventAt: true, createdAt: true },
      orderBy: { id: 'asc' }, take: PAGE,
    });
    if (rows.length === 0) break;
    after = rows[rows.length - 1].id;
    out.feedItems += rows.length;

    // Several stored rows can be the same item (an email re-read, a meeting edited): the newest one speaks for it.
    const wanted = new Map<string, SourceInput>();
    for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      const src = sourceFromFeedItem({
        id: r.id, clientNumber, userId, sourceType: r.sourceType, sourceId: r.sourceId,
        payload: (r.rawPayload ?? {}) as Record<string, any>, at: r.eventAt ?? r.createdAt,
      });
      if (!src) continue;
      const id = idOf(src);
      const prior = wanted.get(id);
      wanted.set(id, prior && hasText(prior) && !hasText(src) ? prior : src);
    }
    const held = await sourcesHeld(clientNumber, userId, [...wanted.keys()]);
    for (const [id, src] of wanted) {
      const h = held.get(id);
      if (h && (h.hasText || !hasText(src))) continue;
      out.missing += 1;
      try {
        await saveSource(src);
        out.landed += 1;
      } catch (err) { fail(`feed item ${src.feedEventId}`, err); }
    }
    if (rows.length < PAGE) break;
  }

  try {
    out.emailTexts = await landMissingEmailTexts(clientNumber, userId, null, fail);
  } catch (err) { fail('email texts', err); }
  return out;
}

/** Reconcile every user who has stored feed items, active or not. */
export async function reconcileSourcesForAllUsers(): Promise<Array<ReconcileResult & { clientNumber: string; userId: number }>> {
  const users = await prisma.$queryRawUnsafe<Array<{ client_number: string; user_id: number }>>(
    `SELECT DISTINCT client_number, user_id FROM feed_events WHERE user_id IS NOT NULL ORDER BY 1, 2`,
  );
  const out: Array<ReconcileResult & { clientNumber: string; userId: number }> = [];
  for (const u of users) {
    const userId = Number(u.user_id);
    try {
      out.push({ clientNumber: u.client_number, userId, ...(await reconcileSources(u.client_number, userId)) });
    } catch (err: any) {
      out.push({
        clientNumber: u.client_number, userId, feedItems: 0, missing: 0, landed: 0, emailTexts: 0, failed: 1,
        errors: [String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 200)],
      });
    }
  }
  return out;
}

/**
 * Does the Wiki hold this stored item: its source, its text, and for an email
 * the full text an email page has? With `repair`, what is missing is landed
 * first; either way the answer is read from the store. The feed pruner deletes
 * a row only on a yes. Never throws: a failure is a no.
 */
export async function holdsFeedItem(item: FeedItem, opts: { repair?: boolean } = {}): Promise<boolean> {
  try {
    const src = sourceFromFeedItem(item);
    if (!src) return false;
    const id = idOf(src);
    const ok = (h: { hasText: boolean } | undefined) => !!h && (h.hasText || !hasText(src));
    if (opts.repair && !ok((await sourcesHeld(item.clientNumber, item.userId, [id])).get(id))) await saveSource(src);
    if (src.kind === 'email') {
      let failed = false;
      const n = await landMissingEmailTexts(
        item.clientNumber, item.userId, String(src.externalId).trim(), () => { failed = true; }, !opts.repair,
      );
      if (failed || (!opts.repair && n > 0)) return false;
    }
    return ok((await sourcesHeld(item.clientNumber, item.userId, [id])).get(id));
  } catch {
    return false;
  }
}
