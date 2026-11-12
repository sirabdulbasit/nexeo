/**
 * Wiki store — the one door into and out of the wiki (docs/BRAIN_WIKI.md).
 *
 * Brain has three aspects: Feed brings information in, the Wiki stores and
 * connects it, Think reacts from it. This module is the boundary on both
 * sides of the Wiki:
 *
 *   Feed  → writeNote()            the only way a note is written
 *   Think → getNote(), backlinks() the only way a note is read
 *
 * A note is a row in `wiki_pages`. What makes it work like Obsidian:
 *   - links live in the note text as `[[Title]]`; the rows in
 *     `wiki_page_links` with link_type 'wikilink' are rebuilt from the text on
 *     every write, so the text is the truth;
 *   - a link to a note that does not exist yet is kept as unresolved and
 *     becomes a real link the moment that note is written;
 *   - structured facts (emails, phones, due date, state) are the note's
 *     properties, kept in `metadata.properties`.
 *
 * Visibility is the existing rule (wikiScope.ts): a note is readable when it
 * is tenant-scoped, or user-scoped and owned by the reader. Links never cross
 * that line.
 */
import prisma from '../../db/prisma';
import { cleanTitle, extractWikiLinks, titleKey } from './wikiLinks';

const db = prisma as any;

/** The link type this module owns. Older rows of other types are left alone. */
export const WIKILINK = 'wikilink';

export interface NoteSource {
  feedEventId?: string;
  decisionLogId?: string;
  openItemId?: string;
}

export interface NoteInput {
  clientNumber: string;
  userId: number;
  /** person | company | project | topic | meeting | decision | commitment | instruction | … */
  type: string;
  title: string;
  /** Markdown. `[[Title]]` links in it become the note's links. */
  body: string;
  /** Structured facts. Merged over the note's existing properties; a null value removes a key. */
  properties?: Record<string, unknown>;
  /** Default 'user' for a new note; an existing note keeps its scope unless this is given. */
  scope?: 'user' | 'tenant';
  /** Where the content came from. A source already cited by the note is not cited twice. */
  sources?: NoteSource[];
  /** Who is writing: 'feed:gmail', 'user:12', 'upkeep'. */
  actor: string;
}

export interface NoteRef {
  id: string;
  type: string;
  title: string;
}

export interface Note extends NoteRef {
  clientNumber: string;
  userId: number;
  scope: string;
  status: string;
  body: string;
  properties: Record<string, unknown>;
  /** Notes this note links to. */
  links: NoteRef[];
  /** Notes that link to this note. */
  backlinks: NoteRef[];
  /** Titles this note links to that no note has yet. */
  unresolved: string[];
  updatedAt: Date;
}

export interface WriteResult {
  id: string;
  created: boolean;
  linked: number;
  unresolved: string[];
}

function visibleTo(clientNumber: string, userId: number) {
  return { clientNumber, OR: [{ scope: 'tenant' }, { scope: 'user', userId }] };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

function mergeProperties(existing: unknown, incoming?: Record<string, unknown>): Record<string, unknown> {
  const out = asRecord(existing);
  for (const [k, v] of Object.entries(incoming ?? {})) {
    if (v === null || v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** Recount a note's link counters from the link rows. */
async function recount(pageIds: Iterable<string>): Promise<void> {
  for (const id of new Set(pageIds)) {
    const [outbound, inbound] = await Promise.all([
      db.wikiPageLink.count({ where: { fromPageId: id } }),
      db.wikiPageLink.count({ where: { toPageId: id } }),
    ]);
    await db.wikiPage.update({ where: { id }, data: { outboundLinks: outbound, inboundLinks: inbound } });
  }
}

/**
 * Pick the note a title points at. Titles are unique per type, not across
 * types, so one title can match several notes: the most recently updated
 * wins, and a note of the linking user wins over a shared one.
 */
function pickTarget(candidates: any[], userId: number): any | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const own = Number(b.userId === userId) - Number(a.userId === userId);
    if (own !== 0) return own;
    return new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime();
  })[0];
}

/** Write a note: create it or update it, and rebuild its links from its text. */
export async function writeNote(input: NoteInput): Promise<WriteResult> {
  const title = cleanTitle(input.title);
  if (!title) throw new Error('wikiStore.writeNote: a note needs a title');
  if (!input.type) throw new Error('wikiStore.writeNote: a note needs a type');
  const { clientNumber, userId, type } = input;
  const body = input.body ?? '';
  const identity = { clientNumber, userId, pageType: type, title };

  let existing = await db.wikiPage.findFirst({ where: identity });

  // Resolve the links in the text to notes the writer can see.
  const wanted = extractWikiLinks(body).filter((l) => l.key !== titleKey(title));
  const candidates = wanted.length
    ? await db.wikiPage.findMany({
        where: {
          AND: [
            visibleTo(clientNumber, userId),
            { OR: wanted.map((l) => ({ title: { equals: l.title, mode: 'insensitive' } })) },
          ],
        },
        select: { id: true, title: true, pageType: true, userId: true, scope: true, lastUpdatedAt: true },
      })
    : [];
  const targets = new Map<string, any>();
  const unresolved: string[] = [];
  for (const link of wanted) {
    const hit = pickTarget(
      candidates.filter((c: any) => titleKey(c.title) === link.key && c.id !== existing?.id),
      userId,
    );
    if (hit) targets.set(hit.id, hit);
    else unresolved.push(link.key);
  }

  const metadata = {
    ...asRecord(existing?.metadata),
    properties: mergeProperties(asRecord(existing?.metadata).properties, input.properties),
    unresolvedLinks: unresolved,
  };
  const data = {
    bodyMarkdown: body,
    metadata,
    storage: 'postgres',
    lastUpdatedBy: input.actor,
    lastUpdatedAt: new Date(),
    ...(input.scope ? { scope: input.scope } : {}),
  };

  let created = false;
  if (!existing) {
    try {
      existing = await db.wikiPage.create({ data: { ...identity, ...data, status: 'active' } });
      created = true;
    } catch (err: any) {
      // Two writers created the same note at once: the other one won, so update it.
      if (err?.code !== 'P2002') throw err;
      existing = await db.wikiPage.findFirst({ where: identity });
      if (!existing) throw err;
    }
  }
  if (!created) {
    await db.wikiPage.update({ where: { id: existing.id }, data: { ...data, status: 'active' } });
  }
  const id: string = existing.id;

  // Rebuild this note's outgoing links from the text.
  const before = await db.wikiPageLink.findMany({
    where: { fromPageId: id, linkType: WIKILINK },
    select: { toPageId: true },
  });
  await db.wikiPageLink.deleteMany({ where: { fromPageId: id, linkType: WIKILINK } });
  if (targets.size > 0) {
    await db.wikiPageLink.createMany({
      data: [...targets.keys()].map((toPageId) => ({ clientNumber, userId, fromPageId: id, toPageId, linkType: WIKILINK })),
      skipDuplicates: true,
    });
  }
  const touched = new Set<string>([id, ...before.map((b: any) => b.toPageId), ...targets.keys()]);

  // A new note may be the one other notes were already pointing at.
  if (created) {
    const scope = existing.scope ?? input.scope ?? 'user';
    const waiting = await db.wikiPage.findMany({
      where: {
        clientNumber,
        id: { not: id },
        ...(scope === 'tenant' ? {} : { userId }),
        metadata: { path: ['unresolvedLinks'], array_contains: [titleKey(title)] },
      },
      select: { id: true, userId: true, metadata: true },
    });
    for (const w of waiting) {
      await db.wikiPageLink.createMany({
        data: [{ clientNumber, userId: w.userId, fromPageId: w.id, toPageId: id, linkType: WIKILINK }],
        skipDuplicates: true,
      });
      const meta = asRecord(w.metadata);
      const left = (Array.isArray(meta.unresolvedLinks) ? meta.unresolvedLinks : []).filter(
        (k: unknown) => k !== titleKey(title),
      );
      await db.wikiPage.update({ where: { id: w.id }, data: { metadata: { ...meta, unresolvedLinks: left } } });
      touched.add(w.id);
    }
  }

  // Cite the sources, each once.
  let cited = false;
  for (const s of input.sources ?? []) {
    if (!s.feedEventId && !s.decisionLogId && !s.openItemId) continue;
    const ref = {
      wikiPageId: id,
      feedEventId: s.feedEventId ?? null,
      decisionLogId: s.decisionLogId ?? null,
      openItemId: s.openItemId ?? null,
    };
    if (await db.wikiPageSource.findFirst({ where: ref, select: { id: true } })) continue;
    await db.wikiPageSource.create({ data: { ...ref, clientNumber, userId } });
    cited = true;
  }
  if (cited) {
    const sourceCount = await db.wikiPageSource.count({ where: { wikiPageId: id } });
    await db.wikiPage.update({ where: { id }, data: { sourceCount } });
  }

  await recount(touched);
  return { id, created, linked: targets.size, unresolved };
}

/** Notes that link to this note, as far as the reader may see them. */
export async function backlinks(clientNumber: string, userId: number, noteId: string): Promise<NoteRef[]> {
  const rows = await db.wikiPageLink.findMany({
    where: { toPageId: noteId, fromPage: visibleTo(clientNumber, userId) },
    select: { fromPage: { select: { id: true, pageType: true, title: true } } },
  });
  return dedupe(rows.map((r: any) => r.fromPage));
}

function dedupe(pages: any[]): NoteRef[] {
  const seen = new Map<string, NoteRef>();
  for (const p of pages) if (p && !seen.has(p.id)) seen.set(p.id, { id: p.id, type: p.pageType, title: p.title });
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Read one note with its links and backlinks. Find it by id, or by title
 * (any spelling of the case; give `type` when one title exists under several).
 */
export async function getNote(
  clientNumber: string,
  userId: number,
  by: { id: string } | { title: string; type?: string },
): Promise<Note | null> {
  const where =
    'id' in by
      ? { id: by.id, ...visibleTo(clientNumber, userId) }
      : {
          ...visibleTo(clientNumber, userId),
          title: { equals: cleanTitle(by.title), mode: 'insensitive' },
          ...(by.type ? { pageType: by.type } : {}),
        };
  const row = 'id' in by ? await db.wikiPage.findFirst({ where }) : pickTarget(await db.wikiPage.findMany({ where }), userId);
  if (!row) return null;

  const out = await db.wikiPageLink.findMany({
    where: { fromPageId: row.id, toPage: visibleTo(clientNumber, userId) },
    select: { toPage: { select: { id: true, pageType: true, title: true } } },
  });
  const meta = asRecord(row.metadata);
  return {
    id: row.id,
    type: row.pageType,
    title: row.title,
    clientNumber: row.clientNumber,
    userId: row.userId,
    scope: row.scope,
    status: row.status,
    body: row.bodyMarkdown ?? '',
    properties: asRecord(meta.properties),
    links: dedupe(out.map((r: any) => r.toPage)),
    backlinks: await backlinks(clientNumber, userId, row.id),
    unresolved: Array.isArray(meta.unresolvedLinks) ? (meta.unresolvedLinks as string[]) : [],
    updatedAt: row.lastUpdatedAt,
  };
}
