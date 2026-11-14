/**
 * F-2.5a (charter, agreed 13 Nov 2026; founder: "from where it comes?"): where a pending action came from, for
 * Suzi's task card ("From"). Optional on every action; left out when the origin is unknown, never guessed.
 *
 *   {kind: email | meeting | whatsapp | manual | suzi, from?, subject?, at?, thread_id?, meeting_id?}
 *
 * `from` is the sender's display name, or the address only when no name is known. `subject` is at most 120
 * characters. `at` is ISO with the user's offset. Never body text.
 *
 * Until actions move onto the Wiki's commitment notes, this reads the item's own origin, Wiki first:
 *   1. the Wiki's email source (wiki_sources kind 'email') for the exact message: its feed row id, else the
 *      item's message id (source_ref). Gives from, subject, at, thread.
 *   2. else the feed row it was made from (source_feed_event_id / metadata.derivedFrom.feedEventId), which
 *      retention removes after a while.
 *   3. else a Wiki email of the same thread: subject and thread only. Which message asked is not known, so no
 *      `from` and no `at`: never guessed.
 *   meeting items: the meeting id and when it was held; suzi / manual: the kind and when it was made.
 * A read that fails leaves those sources out; the actions themselves are unaffected.
 */
import prisma from '../../db/prisma';
import { toZonedIso } from './zonedTime';

export type SourceKind = 'email' | 'meeting' | 'whatsapp' | 'manual' | 'suzi';
export interface ActionSource { kind: SourceKind; from?: string; subject?: string; at?: string; thread_id?: string; meeting_id?: string }

type Row = { id: string; sourceFeed?: string | null; sourceRef?: string | null; sourceFeedEventId?: string | null; metadata?: any; createdAt?: Date | null };
type Wiki = { feed_event_id: string | null; external_id: string; thread_key: string | null; title: string | null; from_raw: string | null; occurred_at: Date | null };
type Feed = { id: string; source_type: string; sender_name: string | null; sender_email: string | null; subject: string | null; from_raw: string | null; thread_id: string | null; event_at: Date | null; created_at: Date | null };

/** The display name from `"Name" <a@b>` / `Name <a@b>`; else the bare address; else null. */
export function displayFrom(name: string | null | undefined, raw: string | null | undefined): string | null {
  const n = String(name ?? '').trim();
  if (n) return n.slice(0, 120);
  const r = String(raw ?? '').trim();
  if (!r) return null;
  const m = r.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return (m[1].trim() || m[2].trim()).slice(0, 120);
  return r.slice(0, 120);
}

const iso = (d: Date | string | null | undefined, tz: string): string | undefined => {
  if (!d) return undefined;
  const x = new Date(d);
  return isNaN(x.getTime()) ? undefined : toZonedIso(x, tz) ?? undefined;
};

function feedIdOf(r: Row): string | null {
  return r.sourceFeedEventId || r.metadata?.derivedFrom?.feedEventId || null;
}

/** Sources for a set of the user's own items, keyed by item id. Items with no known origin are absent. */
export async function actionSources(clientNumber: string, userId: number, rows: Row[], tz: string): Promise<Map<string, ActionSource>> {
  const out = new Map<string, ActionSource>();
  if (!rows.length) return out;
  const ids = [...new Set(rows.map(feedIdOf).filter(Boolean) as string[])];
  const refs = [...new Set(rows.map((r) => r.sourceRef).filter(Boolean) as string[])];
  const threads = [...new Set(rows.map((r) => r.metadata?.derivedFrom?.threadId).filter(Boolean) as string[])];
  const wiki: Wiki[] = (ids.length || refs.length || threads.length) ? (await prisma.$queryRawUnsafe<Wiki[]>(
    `SELECT feed_event_id, external_id, thread_key, title, details->>'from' AS from_raw, occurred_at
       FROM wiki_sources
      WHERE client_number = $1 AND user_id = $2 AND kind = 'email'
        AND (feed_event_id = ANY($3::text[]) OR external_id = ANY($4::text[]) OR thread_key = ANY($5::text[]))
      ORDER BY occurred_at DESC NULLS LAST LIMIT 2000`,
    clientNumber, userId, ids, refs, threads,
  ).catch(() => null)) ?? [] : [];
  const feeds = new Map<string, Feed>();
  if (ids.length) {
    const got = await prisma.$queryRawUnsafe<Feed[]>(
      `SELECT id, source_type, sender_name, sender_email, raw_payload->>'subject' AS subject, raw_payload->>'from' AS from_raw,
              raw_payload->>'threadId' AS thread_id, event_at, created_at
         FROM feed_events WHERE client_number = $1 AND id = ANY($2::text[])`,
      clientNumber, ids,
    ).catch(() => null);
    for (const f of got ?? []) feeds.set(f.id, f);
  }
  for (const r of rows) {
    const s = sourceOf(r, wiki, feeds, tz);
    if (s) out.set(r.id, s);
  }
  return out;
}

/** Subjects as written, without byte-order marks or zero-width characters. */
const clean = (t: string | null | undefined): string => String(t ?? '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();

function emailFrom(w: Wiki, r: Row, tz: string, exact: boolean): ActionSource {
  const s: ActionSource = { kind: 'email' };
  if (exact) { const from = displayFrom(null, w.from_raw); if (from) s.from = from; }
  const subj = clean(w.title); if (subj) s.subject = subj.slice(0, 120);
  if (exact) { const at = iso(w.occurred_at, tz); if (at) s.at = at; }
  const th = w.thread_key || r.metadata?.derivedFrom?.threadId; if (th) s.thread_id = String(th);
  return s;
}

function sourceOf(r: Row, wiki: Wiki[], feeds: Map<string, Feed>, tz: string): ActionSource | null {
  const fid = feedIdOf(r);
  const isMail = r.sourceFeed === 'gmail' || !!r.metadata?.derivedFrom;
  if (isMail) {
    const exact = wiki.find((w) => (fid && w.feed_event_id === fid) || (r.sourceRef && w.external_id === r.sourceRef));
    if (exact) return emailFrom(exact, r, tz, true);
  }
  const f = fid ? feeds.get(fid) : undefined;
  if (f) {
    const kind: SourceKind | null = f.source_type === 'gmail' ? 'email' : f.source_type === 'whatsapp' ? 'whatsapp' : null;
    if (!kind) return null;
    const s: ActionSource = { kind };
    const from = displayFrom(f.sender_name, f.sender_email || f.from_raw);
    if (from) s.from = from;
    if (kind === 'email' && clean(f.subject)) s.subject = clean(f.subject).slice(0, 120);
    const at = iso(f.event_at ?? f.created_at, tz);
    if (at) s.at = at;
    const th = f.thread_id || r.metadata?.derivedFrom?.threadId;
    if (kind === 'email' && th) s.thread_id = String(th);
    return s;
  }
  const th = r.metadata?.derivedFrom?.threadId;
  if (isMail && th) { const w = wiki.find((x) => x.thread_key === th); if (w) return emailFrom(w, r, tz, false); }
  const m = r.metadata?.source;
  if (r.sourceFeed === 'meeting' || m?.kind === 'meeting') {
    const id = m?.meetingMinutesId || r.sourceRef;
    if (!id) return null;
    const s: ActionSource = { kind: 'meeting', meeting_id: String(id) };
    const at = iso(m?.heldAt, tz);
    if (at) s.at = at;
    return s;
  }
  if (r.sourceFeed === 'suzi' || r.sourceFeed === 'manual') {
    const s: ActionSource = { kind: r.sourceFeed };
    const at = iso(r.createdAt, tz);
    if (at) s.at = at;
    return s;
  }
  return null; // gmail/whatsapp with no readable feed row, commitment, erp, …: unknown, so left out
}
