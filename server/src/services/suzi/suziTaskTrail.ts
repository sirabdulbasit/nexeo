/**
 * Link T33 P2-P4 (both AGREE 17 Nov 2026) and T37 rename (both AGREE 18 Nov 2026): what Suzi does to a task that
 * the status history and the delegation trail can't hold, kept on the task itself (open_items.metadata; no new
 * table, Wiki-first ledger):
 *
 *   metadata.suziTrail    [{at, who, change, note?}]   helper added / removed, followed up, renamed (dated entries)
 *   metadata.suziHelpers  [{person_id, name, email, note?, added_at, told?, draft_id?}]   the task's helpers now
 *   metadata.suziThreads  [{thread_id, since}]         the Gmail thread of each task email that went out
 *
 * A reply on a linked thread (an email from anyone but him, after the task email went) is read from the Wiki's
 * email sources at read time: a history entry {change: "reply"}, the pack's emails[].task_id, and the "actions"
 * flag in /v1/changes. A reply never changes the task's status (the user decides).
 */
import prisma from '../../db/prisma';

export const TRAIL_MAX = 200;
export const REPLY_NOTE_MAX = 500;

export interface TrailEntry { at: string; who: string; change: string; note?: string; thread_id?: string; email_id?: string }
export interface Helper { person_id: string; name: string; email: string; note?: string; added_at: string; told?: 'pending' | 'sent' | 'drafted' | 'failed'; draft_id?: string }

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** One dated entry on the task's trail (jsonb append, never a whole-row write). */
export async function trailPush(itemId: string, e: Omit<TrailEntry, 'at'> & { at?: string }): Promise<void> {
  const entry = { ...e, at: e.at ?? new Date().toISOString() };
  await prisma.$executeRawUnsafe(
    `UPDATE open_items SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('suziTrail',
       (SELECT COALESCE(jsonb_agg(x ORDER BY n), '[]'::jsonb) FROM (
          SELECT x, n FROM jsonb_array_elements(COALESCE(metadata->'suziTrail', '[]'::jsonb) || jsonb_build_array($2::jsonb)) WITH ORDINALITY AS t(x, n)
          ORDER BY n DESC LIMIT ${TRAIL_MAX}) k)),
       updated_at = now()
     WHERE id = $1`,
    itemId, JSON.stringify(entry),
  );
}

export function trailOf(meta: unknown): TrailEntry[] {
  return arr((meta as any)?.suziTrail).filter((e) => e && typeof e.at === 'string' && typeof e.change === 'string');
}

export function helpersOf(meta: unknown): Helper[] {
  return arr((meta as any)?.suziHelpers).filter((h) => h && typeof h.person_id === 'string');
}

/** The pack's view of the helpers: {person_id, name, note?, told?, told_draft_id?}. */
export function packHelpers(meta: unknown): Array<{ person_id: string; name: string; note?: string; told?: string; told_draft_id?: string }> {
  return helpersOf(meta).map((h) => ({
    person_id: h.person_id, name: h.name, ...(h.note ? { note: h.note } : {}),
    ...(h.told ? { told: h.told } : {}), ...(h.told === 'drafted' && h.draft_id ? { told_draft_id: h.draft_id } : {}),
  }));
}

export async function setHelpers(itemId: string, helpers: Helper[]): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE open_items SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('suziHelpers', $2::jsonb), updated_at = now() WHERE id = $1`,
    itemId, JSON.stringify(helpers),
  );
}

/** The note to a helper went (or not): its state on that helper. */
export async function setHelperTold(itemId: string, personId: string, t: { state: Helper['told']; draft_id?: string }): Promise<void> {
  try {
    const row = await prisma.openItem.findFirst({ where: { id: itemId }, select: { metadata: true } });
    const list = helpersOf(row?.metadata).map((h) => (h.person_id === personId ? { ...h, told: t.state, ...(t.draft_id ? { draft_id: t.draft_id } : {}) } : h));
    await prisma.$executeRawUnsafe(
      `UPDATE open_items SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('suziHelpers', $2::jsonb) WHERE id = $1`,
      itemId, JSON.stringify(list),
    );
  } catch { /* the helper stands; told stays as it was */ }
}

/** The Gmail thread of a task email that went out: replies on it come to the task. */
export async function linkThread(itemId: string, threadId: string | null | undefined, since: Date = new Date()): Promise<void> {
  if (!threadId) return;
  await prisma.$executeRawUnsafe(
    `UPDATE open_items SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('suziThreads',
       COALESCE(metadata->'suziThreads', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('thread_id', $2::text, 'since', $3::text)))
     WHERE id = $1 AND NOT (COALESCE(metadata->'suziThreads', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('thread_id', $2::text)))`,
    itemId, threadId, since.toISOString(),
  );
}

export function threadsOf(meta: unknown): Array<{ thread_id: string; since: string }> {
  return arr((meta as any)?.suziThreads).filter((t) => t && typeof t.thread_id === 'string');
}

const addressOf = (s: string) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase();
const nameOf = (s: string) => (s.includes('<') ? s.slice(0, s.indexOf('<')).replace(/"/g, '').trim() : '') || addressOf(s);

/**
 * Replies on the linked threads of these tasks: emails from anyone but him, after the task email went.
 * Map task id → reply entries, newest first. A read that fails gives an empty map (the task stands without them).
 */
export async function taskReplies(clientNumber: string, userId: number, items: Array<{ id: string; metadata?: unknown }>): Promise<Map<string, TrailEntry[]>> {
  const out = new Map<string, TrailEntry[]>();
  const links: Array<{ item: string; thread: string; since: string }> = [];
  for (const it of items) for (const t of threadsOf(it.metadata)) links.push({ item: it.id, thread: t.thread_id, since: t.since });
  if (!links.length) return out;
  const me = await prisma.user.findFirst({ where: { id: userId, clientNumber } as any, select: { email: true } as any }).catch(() => null) as any;
  const mine = String(me?.email ?? '').toLowerCase();
  const rows = await prisma.$queryRawUnsafe<Array<{ thread_key: string; external_id: string; occurred_at: Date; sender: string | null; body: string | null }>>(
    `SELECT thread_key, external_id, occurred_at, details->>'from' AS sender, left(body_text, ${REPLY_NOTE_MAX}) AS body
       FROM wiki_sources WHERE client_number = $1 AND user_id = $2 AND kind = 'email' AND thread_key = ANY($3::text[])
      ORDER BY occurred_at DESC LIMIT 500`,
    clientNumber, userId, [...new Set(links.map((l) => l.thread))],
  ).catch(() => []);
  for (const r of rows) {
    const from = String(r.sender ?? '');
    if (!from || (mine && addressOf(from) === mine)) continue;
    for (const l of links) {
      if (l.thread !== r.thread_key || !(new Date(r.occurred_at).getTime() > Date.parse(l.since))) continue;
      const list = out.get(l.item) ?? [];
      list.push({
        at: new Date(r.occurred_at).toISOString(), who: nameOf(from).slice(0, 120), change: 'reply',
        ...(r.body ? { note: String(r.body).replace(/\s+/g, ' ').trim().slice(0, REPLY_NOTE_MAX) } : {}),
        thread_id: r.thread_key, email_id: r.external_id,
      });
      out.set(l.item, list);
    }
  }
  return out;
}

/** Thread id → its open task and since when it is linked, for the pack's emails[].task_id (DEF-509, T33 P4). */
export async function threadTaskLinks(clientNumber: string, userId: number): Promise<Map<string, { id: string; since: string }>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; thread_id: string; since: string }>>(
    `SELECT oi.id, t->>'thread_id' AS thread_id, t->>'since' AS since FROM open_items oi, jsonb_array_elements(COALESCE(oi.metadata->'suziThreads', '[]'::jsonb)) t
      WHERE oi.client_number = $1 AND oi.user_id = $2 AND oi.status NOT IN ('CLOSED', 'CANCELLED')
      ORDER BY oi.updated_at DESC LIMIT 1000`,
    clientNumber, userId,
  ).catch(() => []);
  const out = new Map<string, { id: string; since: string }>();
  for (const r of rows) if (r.thread_id && !out.has(r.thread_id)) out.set(r.thread_id, { id: r.id, since: r.since });
  return out;
}

/** SQL for /v1/changes: a reply landed on a linked thread of one of his tasks since $3. */
export const REPLY_CHANGED_SQL = `EXISTS (SELECT 1 FROM open_items oi
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(oi.metadata->'suziThreads', '[]'::jsonb)) t
    JOIN wiki_sources ws ON ws.client_number = oi.client_number AND ws.user_id = oi.user_id AND ws.kind = 'email' AND ws.thread_key = t->>'thread_id'
   WHERE oi.client_number = $1 AND oi.user_id = $2 AND oi.metadata ? 'suziThreads' AND ws.created_at > $3)`;
