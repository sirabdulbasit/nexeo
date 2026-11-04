/**
 * Functional Charter row 1, contract "Knowledge": GET …/knowledge?q=
 *   → [{page_id, title, excerpt, updated_at, url}], at most 5 results and about 4,000 characters.
 *
 * Nexeo serves facts; Suzi's model writes the words and cites the page title. Costing Charter §4:
 * this replaces Brain's 60,000–100,000-token reply path, so no model runs here. The only paid call
 * is one embedding of the question.
 *
 * Search is by meaning, then by name in the title (a short lowercase name ranks badly by meaning),
 * then by code in the body ("R-26-00081"). Ranking is Brain's own, so both paths prefer the same pages.
 */
import prisma from '../../db/prisma';
import { env } from '../../config/env';
import { searchWikiByVector } from '../knowledge/wikiEmbeddingService';
import { extractDistinctiveTokens, rankAndTrim } from '../knowledge/brainComposer';

export const MAX_RESULTS = 5;
export const MAX_CHARS = 4000;
const MIN_SCORE = 0.3;
const KEYWORD_ONLY_SCORE = 0.55;
const TITLE_BONUS = 0.2;

/** Not facts: Brain's notes about itself, its own earlier answers, and what it knows it doesn't know. */
const NOT_FACTS = ['gap', 'tenant_index', 'tenant_log', 'mind_state', 'observation', 'answer'];
const NOT_SHOWN_STATUS = ['superseded', 'deleted', 'contradicted', 'draft'];

const STOP = new Set(['the', 'and', 'for', 'with', 'about', 'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how', 'does', 'did', 'has', 'have', 'had', 'was', 'were', 'are', 'our', 'his', 'her', 'their', 'this', 'that', 'from', 'tell', 'know', 'you', 'can', 'could', 'should', 'would', 'please', 'give', 'show', 'status', 'latest']);

export interface KnowledgeResult { page_id: string; title: string; excerpt: string; updated_at: string | null; url: string }

/** The words worth finding in a title or a paragraph, longest first. Works for any script. */
export function queryTerms(q: string): string[] {
  const words = q.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w)))].sort((a, b) => b.length - a.length).slice(0, 6);
}

/** Terms and codes hold only letters, digits and hyphens, so nothing here needs escaping. */
const likePattern = (t: string) => `%${t}%`;

/**
 * The part of a page that answers the question: the paragraph with the most query terms and what
 * follows it, within the budget. A short page comes back whole.
 */
export function excerptOf(body: string, terms: string[], budget: number): string {
  const text = body.replace(/\r/g, '').trim();
  if (text.length <= budget) return text;
  const paras = text.split(/\n{2,}/);
  let best = 0;
  let bestHits = 0;
  paras.forEach((p, i) => {
    const low = p.toLowerCase();
    const hits = terms.reduce((n, t) => n + (low.includes(t) ? 1 : 0), 0);
    if (hits > bestHits) { best = i; bestHits = hits; }
  });
  const prefix = best > 0 ? '… ' : '';
  const room = budget - prefix.length - 2;
  const tail = paras.slice(best).join('\n\n');
  if (tail.length <= room) return prefix + tail;
  const cut = tail.slice(0, room);
  const space = cut.lastIndexOf(' ');
  return `${prefix}${(space > room * 0.8 ? cut.slice(0, space) : cut).trimEnd()} …`;
}

type Hit = { id: string; title: string; pageType: string; bodyMarkdown: string | null; score: number; userId: number };

export async function searchKnowledge(clientNumber: string, userId: number, rawQuery: string): Promise<KnowledgeResult[]> {
  const q = rawQuery.trim().slice(0, 500);
  if (!q) return [];
  const terms = queryTerms(q);
  const hits = new Map<string, Hit>();

  // An embedding failure leaves the keyword passes, so the route still answers.
  const byMeaning = await searchWikiByVector(clientNumber, userId, q, { limit: 40, minScore: MIN_SCORE }).catch(() => []);
  for (const h of byMeaning) hits.set(h.id, h);

  const keywordRows = (column: 'title' | 'body_markdown', patterns: string[], limit: number) => prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title, page_type AS "pageType", body_markdown AS "bodyMarkdown", user_id AS "userId"
       FROM wiki_pages
      WHERE client_number = $1
        AND (scope = 'tenant' OR (scope = 'user' AND user_id = $2))
        AND ${column} ILIKE ANY($3::text[])
      ORDER BY last_updated_at DESC
      LIMIT ${limit}`,
    clientNumber, userId, patterns,
  ).catch(() => [] as any[]);

  if (terms.length) {
    for (const r of await keywordRows('title', terms.map(likePattern), 30)) {
      if (!hits.has(r.id)) hits.set(r.id, { ...r, score: KEYWORD_ONLY_SCORE });
    }
  }
  const codes = extractDistinctiveTokens(q);
  if (codes.length) {
    for (const r of await keywordRows('body_markdown', codes.map(likePattern), 10)) {
      if (!hits.has(r.id)) hits.set(r.id, { ...r, score: KEYWORD_ONLY_SCORE });
    }
  }
  if (hits.size === 0) return [];

  const meta = await prisma.$queryRawUnsafe<Array<{ id: string; status: string; page_type: string; last_updated_at: Date | null }>>(
    `SELECT id, status, page_type, last_updated_at FROM wiki_pages
      WHERE client_number = $1 AND (scope = 'tenant' OR (scope = 'user' AND user_id = $2)) AND id = ANY($3::text[])`,
    clientNumber, userId, [...hits.keys()],
  );
  const metaById = new Map(meta.map((m) => [m.id, m]));

  const shown = [...hits.values()].flatMap((h) => {
    const m = metaById.get(h.id);
    if (!m || NOT_SHOWN_STATUS.includes(m.status) || NOT_FACTS.includes(m.page_type) || !h.bodyMarkdown?.trim()) return [];
    const title = String(h.title).toLowerCase();
    const inTitle = terms.filter((t) => title.includes(t)).length;
    return [{ ...h, score: h.score + (terms.length ? TITLE_BONUS * (inTitle / terms.length) : 0) }];
  });
  if (shown.length === 0) return [];

  const ranked = (await rankAndTrim(shown, q, clientNumber, userId)).slice(0, MAX_RESULTS);
  let left = MAX_CHARS;
  return ranked.map((h, i) => {
    // What a short page doesn't use goes to the pages after it.
    const excerpt = excerptOf(String(h.bodyMarkdown ?? ''), terms, Math.floor(left / (ranked.length - i)));
    left -= excerpt.length;
    const at = metaById.get(h.id)?.last_updated_at;
    return {
      page_id: h.id,
      title: h.title,
      excerpt,
      updated_at: at ? new Date(at).toISOString() : null,
      url: `${env.clientUrl.replace(/\/$/, '')}/?tab=wiki&page=${encodeURIComponent(h.id)}`,
    };
  });
}
