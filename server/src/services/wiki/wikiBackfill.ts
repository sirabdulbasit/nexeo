/**
 * Wiki backfill — bring what was stored before the source store existed into
 * it (docs/Wiki-Knowledge.md §6b A1). Safe to run again: a source is one row
 * however often it is landed.
 *
 *  1. Every stored feed item becomes a source.
 *  2. The full text of every email, which until now lived only in an old
 *     `email_message` page, becomes the text of its email source. Emails
 *     whose feed item was already pruned are recreated from the page.
 */
import prisma from '../../db/prisma';
import { landFeedItem, landEmailText } from './wikiIntake';

export interface BackfillResult {
  feedItems: number;
  feedLanded: number;
  emailPages: number;
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

export async function backfillSources(clientNumber: string, userId: number): Promise<BackfillResult> {
  const out: BackfillResult = { feedItems: 0, feedLanded: 0, emailPages: 0, emailTexts: 0, failed: 0, errors: [] };
  const fail = (what: string, err: unknown) => {
    out.failed += 1;
    if (out.errors.length < 3) out.errors.push(`${what}: ${err instanceof Error ? err.message.replace(/\s+/g, ' ').slice(0, 200) : String(err)}`);
  };
  const PAGE = 500;

  for (let skip = 0; ; skip += PAGE) {
    const rows = await prisma.feedEvent.findMany({
      where: { clientNumber, userId },
      select: { id: true, sourceType: true, sourceId: true, rawPayload: true, eventAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' }, skip, take: PAGE,
    });
    for (const r of rows) {
      out.feedItems += 1;
      try {
        const id = await landFeedItem({
          id: r.id, clientNumber, userId, sourceType: r.sourceType, sourceId: r.sourceId,
          payload: (r.rawPayload ?? {}) as Record<string, any>, at: r.eventAt ?? r.createdAt,
        });
        if (id) out.feedLanded += 1;
      } catch (err) { fail(`feed item ${r.id}`, err); }
    }
    if (rows.length < PAGE) break;
  }

  for (let skip = 0; ; skip += PAGE) {
    const pages = await prisma.wikiPage.findMany({
      where: { clientNumber, userId, pageType: 'email_message' },
      select: { bodyMarkdown: true, metadata: true, lastUpdatedAt: true },
      orderBy: { createdAt: 'asc' }, skip, take: PAGE,
    });
    for (const pg of pages) {
      out.emailPages += 1;
      const m = (pg.metadata ?? {}) as Record<string, any>;
      const text = emailPageText(pg.bodyMarkdown);
      if (!m.gmailMessageId || !text) continue;
      const when = m.date && !Number.isNaN(new Date(m.date).getTime()) ? new Date(m.date) : pg.lastUpdatedAt;
      try {
        await landEmailText({
          clientNumber, userId, gmailMessageId: String(m.gmailMessageId), feedEventId: m.feedEventId ?? null,
          threadId: m.threadId ?? null, subject: m.subject ?? null, from: m.from ?? m.senderEmail ?? null,
          to: m.to ?? null, cc: m.cc ?? null, receivedAt: when, bodyText: text,
        });
        out.emailTexts += 1;
      } catch (err) { fail(`email ${m.gmailMessageId}`, err); }
    }
    if (pages.length < PAGE) break;
  }
  return out;
}
