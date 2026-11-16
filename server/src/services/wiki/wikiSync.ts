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
import { writeNote, retireNote, normalizeIds, WIKI_GENERATION, type NoteInput } from './wikiStore';
import { stableJson } from '../../utils/stableJson';
import { cleanTitle } from './wikiLinks';

export type BuiltNote = Omit<NoteInput, 'clientNumber' | 'userId' | 'actor'>;

type Stored = { id?: string; status?: string; scope?: string; bodyMarkdown?: string | null; metadata?: any } | null | undefined;

/** Properties as a build states them: a null or missing value is no property. */
function propsOf(v: unknown): string {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return stableJson(Object.fromEntries(Object.entries(o).filter(([, x]) => x !== null && x !== undefined)));
}

/**
 * Does the stored note already say everything the build derived? The whole note, not only its text
 * (review 16 Nov, P1): text, properties, identifiers, scope and its trail of sources. A new source or
 * a corrected property under the same summary is a change. `cited` is the note's present trail.
 */
export function samePayload(have: Stored, n: BuiltNote, cited?: Set<string>): boolean {
  if (!have) return false;
  if (have.bodyMarkdown !== n.body) return false;
  if (propsOf(have.metadata?.properties) !== propsOf(n.properties)) return false;
  if (stableJson(normalizeIds(have.metadata?.ids)) !== stableJson(normalizeIds(n.ids ?? []))) return false;
  if (n.scope && have.scope && n.scope !== have.scope) return false;
  if (cited) {
    const want = new Set((n.sourceIds ?? []).filter(Boolean));
    if (want.size !== cited.size || [...want].some((x) => !cited.has(x))) return false;
  }
  return true;
}

/** Archived by upkeep, and the build has nothing new to say about it. */
export function prunedAndUnchanged(have: Stored, n: BuiltNote, cited?: Set<string>): boolean {
  return !!have && have.status === 'archived' && !!have.metadata?.upkeep?.archived && samePayload(have, n, cited);
}

/** Already exactly what the build produced, with every link reaching its note. */
export function unchangedNote(have: Stored, n: BuiltNote, cited?: Set<string>): boolean {
  return !!have && have.status === 'active' && have.metadata?.wiki === WIKI_GENERATION && samePayload(have, n, cited)
    && !(have.metadata?.unresolvedLinks ?? []).length && !(have.metadata?.ambiguousLinks ?? []).length
    && typeof have.metadata?.rev === 'number';
}

/** The present trail (cited Wiki sources) of each note. */
export async function citationsOf(noteIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>(noteIds.map((id) => [id, new Set<string>()]));
  if (noteIds.length === 0) return out;
  const rows = await prisma.$queryRawUnsafe<Array<{ note_id: string; source_id: string }>>(
    `SELECT note_id, source_id FROM wiki_note_sources WHERE note_id = ANY($1::text[])`, noteIds,
  );
  for (const r of rows) out.get(r.note_id)?.add(r.source_id);
  return out;
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
    select: { id: true, status: true, scope: true, pageType: true, title: true, bodyMarkdown: true, metadata: true },
  });
  const byKey = new Map(existing.map((e) => [`${e.pageType}|${e.title}`, e]));
  const cited = await citationsOf(existing.map((e) => e.id));
  const kept = new Set<string>();
  let written = 0; let unchanged = 0; let retired = 0;
  for (const n of notes) {
    const have = byKey.get(`${n.type}|${cleanTitle(n.title)}`);
    const tenantNote = opts.tenant ? { ...n, scope: 'tenant' as const } : n;
    if (have && (unchangedNote(have, tenantNote, cited.get(have.id)) || prunedAndUnchanged(have, tenantNote, cited.get(have.id)))) { kept.add(have.id); unchanged += 1; continue; }
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
