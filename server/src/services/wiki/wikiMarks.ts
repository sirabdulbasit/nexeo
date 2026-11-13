/**
 * Wiki marks — what is known about a source beyond its text
 * (docs/Wiki-Knowledge.md §0.12 and §0.12.1).
 *
 * A source is what was fetched and never changes. A mark is a judgement about
 * it, made for one user: whether an email needs him, which of his rules
 * applied, whether he handled it, the action item or meeting it led to.
 *
 *  - A mark belongs to the user it was made for and is read only by that user.
 *  - A new mark of the same kind and key supersedes the earlier one and keeps
 *    it; writing the same value again changes nothing.
 *  - Every call names the client and the user (the lesson of DEF-456), and
 *    every query is confined to them.
 *
 * Part of the one door: `wikiStore` re-exports this. Nothing else reads or
 * writes `wiki_source_marks`.
 */
import prisma from '../../db/prisma';
import type { Writer, SourceKind } from './wikiSources';

export const MARK_KINDS = ['attention', 'rule', 'handled', 'action_item', 'meeting'] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

export interface MarkInput {
  kind: MarkKind;
  /** Tells apart several marks of one kind (the rule's id, the open item's id). Empty for a kind with one value. */
  key?: string;
  value: Record<string, unknown>;
  /** Who is setting it: 'triage:v2', 'rule:<id>', 'user', 'suzi'. */
  by: string;
}

export interface Mark {
  sourceId: string;
  kind: MarkKind;
  key: string;
  value: Record<string, unknown>;
  setBy: string;
  setAt: Date;
  /** Null while the mark is current. */
  supersededAt: Date | null;
}

export interface MarkedSource {
  id: string;
  kind: string;
  externalId: string;
  title: string | null;
  occurredAt: Date | null;
  threadKey: string | null;
  participants: unknown[];
  marks: Mark[];
}

/** A mark the Wiki refuses: the source is not the writer's to mark, or the mark is malformed. */
export class MarkRefused extends Error {
  constructor(message: string) {
    super(`wikiMarks: ${message}`);
    this.name = 'MarkRefused';
  }
}

/** The same value whatever order its keys were written in. */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, norm(x)]))
        : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

function toMark(r: any): Mark {
  return {
    sourceId: r.source_id, kind: r.kind, key: r.mark_key, value: r.value ?? {},
    setBy: r.set_by, setAt: r.set_at, supersededAt: r.superseded_at ?? null,
  };
}

function checked(kind: string, key: string | undefined, by?: string): string {
  if (!(MARK_KINDS as readonly string[]).includes(kind)) throw new MarkRefused(`unknown kind '${kind}'`);
  const k = String(key ?? '').trim();
  if (k.length > 200) throw new MarkRefused('key too long');
  if (by !== undefined && !String(by).trim()) throw new MarkRefused('a mark needs who set it');
  return k;
}

const CURRENT = `source_id = $1 AND client_number = $2 AND user_id = $3 AND kind = $4 AND mark_key = $5 AND superseded_at IS NULL`;

async function change(
  writer: Writer,
  sourceId: string,
  kind: MarkKind,
  key: string,
  next: { value: Record<string, unknown>; by: string } | null,
): Promise<{ changed: boolean }> {
  const run = () => prisma.$transaction(async (tx: any) => {
    // The source must be in the writer's client, and the writer's own or the company's.
    const src = await tx.$queryRawUnsafe(
      `SELECT id FROM wiki_sources WHERE id = $1 AND client_number = $2 AND (scope = 'tenant' OR user_id = $3)`,
      sourceId, writer.clientNumber, writer.userId,
    );
    if (!src[0]) throw new MarkRefused(`no source ${sourceId} that ${writer.clientNumber}/${writer.userId} may mark`);
    const cur = await tx.$queryRawUnsafe(
      `SELECT id, value FROM wiki_source_marks WHERE ${CURRENT} FOR UPDATE`,
      sourceId, writer.clientNumber, writer.userId, kind, key,
    );
    if (next && cur[0] && sameValue(cur[0].value, next.value)) return { changed: false };
    if (!next && !cur[0]) return { changed: false };
    if (cur[0]) await tx.$executeRawUnsafe(`UPDATE wiki_source_marks SET superseded_at = now() WHERE id = $1`, cur[0].id);
    if (next) {
      await tx.$executeRawUnsafe(
        `INSERT INTO wiki_source_marks (source_id, client_number, user_id, kind, mark_key, value, set_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        sourceId, writer.clientNumber, writer.userId, kind, key, JSON.stringify(next.value), next.by.trim().slice(0, 120),
      );
    }
    return { changed: true };
  });
  try {
    return await run();
  } catch (err: any) {
    // Two writers set the same mark at once: the other one won; look again.
    if (err instanceof MarkRefused || !/23505|unique/i.test(String(err?.code ?? '') + String(err?.message ?? ''))) throw err;
    return run();
  }
}

/** Set a mark on a source. The earlier mark of the same kind and key is kept as history. */
export async function markSource(writer: Writer, sourceId: string, mark: MarkInput): Promise<{ changed: boolean }> {
  const key = checked(mark.kind, mark.key, mark.by);
  if (!mark.value || typeof mark.value !== 'object' || Array.isArray(mark.value)) throw new MarkRefused('a mark needs a value');
  return change(writer, sourceId, mark.kind, key, { value: mark.value, by: mark.by });
}

/** Take a mark off (the rule was removed, the item is no longer his). It stays in the history. */
export async function clearMark(writer: Writer, sourceId: string, kind: MarkKind, key = ''): Promise<{ changed: boolean }> {
  return change(writer, sourceId, kind, checked(kind, key), null);
}

/** The current marks this user holds on these sources. */
export async function marksOf(clientNumber: string, userId: number, sourceIds: string[]): Promise<Map<string, Mark[]>> {
  const ids = [...new Set(sourceIds.filter(Boolean))];
  const out = new Map<string, Mark[]>();
  if (ids.length === 0) return out;
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT source_id, kind, mark_key, value, set_by, set_at, superseded_at
       FROM wiki_source_marks
      WHERE client_number = $1 AND user_id = $2 AND source_id = ANY($3::text[]) AND superseded_at IS NULL
      ORDER BY set_at ASC, id ASC`,
    clientNumber, userId, ids,
  );
  for (const r of rows) out.set(r.source_id, [...(out.get(r.source_id) ?? []), toMark(r)]);
  return out;
}

/** Every mark this user ever held on one source, oldest first: what was believed, and when it changed. */
export async function markHistory(clientNumber: string, userId: number, sourceId: string): Promise<Mark[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT source_id, kind, mark_key, value, set_by, set_at, superseded_at
       FROM wiki_source_marks
      WHERE client_number = $1 AND user_id = $2 AND source_id = $3
      ORDER BY set_at ASC, id ASC`,
    clientNumber, userId, sourceId,
  );
  return rows.map(toMark);
}

const VISIBLE = `s.client_number = $1 AND (s.scope = 'tenant' OR s.user_id = $2)`;

/**
 * The sources of the given kinds this user may see in a time window, each with
 * the user's current marks, newest first. With `mark`, only the sources that
 * carry a current mark of that kind (and, with `value`, containing it): for
 * example today's emails whose attention is needs_you. No text is returned;
 * `readSource` gives one source's text.
 */
export async function listMarkedSources(
  clientNumber: string,
  userId: number,
  opts: { kinds: SourceKind[]; since: Date; until: Date; mark?: { kind: MarkKind; value?: Record<string, unknown> }; limit?: number },
): Promise<MarkedSource[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000));
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT s.id, s.kind, s.external_id, s.title, s.occurred_at, s.thread_key, s.participants
       FROM wiki_sources s
      WHERE ${VISIBLE} AND s.kind = ANY($3::text[]) AND s.occurred_at >= $4::timestamptz AND s.occurred_at < $5::timestamptz
        AND ($6::text IS NULL OR EXISTS (
              SELECT 1 FROM wiki_source_marks m
               WHERE m.source_id = s.id AND m.client_number = $1 AND m.user_id = $2
                 AND m.kind = $6 AND m.superseded_at IS NULL AND m.value @> $7::jsonb))
      ORDER BY s.occurred_at DESC
      LIMIT ${limit}`,
    clientNumber, userId, opts.kinds, opts.since, opts.until,
    opts.mark?.kind ?? null, JSON.stringify(opts.mark?.value ?? {}),
  );
  const marks = await marksOf(clientNumber, userId, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, kind: r.kind, externalId: r.external_id, title: r.title, occurredAt: r.occurred_at,
    threadKey: r.thread_key, participants: r.participants ?? [], marks: marks.get(r.id) ?? [],
  }));
}

/**
 * The proof that nothing was left unjudged: how many of this user's own
 * sources of one kind fall in the window, and how many carry no current mark
 * of the given kind.
 */
export async function countUnmarked(
  clientNumber: string,
  userId: number,
  sourceKind: SourceKind,
  markKind: MarkKind,
  since: Date,
  until: Date,
): Promise<{ total: number; unmarked: number }> {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: number; unmarked: number }>>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM wiki_source_marks m
               WHERE m.source_id = s.id AND m.client_number = $1 AND m.user_id = $2
                 AND m.kind = $4 AND m.superseded_at IS NULL))::int AS unmarked
       FROM wiki_sources s
      WHERE s.client_number = $1 AND s.user_id = $2 AND s.kind = $3
        AND s.occurred_at >= $5::timestamptz AND s.occurred_at < $6::timestamptz`,
    clientNumber, userId, sourceKind, markKind, since, until,
  );
  return { total: Number(rows[0]?.total ?? 0), unmarked: Number(rows[0]?.unmarked ?? 0) };
}
