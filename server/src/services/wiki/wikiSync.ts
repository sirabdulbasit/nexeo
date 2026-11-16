/**
 * Write a set of derived notes for one writer, the way every Wiki builder does
 * (docs/Wiki-Knowledge.md §0.13): a note that already says what the build
 * produced is left alone, a changed one is written in full (`exact`), and a
 * note this writer made before that the build no longer produces is retired
 * (restorable), never deleted.
 *
 * A note the daily upkeep archived (§0.13 part 13) stays archived while the
 * build still produces the same text for it: only something new about it
 * (a new source, a changed fact) brings it back.
 */
import prisma from '../../db/prisma';
import { writeNote, retireNote, WIKI_GENERATION, type NoteInput } from './wikiStore';
import { cleanTitle } from './wikiLinks';

export type BuiltNote = Omit<NoteInput, 'clientNumber' | 'userId' | 'actor'>;

/** Archived by upkeep, and the build has nothing new to say about it. */
export function prunedAndUnchanged(have: { status?: string; bodyMarkdown?: string | null; metadata?: any } | null | undefined, body: string): boolean {
  return !!have && have.status === 'archived' && !!have.metadata?.upkeep?.archived && have.bodyMarkdown === body;
}

/** Already exactly what the build produced, with every link reaching its note. */
export function unchangedNote(have: { status?: string; bodyMarkdown?: string | null; metadata?: any } | null | undefined, body: string): boolean {
  return !!have && have.status === 'active' && have.metadata?.wiki === WIKI_GENERATION && have.bodyMarkdown === body
    && !(have.metadata?.unresolvedLinks ?? []).length && !(have.metadata?.ambiguousLinks ?? []).length
    && typeof have.metadata?.rev === 'number';
}

export interface SyncResult { notes: number; written: number; unchanged: number; retired: number }

/**
 * @param writer   whose notes these are (for shared notes: the client's writing user)
 * @param actor    the builder's name; only notes it wrote are ever retired by it
 * @param complete false when the build did not see everything (a read failed): nothing is retired
 * @param tenant   the notes are the company's: existing notes of this actor are looked up across the client
 */
export async function syncNotes(
  writer: { clientNumber: string; userId: number },
  actor: string,
  notes: BuiltNote[],
  opts: { complete?: boolean; tenant?: boolean } = {},
): Promise<SyncResult> {
  const { clientNumber, userId } = writer;
  const existing: any[] = await prisma.wikiPage.findMany({
    where: { clientNumber, lastUpdatedBy: actor, ...(opts.tenant ? { scope: 'tenant' } : { userId, scope: 'user' }) },
    select: { id: true, status: true, pageType: true, title: true, bodyMarkdown: true, metadata: true },
  });
  const byKey = new Map(existing.map((e) => [`${e.pageType}|${e.title}`, e]));
  const kept = new Set<string>();
  let written = 0; let unchanged = 0; let retired = 0;
  for (const n of notes) {
    const have = byKey.get(`${n.type}|${cleanTitle(n.title)}`);
    if (unchangedNote(have, n.body) || prunedAndUnchanged(have, n.body)) { kept.add(have.id); unchanged += 1; continue; }
    const r = await writeNote({ ...n, ...(opts.tenant ? { scope: 'tenant' as const } : {}), clientNumber, userId, actor, exact: true });
    kept.add(r.id);
    written += 1;
  }
  if (opts.complete !== false) {
    for (const e of existing) {
      if (kept.has(e.id) || e.status === 'superseded') continue;
      await retireNote(e.id, actor);
      retired += 1;
    }
  }
  return { notes: notes.length, written, unchanged, retired };
}
