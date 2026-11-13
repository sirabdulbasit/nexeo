/**
 * Wiki store — the one door into and out of the wiki (docs/Wiki-Knowledge.md).
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
 *
 * Identity (docs/Wiki-Knowledge.md §0.7 standard 2, §0.13 parts 6 and 7):
 *   - a note's id never changes; its title is a label that may;
 *   - `metadata.ids` are its outside identifiers (`email:a@x.com`,
 *     `rule:instruction:<id>`): a write that carries one of them finds the
 *     note whatever its title has become, and a new title renames it;
 *   - `metadata.aliases` are its other names (former titles): a link written
 *     with an alias still reaches the note;
 *   - a link reaches a note only when exactly one live note answers to the
 *     name; two answers leave it unresolved and recorded as ambiguous;
 *   - a note's text, properties, links and citations are written in one
 *     transaction, guarded by its revision (`metadata.rev`), so two writers
 *     cannot overwrite each other and a failed write leaves nothing half done;
 *   - two notes become one only through `mergeNotes`, which records what it
 *     moved so `unmergeNote` can put it back.
 */
import prisma from '../../db/prisma';
import { cleanTitle, extractWikiLinks, titleKey } from './wikiLinks';
import { citeSources, assertCitable } from './wikiSources';

// The one door: sources are read and written through here too.
export {
  saveSource, citeSources, assertCitable, mayCite, CitationRefused, sourcesHeld,
  sourcesOf, readSource, listSources, countSources,
} from './wikiSources';
export type { Source, SourceRef, SourceInput, SourceKind, CiteParty, Writer } from './wikiSources';
export { markSource, clearMark, marksOf, markHistory, listMarkedSources, countUnmarked, MarkRefused, MARK_KINDS } from './wikiMarks';
export type { Mark, MarkInput, MarkKind, MarkedSource } from './wikiMarks';


/** Marks a row of `wiki_pages` as a note of the new wiki (`metadata.wiki`); the old pages do not carry it. */
export const WIKI_GENERATION = 2;

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
  /** The sources in the Wiki's source store this note was learned from (wikiSources). */
  sourceIds?: string[];
  /**
   * Outside identifiers of the thing the note is about, as `kind:value`
   * (`email:ali@x.com`, `domain:x.com`, `rule:instruction:<id>`). A note that
   * already carries one of them is the note being written, whatever its title.
   */
  ids?: string[];
  /** Other names the note answers to in links. Former titles are added by the store. */
  aliases?: string[];
  /** Write only if the note is still at this revision (a person editing what they read). */
  ifRevision?: number;
  /**
   * This write states the whole note (a builder that derives it from sources): its identifiers
   * and its citations become exactly the ones given, instead of being added to what is there.
   */
  exact?: boolean;
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
  /** Links that more than one note answers to: left unresolved on purpose. */
  ambiguous: string[];
  /** The note's revision after this write. */
  revision: number;
  /** Set when this write gave the note a new title; the old one became an alias. */
  renamedFrom?: string;
}

/** Another writer changed the note first. Nothing was written. */
export class WriteConflict extends Error {
  constructor(noteId: string) {
    super(`wikiStore: note ${noteId} was changed by another writer`);
    this.name = 'WriteConflict';
  }
}

/** The identifiers given belong to more than one note. Nothing was written: merge them first, on evidence. */
export class IdentityConflict extends Error {
  constructor(public readonly noteIds: string[], ids: string[]) {
    super(`wikiStore: identifiers ${ids.join(', ')} belong to ${noteIds.length} notes (${noteIds.join(', ')})`);
    this.name = 'IdentityConflict';
  }
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
async function recount(pageIds: Iterable<string>, db: any = prisma): Promise<void> {
  for (const id of new Set(pageIds)) {
    const outbound = await db.wikiPageLink.count({ where: { fromPageId: id } });
    const inbound = await db.wikiPageLink.count({ where: { toPageId: id } });
    await db.wikiPage.update({ where: { id }, data: { outboundLinks: outbound, inboundLinks: inbound } });
  }
}

/** A note: a row of `wiki_pages` that carries the wiki marker. */
const IS_NOTE = { metadata: { path: ['wiki'], equals: WIKI_GENERATION } };

/** An integration's record page is a link's target only when no other note has the name. */
const RECORD_TYPES = new Set(['org_doc']);

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
}

/** Outside identifiers as stored: `kind:value`, lower case, each once. Anything without a kind is dropped. */
export function normalizeIds(ids?: unknown): string[] {
  return [...new Set(strings(ids).map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z_]+:.+/.test(x)))].sort();
}

function uniqueTitles(titles: string[], not: string): string[] {
  const seen = new Set<string>([titleKey(not)]);
  const out: string[] = [];
  for (const t of titles.map(cleanTitle)) {
    if (!t || seen.has(titleKey(t))) continue;
    seen.add(titleKey(t));
    out.push(t);
  }
  return out;
}

export interface LinkCandidate { id: string; title: string; pageType: string; aliasKeys: string[] }

/**
 * Which note a link reaches. A note titled with the name beats one that only
 * has it as an alias; a record page gives way to any other note; and if more
 * than one note is still left, the link is ambiguous and reaches none.
 */
export function resolveLink(key: string, candidates: LinkCandidate[]): { hit: LinkCandidate | null; ambiguous: boolean } {
  const titled = candidates.filter((c) => titleKey(c.title) === key);
  const named = titled.length ? titled : candidates.filter((c) => c.aliasKeys.includes(key));
  const things = named.filter((c) => !RECORD_TYPES.has(c.pageType));
  const pool = things.length ? things : named;
  return { hit: pool.length === 1 ? pool[0] : null, ambiguous: pool.length > 1 };
}

/** The live notes the reader may see that answer to any of these names (by title or by alias). */
async function notesNamed(db: any, clientNumber: string, userId: number, names: Array<{ title: string; key: string }>): Promise<LinkCandidate[]> {
  if (names.length === 0) return [];
  const rows = await db.wikiPage.findMany({
    where: {
      AND: [
        visibleTo(clientNumber, userId),
        { status: 'active' },
        IS_NOTE,
        {
          OR: names.flatMap((l) => [
            { title: { equals: l.title, mode: 'insensitive' as const } },
            { metadata: { path: ['aliasKeys'], array_contains: [l.key] } },
          ]),
        },
      ],
    },
    select: { id: true, title: true, pageType: true, metadata: true },
  });
  return rows.map((r: any) => ({ id: r.id, title: r.title, pageType: r.pageType, aliasKeys: strings(asRecord(r.metadata).aliasKeys) }));
}

/** Read the links out of a note's text and say which note each one reaches. */
async function resolveLinks(
  db: any, clientNumber: string, userId: number, body: string, selfId: string | null, selfTitle: string,
): Promise<{ targets: string[]; unresolved: string[]; ambiguous: string[] }> {
  const wanted = extractWikiLinks(body).filter((l) => l.key !== titleKey(selfTitle));
  const candidates = (await notesNamed(db, clientNumber, userId, wanted)).filter((c) => c.id !== selfId);
  const targets = new Set<string>();
  const unresolved: string[] = [];
  const ambiguous: string[] = [];
  for (const link of wanted) {
    const r = resolveLink(link.key, candidates);
    if (r.hit) targets.add(r.hit.id);
    else {
      unresolved.push(link.key);
      if (r.ambiguous) ambiguous.push(link.key);
    }
  }
  return { targets: [...targets], unresolved, ambiguous };
}

/** For reads by title: the reader's own note first, then the most recently updated. */
function pickTarget(candidates: any[], userId: number): any | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const own = Number(b.userId === userId) - Number(a.userId === userId);
    if (own !== 0) return own;
    return new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime();
  })[0];
}

/**
 * Write a note: create it or update it, with its links and citations, in one
 * transaction. Either all of it is written or none of it.
 */
export async function writeNote(input: NoteInput): Promise<WriteResult> {
  if (!cleanTitle(input.title)) throw new Error('wikiStore.writeNote: a note needs a title');
  if (!input.type) throw new Error('wikiStore.writeNote: a note needs a type');
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction((tx: any) => writeNoteIn(tx, input), { timeout: 30_000 });
    } catch (err: any) {
      // Another writer got there first (a changed revision, or the same new note created twice): look
      // again, once. A caller that named the revision it read is told instead, and decides.
      const raced = err instanceof WriteConflict || err?.code === 'P2002';
      if (!raced || attempt > 0 || input.ifRevision !== undefined) throw err;
    }
  }
}

async function writeNoteIn(tx: any, input: NoteInput): Promise<WriteResult> {
  const title = cleanTitle(input.title);
  const { clientNumber, userId, type } = input;
  const body = input.body ?? '';
  const ids = normalizeIds(input.ids);
  const owner = { clientNumber, userId, pageType: type };

  // 1. Which note is this? Its outside identifiers first, then its title, then an alias.
  let existing: any = null;
  let foundByAlias = false;
  if (ids.length) {
    const same = await tx.wikiPage.findMany({
      where: { AND: [owner, IS_NOTE, { OR: ids.map((id) => ({ metadata: { path: ['ids'], array_contains: [id] } })) }] },
    });
    if (same.length > 1) throw new IdentityConflict(same.map((n: any) => n.id), ids);
    existing = same[0] ?? null;
  }
  const titled = await tx.wikiPage.findFirst({ where: { ...owner, title } });
  if (!existing) existing = titled;
  if (!existing) {
    const aliased = await tx.wikiPage.findMany({
      where: { AND: [owner, IS_NOTE, { status: 'active' }, { metadata: { path: ['aliasKeys'], array_contains: [titleKey(title)] } }] },
    });
    if (aliased.length === 1) {
      existing = aliased[0];
      foundByAlias = true;
    }
  }
  const meta = asRecord(existing?.metadata);
  const rev = Number(meta.rev ?? 0) || 0;
  if (existing && input.ifRevision !== undefined && input.ifRevision !== rev) throw new WriteConflict(existing.id);

  // 2. Who may read a note follows where its content came from: every source is
  //    checked against the note's visibility before a word of it is written.
  const scope = input.scope ?? existing?.scope ?? 'user';
  if (input.sourceIds?.length) await assertCitable({ clientNumber, userId, scope }, input.sourceIds, tx);

  // 3. Its title. A write that found the note by an identifier names it; one that found it by an
  //    alias used an old name and leaves the title alone. A title another note holds is not taken
  //    from it: the note keeps its own and gains the wanted name as an alias.
  const taken = !!existing && !!titled && titled.id !== existing.id;
  const finalTitle = !existing ? title : foundByAlias || taken ? existing.title : title;
  const renamedFrom = existing && titleKey(existing.title) !== titleKey(finalTitle) ? existing.title : undefined;
  const aliases = uniqueTitles(
    [...strings(meta.aliases), ...(input.aliases ?? []), ...(renamedFrom ? [renamedFrom] : []), ...(taken ? [title] : [])],
    finalTitle,
  );
  const aliasKeys = aliases.map(titleKey);
  const newKeys = [titleKey(finalTitle), ...aliasKeys].filter(
    (k) => !existing || existing.status !== 'active' || (k !== titleKey(existing.title) && !strings(meta.aliasKeys).includes(k)),
  );

  // 4. Its links, read from the text.
  const links = await resolveLinks(tx, clientNumber, userId, body, existing?.id ?? null, finalTitle);

  const metadata = {
    ...meta,
    wiki: WIKI_GENERATION,
    properties: mergeProperties(meta.properties, input.properties),
    unresolvedLinks: links.unresolved,
    ambiguousLinks: links.ambiguous,
    ids: input.exact ? ids : normalizeIds([...strings(meta.ids), ...ids]),
    aliases,
    aliasKeys,
    rev: rev + 1,
  };
  const data = {
    title: finalTitle,
    bodyMarkdown: body,
    metadata,
    storage: 'postgres',
    status: 'active',
    lastUpdatedBy: input.actor,
    lastUpdatedAt: new Date(),
    ...(input.scope ? { scope: input.scope } : {}),
  };

  // 5. The note itself. An update first claims the revision it read: if another writer has moved
  //    it on, nothing of this write is kept.
  let id: string;
  const created = !existing;
  if (!existing) {
    id = (await tx.wikiPage.create({ data: { ...owner, ...data } })).id;
  } else {
    id = existing.id;
    const claimed = await tx.$executeRawUnsafe(
      `UPDATE wiki_pages SET last_updated_at = last_updated_at
        WHERE id = $1 AND COALESCE((metadata->>'rev')::int, 0) = $2`,
      id, rev,
    );
    if (Number(claimed) !== 1) throw new WriteConflict(id);
    await tx.wikiPage.update({ where: { id }, data });
  }

  // 6. Its outgoing links, rebuilt from the text.
  const before = await tx.wikiPageLink.findMany({ where: { fromPageId: id, linkType: WIKILINK }, select: { toPageId: true } });
  await tx.wikiPageLink.deleteMany({ where: { fromPageId: id, linkType: WIKILINK } });
  if (links.targets.length > 0) {
    await tx.wikiPageLink.createMany({
      data: links.targets.map((toPageId) => ({ clientNumber, userId, fromPageId: id, toPageId, linkType: WIKILINK })),
      skipDuplicates: true,
    });
  }
  const touched = new Set<string>([id, ...before.map((b: any) => b.toPageId), ...links.targets]);

  // 7. A name this note has just taken may be one other notes were waiting for. They are connected
  //    only if this note is the single answer to that name.
  for (const key of newKeys) {
    const answers = await notesNamed(tx, clientNumber, userId, [{ title: key, key }]);
    if (resolveLink(key, answers).hit?.id !== id) continue;
    const waiting = await tx.wikiPage.findMany({
      where: {
        clientNumber,
        id: { not: id },
        ...(scope === 'tenant' ? {} : { userId }),
        metadata: { path: ['unresolvedLinks'], array_contains: [key] },
      },
      select: { id: true, userId: true, metadata: true },
    });
    for (const w of waiting) {
      await tx.wikiPageLink.createMany({
        data: [{ clientNumber, userId: w.userId, fromPageId: w.id, toPageId: id, linkType: WIKILINK }],
        skipDuplicates: true,
      });
      const wm = asRecord(w.metadata);
      await tx.wikiPage.update({
        where: { id: w.id },
        data: { metadata: { ...wm, unresolvedLinks: strings(wm.unresolvedLinks).filter((k) => k !== key), ambiguousLinks: strings(wm.ambiguousLinks).filter((k) => k !== key) } },
      });
      touched.add(w.id);
    }
  }

  // 8. Its citations, each once.
  let cited = false;
  for (const s of input.sources ?? []) {
    if (!s.feedEventId && !s.decisionLogId && !s.openItemId) continue;
    const ref = { wikiPageId: id, feedEventId: s.feedEventId ?? null, decisionLogId: s.decisionLogId ?? null, openItemId: s.openItemId ?? null };
    if (await tx.wikiPageSource.findFirst({ where: ref, select: { id: true } })) continue;
    await tx.wikiPageSource.create({ data: { ...ref, clientNumber, userId } });
    cited = true;
  }
  if (cited) {
    const sourceCount = await tx.wikiPageSource.count({ where: { wikiPageId: id } });
    await tx.wikiPage.update({ where: { id }, data: { sourceCount } });
  }
  if (input.exact && !created) {
    // The trail is exactly the sources this note is now built from.
    await tx.$executeRawUnsafe(
      `DELETE FROM wiki_note_sources WHERE note_id = $1 AND NOT (source_id = ANY($2::text[]))`,
      id, [...new Set((input.sourceIds ?? []).filter(Boolean))],
    );
    await tx.$executeRawUnsafe(
      `UPDATE wiki_pages SET source_count =
          (SELECT COUNT(*) FROM wiki_page_sources WHERE wiki_page_id = $1)
        + (SELECT COUNT(*) FROM wiki_note_sources WHERE note_id = $1)
        WHERE id = $1`,
      id,
    );
  }
  if (input.sourceIds?.length) await citeSources({ clientNumber, userId }, id, input.sourceIds, tx);

  await recount(touched, tx);
  return { id, created, linked: links.targets.length, unresolved: links.unresolved, ambiguous: links.ambiguous, revision: rev + 1, ...(renamedFrom ? { renamedFrom } : {}) };
}

/**
 * Take a note out of the wiki without deleting it: readers skip a retired
 * note, its links are removed, and writing the note again brings it back.
 */
export async function retireNote(noteId: string, actor: string): Promise<void> {
  const links = await prisma.wikiPageLink.findMany({
    where: { linkType: WIKILINK, OR: [{ fromPageId: noteId }, { toPageId: noteId }] },
    select: { fromPageId: true, toPageId: true },
  });
  await prisma.wikiPageLink.deleteMany({ where: { linkType: WIKILINK, OR: [{ fromPageId: noteId }, { toPageId: noteId }] } });
  await prisma.wikiPage.update({ where: { id: noteId }, data: { status: 'superseded', lastUpdatedBy: actor, lastUpdatedAt: new Date() } });
  await recount(links.flatMap((l) => [l.fromPageId, l.toPageId]));
}

/**
 * Take a page another writer stores (an integration's record page) into the
 * wiki: mark it as a note and rebuild its links from its text. The writer
 * keeps its own identity, hashing and stale rules; this only adds what makes
 * the page a note. Call it after every write of that page, because such a
 * writer replaces the page's metadata each time.
 */
export async function adoptAsNote(pageId: string): Promise<{ linked: number; unresolved: string[] } | null> {
  const page = await prisma.wikiPage.findUnique({ where: { id: pageId } });
  if (!page) return null;
  const { clientNumber, userId } = page;
  const links = await resolveLinks(prisma, clientNumber, userId, page.bodyMarkdown ?? '', pageId, page.title);
  await prisma.wikiPage.update({
    where: { id: pageId },
    data: { metadata: { ...asRecord(page.metadata), wiki: WIKI_GENERATION, unresolvedLinks: links.unresolved, ambiguousLinks: links.ambiguous } as any },
  });
  const before = await prisma.wikiPageLink.findMany({ where: { fromPageId: pageId, linkType: WIKILINK }, select: { toPageId: true } });
  await prisma.wikiPageLink.deleteMany({ where: { fromPageId: pageId, linkType: WIKILINK } });
  if (links.targets.length > 0) {
    await prisma.wikiPageLink.createMany({
      data: links.targets.map((toPageId) => ({ clientNumber, userId, fromPageId: pageId, toPageId, linkType: WIKILINK })),
      skipDuplicates: true,
    });
  }
  await recount([pageId, ...before.map((b: any) => b.toPageId), ...links.targets]);
  return { linked: links.targets.length, unresolved: links.unresolved };
}

/**
 * Two notes are one thing: keep `survivorId`, fold `otherId` into it. The
 * other note's citations and the links pointing at it move to the survivor,
 * its title and aliases become the survivor's aliases, its identifiers become
 * the survivor's. The other note is retired, not deleted, and remembers what
 * was moved, so `unmergeNote` can put it back. Call this only on evidence: a
 * shared identifier, or the user saying so (then `actor` starts with 'user').
 */
export async function mergeNotes(
  writer: { clientNumber: string; userId: number },
  survivorId: string,
  otherId: string,
  actor: string,
  reason = '',
): Promise<{ citations: number; backlinks: number }> {
  if (survivorId === otherId) throw new Error('wikiStore.mergeNotes: a note cannot be merged into itself');
  return prisma.$transaction(async (tx: any) => {
    const rows = await tx.wikiPage.findMany({
      where: { AND: [{ id: { in: [survivorId, otherId] } }, { clientNumber: writer.clientNumber }, IS_NOTE, { OR: [{ scope: 'tenant' }, { userId: writer.userId }] }] },
    });
    const keep = rows.find((r: any) => r.id === survivorId);
    const gone = rows.find((r: any) => r.id === otherId);
    if (!keep || !gone) throw new Error('wikiStore.mergeNotes: both notes must exist and be the writer\'s to change');
    if (keep.pageType !== gone.pageType || keep.userId !== gone.userId || keep.scope !== gone.scope) {
      throw new Error('wikiStore.mergeNotes: only two notes of the same kind and the same owner can be one');
    }
    const km = asRecord(keep.metadata);
    const gm = asRecord(gone.metadata);

    // Citations: everything the other note cites; only what the survivor did not already cite is recorded as moved.
    const cited = async (noteId: string): Promise<string[]> =>
      (await tx.$queryRawUnsafe(`SELECT source_id FROM wiki_note_sources WHERE note_id = $1`, noteId)).map((r: any) => r.source_id);
    const had = new Set(await cited(survivorId));
    const theirs = await cited(otherId);
    const movedCitations = theirs.filter((x) => !had.has(x));
    await tx.$executeRawUnsafe(
      `INSERT INTO wiki_note_sources (note_id, source_id) SELECT $1, source_id FROM wiki_note_sources WHERE note_id = $2
       ON CONFLICT (note_id, source_id) DO NOTHING`,
      survivorId, otherId,
    );
    await tx.$executeRawUnsafe(`DELETE FROM wiki_note_sources WHERE note_id = $1`, otherId);

    // Links pointing at the other note now point at the survivor.
    const into = await tx.wikiPageLink.findMany({ where: { toPageId: otherId, linkType: WIKILINK }, select: { fromPageId: true, clientNumber: true, userId: true } });
    const already = new Set((await tx.wikiPageLink.findMany({ where: { toPageId: survivorId, linkType: WIKILINK }, select: { fromPageId: true } })).map((l: any) => l.fromPageId));
    const moving = into.filter((l: any) => l.fromPageId !== survivorId && !already.has(l.fromPageId));
    const out = await tx.wikiPageLink.findMany({ where: { fromPageId: otherId, linkType: WIKILINK }, select: { toPageId: true } });
    await tx.wikiPageLink.deleteMany({ where: { linkType: WIKILINK, OR: [{ fromPageId: otherId }, { toPageId: otherId }] } });
    if (moving.length) {
      await tx.wikiPageLink.createMany({
        data: moving.map((l: any) => ({ clientNumber: l.clientNumber, userId: l.userId, fromPageId: l.fromPageId, toPageId: survivorId, linkType: WIKILINK })),
        skipDuplicates: true,
      });
    }

    const givenAliases = uniqueTitles([gone.title, ...strings(gm.aliases)], keep.title).filter((a) => !strings(km.aliasKeys).includes(titleKey(a)));
    const givenIds = normalizeIds(gm.ids).filter((x) => !strings(km.ids).includes(x));
    const aliases = uniqueTitles([...strings(km.aliases), ...givenAliases], keep.title);
    const now = new Date();
    await tx.wikiPage.update({
      where: { id: survivorId },
      data: {
        metadata: {
          ...km, aliases, aliasKeys: aliases.map(titleKey), ids: normalizeIds([...strings(km.ids), ...givenIds]), rev: (Number(km.rev ?? 0) || 0) + 1,
          // What the user said is one thing stays one thing when the notes are rebuilt.
          ...(actor.startsWith('user') ? { confirmedSame: [...(Array.isArray(km.confirmedSame) ? km.confirmedSame : []), normalizeIds([...strings(km.ids), ...strings(gm.ids)])] } : {}),
        },
        lastUpdatedBy: actor, lastUpdatedAt: now,
      },
    });
    await tx.wikiPage.update({
      where: { id: otherId },
      data: {
        status: 'superseded', lastUpdatedBy: actor, lastUpdatedAt: now,
        metadata: {
          ...gm, ids: [], rev: (Number(gm.rev ?? 0) || 0) + 1,
          mergeRecord: {
            into: survivorId, at: now.toISOString(), by: actor, reason,
            ids: normalizeIds(gm.ids), givenIds, givenAliases, citations: theirs, movedCitations,
            movedBacklinks: moving.map((l: any) => l.fromPageId),
          },
        },
      },
    });
    await recount([survivorId, otherId, ...into.map((l: any) => l.fromPageId), ...out.map((l: any) => l.toPageId)], tx);
    return { citations: movedCitations.length, backlinks: moving.length };
  }, { timeout: 30_000 });
}

/** Undo a merge: the retired note comes back with its identifiers, citations and the links that were moved. */
export async function unmergeNote(writer: { clientNumber: string; userId: number }, otherId: string, actor: string): Promise<void> {
  await prisma.$transaction(async (tx: any) => {
    const gone = await tx.wikiPage.findFirst({
      where: { AND: [{ id: otherId }, { clientNumber: writer.clientNumber }, IS_NOTE, { OR: [{ scope: 'tenant' }, { userId: writer.userId }] }] },
    });
    const gm = asRecord(gone?.metadata);
    const rec = asRecord(gm.mergeRecord);
    if (!gone || !rec.into) throw new Error('wikiStore.unmergeNote: this note was not merged into another');
    const keep = await tx.wikiPage.findFirst({ where: { id: String(rec.into), clientNumber: writer.clientNumber } });
    if (!keep) throw new Error('wikiStore.unmergeNote: the note it was merged into is gone');
    const km = asRecord(keep.metadata);
    const givenAliasKeys = new Set(strings(rec.givenAliases).map(titleKey));
    const givenIds = new Set(strings(rec.givenIds));
    const aliases = strings(km.aliases).filter((a) => !givenAliasKeys.has(titleKey(a)));
    const now = new Date();

    for (const sourceId of strings(rec.citations)) {
      await tx.$executeRawUnsafe(`INSERT INTO wiki_note_sources (note_id, source_id) VALUES ($1, $2) ON CONFLICT (note_id, source_id) DO NOTHING`, otherId, sourceId);
    }
    for (const sourceId of strings(rec.movedCitations)) {
      await tx.$executeRawUnsafe(`DELETE FROM wiki_note_sources WHERE note_id = $1 AND source_id = $2`, keep.id, sourceId);
    }
    const back = strings(rec.movedBacklinks);
    if (back.length) {
      await tx.wikiPageLink.deleteMany({ where: { toPageId: keep.id, linkType: WIKILINK, fromPageId: { in: back } } });
      await tx.wikiPageLink.createMany({
        data: back.map((fromPageId) => ({ clientNumber: gone.clientNumber, userId: gone.userId, fromPageId, toPageId: otherId, linkType: WIKILINK })),
        skipDuplicates: true,
      });
    }
    await tx.wikiPage.update({
      where: { id: keep.id },
      data: {
        metadata: {
          ...km, aliases, aliasKeys: aliases.map(titleKey), ids: strings(km.ids).filter((x) => !givenIds.has(x)), rev: (Number(km.rev ?? 0) || 0) + 1,
          ...(Array.isArray(km.confirmedSame) ? { confirmedSame: (km.confirmedSame as unknown[]).filter((g) => !strings(g).some((x) => givenIds.has(x))) } : {}),
        },
        lastUpdatedBy: actor, lastUpdatedAt: now,
      },
    });
    const { mergeRecord: _gone, ...rest } = gm;
    const own = await resolveLinks(tx, gone.clientNumber, gone.userId, gone.bodyMarkdown ?? '', otherId, gone.title);
    await tx.wikiPage.update({
      where: { id: otherId },
      data: {
        status: 'active', lastUpdatedBy: actor, lastUpdatedAt: now,
        metadata: { ...rest, ids: normalizeIds(rec.ids), unresolvedLinks: own.unresolved, ambiguousLinks: own.ambiguous, rev: (Number(gm.rev ?? 0) || 0) + 1, unmergedAt: now.toISOString() },
      },
    });
    if (own.targets.length) {
      await tx.wikiPageLink.createMany({
        data: own.targets.map((toPageId) => ({ clientNumber: gone.clientNumber, userId: gone.userId, fromPageId: otherId, toPageId, linkType: WIKILINK })),
        skipDuplicates: true,
      });
    }
    await recount([keep.id, otherId, ...back, ...own.targets], tx);
  }, { timeout: 30_000 });
}

/** Notes that link to this note, as far as the reader may see them. */
export async function backlinks(clientNumber: string, userId: number, noteId: string): Promise<NoteRef[]> {
  const rows = await prisma.wikiPageLink.findMany({
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
          title: { equals: cleanTitle(by.title), mode: 'insensitive' as const },
          ...(by.type ? { pageType: by.type } : {}),
        };
  let row = 'id' in by ? await prisma.wikiPage.findFirst({ where }) : pickTarget(await prisma.wikiPage.findMany({ where }), userId);
  if (!row && 'title' in by) {
    // No note has this title: it may be a former name of exactly one.
    const key = titleKey(cleanTitle(by.title));
    const named = (await notesNamed(prisma, clientNumber, userId, [{ title: cleanTitle(by.title), key }])).filter((c) => !by.type || c.pageType === by.type);
    const hit = resolveLink(key, named).hit;
    if (hit) row = await prisma.wikiPage.findFirst({ where: { id: hit.id, ...visibleTo(clientNumber, userId) } });
  }
  if (!row) return null;

  const out = await prisma.wikiPageLink.findMany({
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
