/**
 * Functional Charter, contract "Knowledge": GET …/knowledge?q= → at most 5 results, about 4,000
 * characters, no model. Pinned:
 *  1. the shape, the limits, and that a short page's unused budget goes to the next;
 *  2. the excerpt is the paragraph that answers, not the top of the page;
 *  3. a name found only in a title is found, even when embeddings are down;
 *  4. every query is scoped to the tenant and to the user's own or shared pages;
 *  5. Brain's notes about itself, its earlier answers, and disputed pages are not served as facts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: (...a: any[]) => query(...a) } }));
const vector = vi.fn();
vi.mock('../src/services/knowledge/wikiEmbeddingService', () => ({ searchWikiByVector: (...a: any[]) => vector(...a) }));
vi.mock('../src/services/knowledge/brainComposer', () => ({
  rankAndTrim: async (hits: any[]) => [...hits].sort((a, b) => b.score - a.score),
  extractDistinctiveTokens: (q: string) => q.match(/\b[A-Z][A-Z0-9-]*\d[A-Z0-9-]*\b/g) ?? [],
}));

import { excerptOf, MAX_CHARS, MAX_RESULTS, queryTerms, searchKnowledge } from '../src/services/suzi/suziKnowledge';

const page = (id: string, over: any = {}) => ({ id, title: `Page ${id}`, pageType: 'project', bodyMarkdown: `Body of ${id}`, userId: 2, score: 0.5, ...over });

function db(opts: { title?: any[]; body?: any[]; meta?: Record<string, { status?: string; page_type?: string }> } = {}) {
  query.mockImplementation(async (sql: string, _cn: string, _u: number, arg: any) => {
    if (sql.includes('title ILIKE ANY')) return opts.title ?? [];
    if (sql.includes('body_markdown ILIKE ANY')) return opts.body ?? [];
    return (arg as string[]).map((id) => ({ id, status: opts.meta?.[id]?.status ?? 'active', page_type: opts.meta?.[id]?.page_type ?? 'project', last_updated_at: new Date('2026-11-01T10:00:00Z') }));
  });
}

beforeEach(() => { query.mockReset(); vector.mockReset(); vector.mockResolvedValue([]); });

describe('the route\'s results', () => {
  it('have the agreed shape, and at most 5 results', async () => {
    vector.mockResolvedValue(Array.from({ length: 9 }, (_, i) => page(`p${i}`)));
    db();
    const r = await searchKnowledge('TMC-0001', 2, 'project status');
    expect(r).toHaveLength(MAX_RESULTS);
    expect(Object.keys(r[0]).sort()).toEqual(['excerpt', 'page_id', 'title', 'updated_at', 'url']);
    expect(r[0].updated_at).toBe('2026-11-01T10:00:00.000Z');
    expect(r[0].url).toContain(`?tab=wiki&page=${r[0].page_id}`);
  });
  it('stay within about 4,000 characters, and a short page\'s budget goes to the next', async () => {
    const long = 'word '.repeat(4000);
    vector.mockResolvedValue([page('short', { score: 0.9, bodyMarkdown: 'Tiny.' }), page('a', { score: 0.8, bodyMarkdown: long }), page('b', { score: 0.7, bodyMarkdown: long })]);
    db();
    const r = await searchKnowledge('T', 2, 'anything');
    expect(r.map((x) => x.excerpt.length).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_CHARS);
    expect(r[0].excerpt).toBe('Tiny.');
    expect(r[1].excerpt.length).toBeGreaterThan(MAX_CHARS / 3);
  });
  it('an empty question reads nothing', async () => {
    expect(await searchKnowledge('T', 2, '   ')).toEqual([]);
    expect(vector).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('the excerpt', () => {
  const filler = 'nothing relevant here '.repeat(30).trim();
  it('is the paragraph that answers, marked as cut', () => {
    const body = `${filler}\n\n${filler}\n\nThe SFML loan closes in March.\n\n${filler}`;
    const e = excerptOf(body, ['sfml'], 200);
    expect(e.startsWith('… The SFML loan closes in March.')).toBe(true);
    expect(e.endsWith('…')).toBe(true);
    expect(e.length).toBeLessThanOrEqual(200);
  });
  it('with no term found starts at the top; a short page comes back whole', () => {
    expect(excerptOf(`First.\n\n${filler}`, ['absent'], 100).startsWith('First.')).toBe(true);
    expect(excerptOf('Short page.', ['x'], 100)).toBe('Short page.');
  });
  it('terms work in any script and drop the question words', () => {
    expect(queryTerms('who is Guru?')).toEqual(['guru']);
    expect(queryTerms('فہیم کا پروجیکٹ')).toEqual(expect.arrayContaining(['فہیم', 'پروجیکٹ']));
  });
});

describe('finding pages', () => {
  it('a name only in a title is found with embeddings down; LIKE characters in the question never reach the pattern', async () => {
    vector.mockRejectedValue(new Error('embedding down'));
    db({ title: [page('guru', { title: 'Guru', score: undefined })] });
    const r = await searchKnowledge('T', 2, 'who is guru_x%');
    expect(r.map((x) => x.page_id)).toEqual(['guru']);
    const titleCall = query.mock.calls.find((c) => c[0].includes('title ILIKE ANY'))!;
    expect(titleCall[3]).toEqual(['%guru%']);
  });
  it('a title match outranks a closer meaning', async () => {
    vector.mockResolvedValue([page('near', { title: 'Something else', score: 0.6 }), page('named', { title: 'Datagraders contract', score: 0.5 })]);
    db();
    expect((await searchKnowledge('T', 2, 'datagraders'))[0].page_id).toBe('named');
  });
  it('a code is looked for in page bodies', async () => {
    db({ body: [page('coded')] });
    expect((await searchKnowledge('T', 2, 'what happened with R-26-00081'))[0].page_id).toBe('coded');
  });
  it('every query is scoped to the tenant and the user\'s own or shared pages', async () => {
    vector.mockResolvedValue([page('p1')]);
    db({ title: [page('p2')] });
    await searchKnowledge('TMC-0001', 2, 'project R-26-00081');
    expect(vector.mock.calls[0].slice(0, 2)).toEqual(['TMC-0001', 2]);
    expect(query.mock.calls.length).toBe(3);
    for (const c of query.mock.calls) {
      expect(c[0]).toContain("scope = 'tenant' OR (scope = 'user' AND user_id = $2)");
      expect(c.slice(1, 3)).toEqual(['TMC-0001', 2]);
    }
  });
  it('a page the scoped read doesn\'t return is never served', async () => {
    vector.mockResolvedValue([page('other_user')]);
    query.mockResolvedValue([]);
    expect(await searchKnowledge('T', 2, 'anything')).toEqual([]);
  });
  it('notes, earlier answers, disputed pages and empty pages aren\'t served as facts', async () => {
    vector.mockResolvedValue([page('note'), page('ans'), page('gap'), page('disputed'), page('draft'), page('empty', { bodyMarkdown: '  ' }), page('real')]);
    db({ meta: { note: { page_type: 'observation' }, ans: { page_type: 'answer' }, gap: { page_type: 'gap' }, disputed: { status: 'contradicted' }, draft: { status: 'draft' } } });
    expect((await searchKnowledge('T', 2, 'anything')).map((x) => x.page_id)).toEqual(['real']);
  });
});
