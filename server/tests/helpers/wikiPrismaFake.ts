/**
 * An in-memory stand-in for the Wiki's tables, shared by the store tests.
 * It keeps what the store relies on: filters on title, status, owner and the
 * metadata fields the store queries; link and citation rows; and transactions
 * that really roll back, so "all or nothing" can be tested.
 */
export const t = {
  pages: [] as any[],
  links: [] as any[],
  sources: [] as any[], // wiki_page_sources
  cites: [] as Array<{ note_id: string; source_id: string }>, // wiki_note_sources
  srcs: [] as any[], // wiki_sources: { id, client_number, user_id, scope }
  seq: 0,
  /** Throw once when this operation is next called, e.g. 'wikiPageLink.createMany'. */
  failOn: null as string | null,
  /** Called once just before the next revision claim, to play a second writer. */
  beforeClaim: null as null | (() => void),
  /** What the second writer did during the open transaction: it committed, so a rollback must not undo it. */
  committedElsewhere: [] as Array<() => void>,
};

export function resetWiki(): void {
  t.pages = []; t.links = []; t.sources = []; t.cites = []; t.srcs = []; t.seq = 0; t.failOn = null; t.beforeClaim = null; t.committedElsewhere = [];
}

const page = (id: string) => t.pages.find((p) => p.id === id);
const eq = (a: string, f: any) =>
  typeof f === 'string' ? a === f : f.mode === 'insensitive' ? a.toLowerCase() === f.equals.toLowerCase() : a === f.equals;

function match(p: any, w: any): boolean {
  if (!p) return false;
  return Object.entries(w ?? {}).every(([k, v]: [string, any]) => {
    if (k === 'AND') return v.every((c: any) => match(p, c));
    if (k === 'OR') return v.some((c: any) => match(p, c));
    if (k === 'title') return eq(p.title, v);
    if (k === 'id' && v && typeof v === 'object') return 'in' in v ? v.in.includes(p.id) : p.id !== v.not;
    if (k === 'metadata') {
      const field = p.metadata?.[v.path[0]];
      return 'equals' in v ? field === v.equals : (Array.isArray(field) ? field : []).includes(v.array_contains[0]);
    }
    return p[k] === v;
  });
}

function linkMatch(l: any, w: any): boolean {
  return Object.entries(w ?? {}).every(([k, v]: [string, any]) => {
    if (k === 'OR') return v.some((c: any) => linkMatch(l, c));
    if (k === 'fromPage') return match(page(l.fromPageId), v);
    if (k === 'toPage') return match(page(l.toPageId), v);
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(l[k]);
    return l[k] === v;
  });
}

function fail(op: string): void {
  if (t.failOn === op) {
    t.failOn = null;
    throw new Error(`injected failure at ${op}`);
  }
}

export const prismaFake: any = {
  $transaction: async (fn: any) => {
    const snap = structuredClone({ pages: t.pages, links: t.links, sources: t.sources, cites: t.cites, seq: t.seq });
    t.committedElsewhere = [];
    try {
      return await fn(prismaFake);
    } catch (err) {
      Object.assign(t, snap);
      for (const redo of t.committedElsewhere) redo();
      throw err;
    } finally {
      t.committedElsewhere = [];
    }
  },
  $queryRawUnsafe: async (sql: string, ...a: any[]) => {
    if (/FROM wiki_sources WHERE client_number = \$1 AND id = ANY/.test(sql)) return t.srcs.filter((s) => s.client_number === a[0] && (a[1] as string[]).includes(s.id));
    if (/FROM wiki_pages\s+WHERE id = \$1 AND client_number = \$2/.test(sql)) {
      return t.pages.filter((n) => n.id === a[0] && n.clientNumber === a[1] && (n.scope === 'tenant' || n.userId === a[2]))
        .map((n) => ({ client_number: n.clientNumber, user_id: n.userId, scope: n.scope }));
    }
    if (/SELECT source_id FROM wiki_note_sources WHERE note_id = \$1/.test(sql)) return t.cites.filter((c) => c.note_id === a[0]).map((c) => ({ source_id: c.source_id }));
    throw new Error(`unexpected query: ${sql}`);
  },
  $executeRawUnsafe: async (sql: string, ...a: any[]) => {
    if (/UPDATE wiki_pages SET last_updated_at = last_updated_at/.test(sql)) {
      if (t.beforeClaim) { const f = t.beforeClaim; t.beforeClaim = null; f(); t.committedElsewhere.push(f); }
      const p = page(a[0]);
      return p && (Number(p.metadata?.rev ?? 0) || 0) === a[1] ? 1 : 0;
    }
    if (/INSERT INTO wiki_note_sources \(note_id, source_id\)\s+SELECT \$1, s FROM unnest/.test(sql)) {
      fail('citeSources');
      for (const id of a[1] as string[]) if (!t.cites.some((c) => c.note_id === a[0] && c.source_id === id)) t.cites.push({ note_id: a[0], source_id: id });
      return 1;
    }
    if (/INSERT INTO wiki_note_sources \(note_id, source_id\) SELECT \$1, source_id FROM wiki_note_sources WHERE note_id = \$2/.test(sql)) {
      for (const c of t.cites.filter((x) => x.note_id === a[1])) if (!t.cites.some((x) => x.note_id === a[0] && x.source_id === c.source_id)) t.cites.push({ note_id: a[0], source_id: c.source_id });
      return 1;
    }
    if (/INSERT INTO wiki_note_sources \(note_id, source_id\) VALUES/.test(sql)) {
      if (!t.cites.some((c) => c.note_id === a[0] && c.source_id === a[1])) t.cites.push({ note_id: a[0], source_id: a[1] });
      return 1;
    }
    if (/DELETE FROM wiki_note_sources WHERE note_id = \$1 AND NOT \(source_id = ANY/.test(sql)) { t.cites = t.cites.filter((c) => c.note_id !== a[0] || (a[1] as string[]).includes(c.source_id)); return 1; }
    if (/DELETE FROM wiki_note_sources WHERE note_id = \$1 AND source_id = \$2/.test(sql)) { t.cites = t.cites.filter((c) => !(c.note_id === a[0] && c.source_id === a[1])); return 1; }
    if (/DELETE FROM wiki_note_sources WHERE note_id = \$1/.test(sql)) { t.cites = t.cites.filter((c) => c.note_id !== a[0]); return 1; }
    if (/UPDATE wiki_pages SET source_count/.test(sql)) {
      const p = page(a[0]);
      if (p) p.sourceCount = t.sources.filter((s) => s.wikiPageId === a[0]).length + t.cites.filter((c) => c.note_id === a[0]).length;
      return 1;
    }
    throw new Error(`unexpected statement: ${sql}`);
  },
  wikiPage: {
    findUnique: async ({ where }: any) => page(where.id) ?? null,
    findFirst: async ({ where }: any) => t.pages.find((x) => match(x, where)) ?? null,
    findMany: async ({ where }: any) => t.pages.filter((x) => match(x, where)),
    create: async ({ data }: any) => {
      fail('wikiPage.create');
      if (t.pages.some((x) => x.clientNumber === data.clientNumber && x.userId === data.userId && x.pageType === data.pageType && x.title === data.title)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row = { id: `p${++t.seq}`, scope: 'user', inboundLinks: 0, outboundLinks: 0, sourceCount: 0, ...data };
      t.pages.push(row);
      return row;
    },
    update: async ({ where, data }: any) => { fail('wikiPage.update'); return Object.assign(page(where.id), data); },
  },
  wikiPageLink: {
    findMany: async ({ where }: any) =>
      t.links.filter((l) => linkMatch(l, where)).map((l) => ({ ...l, fromPage: page(l.fromPageId), toPage: page(l.toPageId) })),
    deleteMany: async ({ where }: any) => { t.links = t.links.filter((l) => !linkMatch(l, where)); },
    createMany: async ({ data }: any) => {
      fail('wikiPageLink.createMany');
      for (const d of data) if (!t.links.some((l) => l.fromPageId === d.fromPageId && l.toPageId === d.toPageId && l.linkType === d.linkType)) t.links.push(d);
    },
    count: async ({ where }: any) => t.links.filter((l) => linkMatch(l, where)).length,
  },
  wikiPageSource: {
    findFirst: async ({ where }: any) => t.sources.find((s) => Object.entries(where).every(([k, v]) => s[k] === v)) ?? null,
    create: async ({ data }: any) => t.sources.push(data),
    count: async ({ where }: any) => t.sources.filter((s) => s.wikiPageId === where.wikiPageId).length,
  },
};
