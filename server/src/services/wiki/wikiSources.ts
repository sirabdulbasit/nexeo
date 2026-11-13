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
  /** When this text was fetched. An older text never replaces a newer one. Defaults to now. */
  asOf?: Date;
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

/** A source's text as it is stored: a structured value is kept as written, and the ends are trimmed. */
export function textOf(body: unknown): string {
  return (typeof body === 'string' ? body : body == null ? '' : JSON.stringify(body)).trim();
}

/** The fingerprint of a text. Two texts are the same version exactly when this is equal. */
export function textHash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function seal(plain: string): Promise<string> {
  const { encryptSecret } = await import('../integrations/store/secretStore');
  return encryptSecret(plain);
}
async function unseal(enc: string): Promise<string> {
  const { decryptSecret } = await import('../integrations/store/secretStore');
  return decryptSecret(enc);
}

/** What the Wiki holds as a source's text: its fingerprint, when it was fetched, and whether it is only a preview. */
export interface HeldText {
  hasText: boolean;
  hash: string | null;
  asOf: Date | null;
  isPreview: boolean;
}

/**
 * Does the source keep the text it holds, or take the incoming one?
 * (docs/Wiki-Knowledge.md §0.13 part 8)
 *  - nothing incoming: keep (a blank never replaces text);
 *  - nothing held: take;
 *  - the same text: keep;
 *  - a preview never replaces text; any full text replaces a preview;
 *  - of two full texts, the one fetched later wins: an older version arriving
 *    late, or replayed, never puts the source back.
 */
export function keepsHeldText(held: HeldText | null, incoming: { hash: string | null; asOf: Date; isPreview: boolean }): boolean {
  if (!incoming.hash) return true;
  if (!held || !held.hasText) return false;
  if (incoming.hash === held.hash) return true;
  if (incoming.isPreview) return true;
  if (held.isPreview) return false;
  if (held.asOf && incoming.asOf.getTime() < held.asOf.getTime()) return true;
  return false;
}

/**
 * Land a source in the Wiki. Safe to call any number of times for the same
 * item: it is one row. Title, time and thread are filled in when given and
 * never blanked by a later call that lacks them. Its text follows
 * `keepsHeldText`. Read, decide and write happen in one transaction.
 */
export async function saveSource(input: SourceInput): Promise<{ id: string; created: boolean; textReplaced: boolean }> {
  const externalId = String(input.externalId ?? '').trim();
  if (!externalId) throw new Error('wikiSources.saveSource: a source needs its own id');
  const id = sourceId(input.clientNumber, input.userId, input.kind, externalId);
  const text = textOf(input.body);
  const hash = text ? textHash(text) : null;
  const asOf = input.asOf ?? new Date();
  const isPreview = !!text && input.preview === true;
  const plain = text && !input.encrypt ? text : null;
  const enc = text && input.encrypt ? await seal(text) : null;
  const common = [
    input.feedEventId ?? null, input.threadKey ?? null, input.title ?? null, input.occurredAt ?? null,
    JSON.stringify(input.participants ?? []), JSON.stringify(input.details ?? {}), input.scope ?? 'user',
  ];

  const run = () => prisma.$transaction(async (tx: any) => {
    const cur: any[] = await tx.$queryRawUnsafe(
      `SELECT content_hash, body_as_of, body_is_preview FROM wiki_sources
        WHERE client_number = $1 AND user_id = $2 AND kind = $3 AND external_id = $4 FOR UPDATE`,
      input.clientNumber, input.userId, input.kind, externalId,
    );
    if (!cur[0]) {
      await tx.$executeRawUnsafe(
        `INSERT INTO wiki_sources
           (id, client_number, user_id, kind, external_id, feed_event_id, thread_key, title, occurred_at,
            participants, details, scope, body_text, body_enc, content_hash, body_as_of, body_is_preview)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16::timestamptz, $17)`,
        id, input.clientNumber, input.userId, input.kind, externalId, ...common,
        plain, enc, hash, hash ? asOf : null, isPreview,
      );
      return { id, created: true, textReplaced: false };
    }
    const held: HeldText = {
      hasText: cur[0].content_hash != null, hash: cur[0].content_hash ?? null,
      asOf: cur[0].body_as_of ?? null, isPreview: cur[0].body_is_preview === true,
    };
    const keep = keepsHeldText(held, { hash, asOf, isPreview });
    const fields = `feed_event_id = COALESCE($2, feed_event_id),
           thread_key    = COALESCE($3, thread_key),
           title         = COALESCE(NULLIF($4, ''), title),
           occurred_at   = COALESCE($5::timestamptz, occurred_at),
           participants  = CASE WHEN $6::jsonb = '[]'::jsonb THEN participants ELSE $6::jsonb END,
           details       = details || $7::jsonb,
           scope         = $8,
           updated_at    = now()`;
    if (keep) {
      // The same text seen again later: it is known to be current as of the later fetch.
      await tx.$executeRawUnsafe(
        `UPDATE wiki_sources SET ${fields},
           body_as_of = CASE WHEN $9::text IS NOT NULL AND content_hash = $9 THEN GREATEST(body_as_of, $10::timestamptz) ELSE body_as_of END
         WHERE id = $1`,
        id, ...common, hash, asOf,
      );
    } else {
      await tx.$executeRawUnsafe(
        `UPDATE wiki_sources SET ${fields},
           body_text = $9, body_enc = $10, content_hash = $11, body_as_of = $12::timestamptz, body_is_preview = $13
         WHERE id = $1`,
        id, ...common, plain, enc, hash, asOf, isPreview,
      );
    }
    return { id, created: false, textReplaced: !keep && held.hasText };
  });
  try {
    return await run();
  } catch (err: any) {
    // Two writers landed the same new source at once: the other one's row is there now; decide against it.
    if (!/23505|unique/i.test(`${err?.code ?? ''} ${err?.meta?.code ?? ''} ${err?.message ?? ''}`)) throw err;
    return run();
  }
}

/** The two sides of a citation: who owns the row and who may read it. */
export interface CiteParty {
  clientNumber: string;
  userId: number;
  /** 'tenant' = the company's, readable by every user of the client; anything else = that user's alone. */
  scope: string;
}

/**
 * May this note cite this source? (docs/Wiki-Knowledge.md §0.1.6, §0.7 standard 3)
 *  - never across clients;
 *  - a company source may be cited by any note of that client;
 *  - a user's own source may be cited only by that user's own private note,
 *    so what one user's mail said never becomes part of a shared note.
 */
export function mayCite(note: CiteParty, source: CiteParty): boolean {
  if (note.clientNumber !== source.clientNumber) return false;
  if (source.scope === 'tenant') return true;
  return note.scope !== 'tenant' && note.userId === source.userId;
}

/** A citation the Wiki refuses. Nothing is written when this is thrown. */
export class CitationRefused extends Error {
  constructor(public readonly refused: string[], note: CiteParty) {
    super(`wikiSources: ${refused.length} citation(s) refused for a ${note.scope === 'tenant' ? 'shared' : 'private'} note of ${note.clientNumber}/${note.userId}: ${refused.slice(0, 5).join(', ')}`);
    this.name = 'CitationRefused';
  }
}

/**
 * Check every source against the note that wants to cite it. Throws
 * `CitationRefused` naming each source that is not in the note's client, does
 * not exist, or that the note may not cite. The read is confined to the
 * note's client, so a source of another client is never even loaded. Called
 * before a note's text is written, and again when the citation rows are made.
 */
export async function assertCitable(note: CiteParty, sourceIds: string[], db: any = prisma): Promise<void> {
  const ids = [...new Set(sourceIds.filter(Boolean))];
  if (ids.length === 0) return;
  const rows: Array<{ id: string; client_number: string; user_id: number; scope: string }> = await db.$queryRawUnsafe(
    `SELECT id, client_number, user_id, scope FROM wiki_sources WHERE client_number = $1 AND id = ANY($2::text[])`,
    note.clientNumber, ids,
  );
  const found = new Map(rows.map((r) => [r.id, r]));
  const refused = ids.filter((id) => {
    const s = found.get(id);
    return !s || !mayCite(note, { clientNumber: s.client_number, userId: Number(s.user_id), scope: s.scope });
  });
  if (refused.length) throw new CitationRefused(refused, note);
}

/** Who is writing: the client and the user the write is made for. Never taken from the row being written. */
export interface Writer {
  clientNumber: string;
  userId: number;
}

/**
 * A note cites these sources. Citing the same source twice is one citation.
 * The writer must name its client and user: the note is looked up inside that
 * client and must be the writer's own or a shared one, and every source is
 * checked against the note (`assertCitable`). If one is refused, none is cited.
 */
export async function citeSources(writer: Writer, noteId: string, sourceIds: string[], db: any = prisma): Promise<void> {
  const ids = [...new Set(sourceIds.filter(Boolean))];
  if (ids.length === 0) return;
  const notes: Array<{ client_number: string; user_id: number; scope: string }> = await db.$queryRawUnsafe(
    `SELECT client_number, user_id, scope FROM wiki_pages
      WHERE id = $1 AND client_number = $2 AND (scope = 'tenant' OR user_id = $3)`,
    noteId, writer.clientNumber, writer.userId,
  );
  if (!notes[0]) throw new Error(`wikiSources.citeSources: no note ${noteId} that ${writer.clientNumber}/${writer.userId} may write`);
  await assertCitable({ clientNumber: notes[0].client_number, userId: Number(notes[0].user_id), scope: notes[0].scope }, ids, db);
  await db.$executeRawUnsafe(
    `INSERT INTO wiki_note_sources (note_id, source_id)
     SELECT $1, s FROM unnest($2::text[]) AS s
     ON CONFLICT (note_id, source_id) DO NOTHING`,
    noteId, ids,
  );
  await db.$executeRawUnsafe(
    `UPDATE wiki_pages SET source_count =
        (SELECT COUNT(*) FROM wiki_page_sources WHERE wiki_page_id = $1)
      + (SELECT COUNT(*) FROM wiki_note_sources WHERE note_id = $1)
      WHERE id = $1`,
    noteId,
  );
}

/**
 * Which of this user's sources the Wiki holds, and what it holds as each one's
 * text. For reconciling intake: a fetched item whose source is not here was
 * missed, and one whose text has a different fingerprint may be out of date.
 */
export async function sourcesHeld(clientNumber: string, userId: number, ids: string[]): Promise<Map<string, HeldText>> {
  const want = [...new Set(ids.filter(Boolean))];
  if (want.length === 0) return new Map();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; content_hash: string | null; body_as_of: Date | null; body_is_preview: boolean }>>(
    `SELECT id, content_hash, body_as_of, body_is_preview FROM wiki_sources
      WHERE client_number = $1 AND user_id = $2 AND id = ANY($3::text[])`,
    clientNumber, userId, want,
  );
  return new Map(rows.map((r) => [r.id, {
    hasText: r.content_hash != null, hash: r.content_hash ?? null, asOf: r.body_as_of ?? null, isPreview: r.body_is_preview === true,
  }]));
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
