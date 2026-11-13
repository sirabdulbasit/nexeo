/**
 * Wiki sources — the Wiki's own lasting store of what notes were learned from
 * (docs/Wiki-Knowledge.md §0.1 and §6b A1).
 *
 * A source is one email, message, calendar entry, transcript, attachment or
 * integration record, with its text. Notes cite sources; a source is never a
 * note. The trail of a note is the list of sources it cites, in time order.
 *
 * This is part of the one door (`wikiStore` re-exports it): nothing else
 * reads or writes `wiki_sources` or `wiki_note_sources`.
 *
 * Who may read a source follows where it came from: a connector's item is
 * the user's alone; an integration's record is the company's.
 */
import crypto from 'crypto';
import prisma from '../../db/prisma';

export type SourceKind =
  | 'email' | 'calendar' | 'chat' | 'whatsapp' | 'task'
  | 'transcript' | 'attachment' | 'document' | 'record' | 'conversation';

export interface SourceInput {
  clientNumber: string;
  userId: number;
  kind: SourceKind;
  /** The source's own id: Gmail message id, calendar event id, chat message name… */
  externalId: string;
  scope?: 'user' | 'tenant';
  feedEventId?: string | null;
  threadKey?: string | null;
  title?: string | null;
  occurredAt?: Date | null;
  participants?: unknown[];
  /** The text. A blank never replaces text the source already holds. */
  body?: string | null;
  /** The text is only a preview (a snippet). It fills an empty source and never replaces fuller text. */
  preview?: boolean;
  /** Keep the text encrypted at rest (transcripts, identity). */
  encrypt?: boolean;
  /** The fetched item's other fields. */
  details?: Record<string, unknown>;
}

export interface SourceRef {
  id: string;
  kind: string;
  title: string | null;
  occurredAt: Date | null;
  threadKey: string | null;
}

export interface Source extends SourceRef {
  clientNumber: string;
  userId: number;
  scope: string;
  externalId: string;
  feedEventId: string | null;
  participants: unknown[];
  body: string;
  details: Record<string, unknown>;
}

/** The same source always has the same id, whoever lands it and however often. */
export function sourceId(clientNumber: string, userId: number, kind: string, externalId: string): string {
  const h = crypto.createHash('sha256').update(`${clientNumber}|${userId}|${kind}|${externalId}`).digest('hex');
  return `src_${h.slice(0, 28)}`;
}

function hashOf(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

async function seal(plain: string): Promise<string> {
  const { encryptSecret } = await import('../integrations/store/secretStore');
  return encryptSecret(plain);
}
async function unseal(enc: string): Promise<string> {
  const { decryptSecret } = await import('../integrations/store/secretStore');
  return decryptSecret(enc);
}

/**
 * Land a source in the Wiki. Safe to call any number of times for the same
 * item: it is one row. Text, title, time and thread are filled in when given
 * and never blanked by a later call that lacks them.
 */
export async function saveSource(input: SourceInput): Promise<{ id: string; created: boolean }> {
  const externalId = String(input.externalId ?? '').trim();
  if (!externalId) throw new Error('wikiSources.saveSource: a source needs its own id');
  const id = sourceId(input.clientNumber, input.userId, input.kind, externalId);
  // A feed sometimes hands the text over as a structured value; it is kept as written.
  const raw: unknown = input.body;
  const text = (typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw)).trim();
  const plain = text && !input.encrypt ? text : null;
  const enc = text && input.encrypt ? await seal(text) : null;
  const rows = await prisma.$queryRawUnsafe<Array<{ created: boolean }>>(
    `INSERT INTO wiki_sources
       (id, client_number, user_id, scope, kind, external_id, feed_event_id, thread_key, title,
        occurred_at, participants, body_text, body_enc, details, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb, $12, $13, $14::jsonb, $15)
     ON CONFLICT (client_number, user_id, kind, external_id) DO UPDATE SET
       feed_event_id = COALESCE(EXCLUDED.feed_event_id, wiki_sources.feed_event_id),
       thread_key    = COALESCE(EXCLUDED.thread_key, wiki_sources.thread_key),
       title         = COALESCE(NULLIF(EXCLUDED.title, ''), wiki_sources.title),
       occurred_at   = COALESCE(EXCLUDED.occurred_at, wiki_sources.occurred_at),
       participants  = CASE WHEN EXCLUDED.participants = '[]'::jsonb THEN wiki_sources.participants ELSE EXCLUDED.participants END,
       body_text     = CASE WHEN EXCLUDED.content_hash IS NULL OR ($16::boolean AND wiki_sources.content_hash IS NOT NULL)
                            THEN wiki_sources.body_text ELSE EXCLUDED.body_text END,
       body_enc      = CASE WHEN EXCLUDED.content_hash IS NULL OR ($16::boolean AND wiki_sources.content_hash IS NOT NULL)
                            THEN wiki_sources.body_enc ELSE EXCLUDED.body_enc END,
       content_hash  = CASE WHEN EXCLUDED.content_hash IS NULL OR ($16::boolean AND wiki_sources.content_hash IS NOT NULL)
                            THEN wiki_sources.content_hash ELSE EXCLUDED.content_hash END,
       details       = wiki_sources.details || EXCLUDED.details,
       scope         = EXCLUDED.scope,
       updated_at    = now()
     RETURNING (xmax = 0) AS created`,
    id, input.clientNumber, input.userId, input.scope ?? 'user', input.kind, externalId,
    input.feedEventId ?? null, input.threadKey ?? null, input.title ?? null,
    input.occurredAt ?? null, JSON.stringify(input.participants ?? []),
    plain, enc, JSON.stringify(input.details ?? {}), text ? hashOf(text) : null,
    input.preview === true,
  );
  return { id, created: rows[0]?.created === true };
}

/** A note cites these sources. Citing the same source twice is one citation. */
export async function citeSources(noteId: string, sourceIds: string[]): Promise<void> {
  const ids = [...new Set(sourceIds.filter(Boolean))];
  if (ids.length === 0) return;
  await prisma.$executeRawUnsafe(
    `INSERT INTO wiki_note_sources (note_id, source_id)
     SELECT $1, s FROM unnest($2::text[]) AS s
     ON CONFLICT (note_id, source_id) DO NOTHING`,
    noteId, ids,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE wiki_pages SET source_count =
        (SELECT COUNT(*) FROM wiki_page_sources WHERE wiki_page_id = $1)
      + (SELECT COUNT(*) FROM wiki_note_sources WHERE note_id = $1)
      WHERE id = $1`,
    noteId,
  );
}

const VISIBLE = `s.client_number = $1 AND (s.scope = 'tenant' OR s.user_id = $2)`;

/** The trail of a note: the sources it cites that the reader may see, oldest first. */
export async function sourcesOf(clientNumber: string, userId: number, noteId: string): Promise<SourceRef[]> {
  return prisma.$queryRawUnsafe<SourceRef[]>(
    `SELECT s.id, s.kind, s.title, s.occurred_at AS "occurredAt", s.thread_key AS "threadKey"
       FROM wiki_note_sources c JOIN wiki_sources s ON s.id = c.source_id
      WHERE c.note_id = $3 AND ${VISIBLE}
      ORDER BY s.occurred_at ASC NULLS LAST`,
    clientNumber, userId, noteId,
  );
}

function toSource(r: any, body: string): Source {
  return {
    id: r.id, kind: r.kind, title: r.title, occurredAt: r.occurred_at, threadKey: r.thread_key,
    clientNumber: r.client_number, userId: r.user_id, scope: r.scope, externalId: r.external_id,
    feedEventId: r.feed_event_id, participants: r.participants ?? [], body, details: r.details ?? {},
  };
}

/** One source with its text, if the reader may see it. */
export async function readSource(clientNumber: string, userId: number, id: string): Promise<Source | null> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT s.* FROM wiki_sources s WHERE s.id = $3 AND ${VISIBLE}`,
    clientNumber, userId, id,
  );
  const r = rows[0];
  if (!r) return null;
  return toSource(r, r.body_enc ? await unseal(r.body_enc) : r.body_text ?? '');
}

/**
 * Every source of one user of the given kinds, oldest first, without
 * decrypting anything: for the builder, which reads the stored fields.
 */
export async function listSources(
  clientNumber: string,
  userId: number,
  kinds: SourceKind[],
): Promise<Source[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT s.id, s.client_number, s.user_id, s.scope, s.kind, s.external_id, s.feed_event_id,
            s.thread_key, s.title, s.occurred_at, s.participants, s.details, s.body_text
       FROM wiki_sources s
      WHERE s.client_number = $1 AND s.user_id = $2 AND s.kind = ANY($3::text[])
      ORDER BY s.occurred_at ASC NULLS LAST`,
    clientNumber, userId, kinds,
  );
  return rows.map((r) => toSource(r, r.body_text ?? ''));
}

/** How many sources a user has, by kind. */
export async function countSources(clientNumber: string, userId: number): Promise<Record<string, number>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ kind: string; n: number }>>(
    `SELECT kind, COUNT(*)::int AS n FROM wiki_sources WHERE client_number = $1 AND user_id = $2 GROUP BY kind`,
    clientNumber, userId,
  );
  return Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
}
