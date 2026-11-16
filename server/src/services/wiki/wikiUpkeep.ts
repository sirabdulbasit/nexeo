/**
 * The Wiki's daily upkeep (docs/Wiki-Knowledge.md §0.13 part 13, §7).
 *
 * Acts on notes only; never on a source or a citation. Three different things,
 * never one flag:
 *  - safe to archive: an ORPHAN (no links in or out, at most one source, the
 *    newest source older than `wiki.orphan_days`) or an EMPTY note (no text,
 *    no properties, no source, nothing linking to it). Archived, not deleted:
 *    the note keeps its trail and comes back when something new is learned of
 *    it (the builders write it again);
 *  - less relevant: STALE (no new source for `wiki.stale_days`, nothing open
 *    against it) is marked, nothing is removed;
 *  - for him to decide, never resolved by itself: two people who share a phone
 *    number or that the build found possibly the same, and two readings of one
 *    task in one conversation that disagree (a CONTRADICTION).
 * Never touched: shared notes, rule notes, commitments, a note he wrote or
 * confirmed, and any note linked to an open commitment.
 * Each run is recorded as a `record` source, "Wiki upkeep, <day>", with its
 * counts and lists, so the pruning itself can be checked.
 */
import prisma from '../../db/prisma';
import { getBehaviorValue } from '../behaviorConfig';
import { saveSource } from './wikiSources';
import { WIKI_GENERATION } from './wikiStore';
/** Of the words of `a` that carry meaning, how many are in `b`. */
function likeness(a: string, b: string): number {
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
  const A = words(a); const B = words(b);
  let n = 0;
  for (const w of A) if (B.has(w)) n += 1;
  return A.size ? n / A.size : 0;
}
const STOP = new Set('the and for with from that this your you are was will into about send share provide give make get'.split(' '));

export const UPKEEP_ACTOR = 'wiki_upkeep';
/** Note types the upkeep may archive or mark. */
const PRUNABLE = ['person', 'company', 'meeting', 'group', 'project', 'topic', 'decision', 'document'];

export interface UpkeepNote {
  id: string; type: string; title: string; status: string; scope: string; body: string; metadata: any;
  lastUpdatedBy: string | null; inbound: number; outbound: number; sources: number; newestSource: Date | null;
  /** Linked (either way) to an open commitment. */
  openCommitment: boolean;
}

export interface UpkeepPlan {
  archive: Array<{ id: string; title: string; reason: 'orphan' | 'empty' }>;
  stale: Array<{ id: string; title: string }>;
  fresh: Array<{ id: string; title: string }>;
  /** Archived before, written again since by a builder: the archive mark is cleared. */
  restored: Array<{ id: string; title: string }>;
  samePhone: Array<{ phone: string; notes: string[] }>;
  possiblySame: Array<{ note: string; others: string[] }>;
  contradictions: Array<{ conversation: string; a: string; b: string; states: string[] }>;
}

const protectedNote = (n: UpkeepNote) =>
  n.scope === 'tenant' || /^user/.test(n.lastUpdatedBy ?? '') || !!n.metadata?.confirmedSame || !!n.metadata?.userEdited || n.openCommitment;

/** What the upkeep would do today. Pure. */
export function planUpkeep(notes: UpkeepNote[], cfg: { now: Date; orphanDays: number; staleDays: number }): UpkeepPlan {
  const plan: UpkeepPlan = { archive: [], stale: [], fresh: [], restored: [], samePhone: [], possiblySame: [], contradictions: [] };
  const ago = (d: Date | null) => (d ? (cfg.now.getTime() - d.getTime()) / 86_400_000 : Infinity);
  for (const n of notes) {
    if (n.status === 'active' && n.metadata?.upkeep?.archived) plan.restored.push({ id: n.id, title: n.title });
    if (n.status !== 'active' || !PRUNABLE.includes(n.type) || protectedNote(n)) continue;
    const props = n.metadata?.properties && typeof n.metadata.properties === 'object' ? Object.keys(n.metadata.properties) : [];
    if (n.body.trim().length < 20 && props.length === 0 && n.sources === 0 && n.inbound === 0) {
      plan.archive.push({ id: n.id, title: n.title, reason: 'empty' });
      continue;
    }
    if (n.inbound === 0 && n.outbound === 0 && n.sources <= 1 && ago(n.newestSource) > cfg.orphanDays) {
      plan.archive.push({ id: n.id, title: n.title, reason: 'orphan' });
      continue;
    }
    const stale = ago(n.newestSource) > cfg.staleDays;
    if (stale && !n.metadata?.upkeep?.stale) plan.stale.push({ id: n.id, title: n.title });
    if (!stale && n.metadata?.upkeep?.stale) plan.fresh.push({ id: n.id, title: n.title });
  }
  const live = notes.filter((n) => n.status === 'active');
  const byPhone = new Map<string, string[]>();
  for (const n of live) {
    if (n.type !== 'person') continue;
    const phone = String(n.metadata?.properties?.phone ?? '').replace(/[^\d+]/g, '');
    if (phone.length >= 7) byPhone.set(phone, [...(byPhone.get(phone) ?? []), n.title]);
  }
  for (const [phone, titles] of byPhone) if (titles.length > 1) plan.samePhone.push({ phone, notes: titles.sort() });
  for (const n of live) {
    if (n.type !== 'person') continue;
    const m = n.body.match(/\*\*Possibly the same person:\*\* (.+)/);
    if (m) plan.possiblySame.push({ note: n.title, others: [...m[1].matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]) });
  }
  const byConv = new Map<string, UpkeepNote[]>();
  for (const n of live) {
    if (n.type !== 'commitment' || !n.metadata?.properties?.conversation) continue;
    const k = String(n.metadata.properties.conversation);
    byConv.set(k, [...(byConv.get(k) ?? []), n]);
  }
  for (const [conv, list] of byConv) {
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i].metadata.properties; const b = list[j].metadata.properties;
      const sa = String(a.state ?? ''); const sb = String(b.state ?? '');
      const closed = (s: string) => s === 'done' || s === 'dropped';
      if (closed(sa) === closed(sb)) continue;
      // Both ways: most of each task's words are in the other (a shared machine name is not the same task).
      if (Math.min(likeness(String(a.what ?? list[i].title), String(b.what ?? list[j].title)), likeness(String(b.what ?? list[j].title), String(a.what ?? list[i].title))) < 0.6) continue;
      plan.contradictions.push({ conversation: conv, a: list[i].title, b: list[j].title, states: [sa, sb] });
    }
  }
  return plan;
}

/** The notes of one user as the upkeep reads them. */
export async function loadUpkeepNotes(clientNumber: string, userId: number): Promise<UpkeepNote[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT p.id, p.page_type, p.title, p.status, p.scope, p.body_markdown, p.metadata, p.last_updated_by,
            p.inbound_links, p.outbound_links,
            (SELECT COUNT(*)::int FROM wiki_note_sources c WHERE c.note_id = p.id) AS sources,
            (SELECT MAX(s.occurred_at) FROM wiki_note_sources c JOIN wiki_sources s ON s.id = c.source_id WHERE c.note_id = p.id) AS newest,
            EXISTS (
              SELECT 1 FROM wiki_page_links l JOIN wiki_pages c ON c.id = CASE WHEN l.from_page_id = p.id THEN l.to_page_id ELSE l.from_page_id END
               WHERE (l.from_page_id = p.id OR l.to_page_id = p.id) AND l.link_type = 'wikilink'
                 AND c.page_type = 'commitment' AND c.status = 'active' AND c.metadata->'properties'->>'state' = 'open'
            ) AS open_commitment
       FROM wiki_pages p
      WHERE p.client_number = $1 AND p.user_id = $2 AND (p.metadata->>'wiki')::int = ${WIKI_GENERATION}
        AND p.status IN ('active', 'archived')`,
    clientNumber, userId,
  );
  return rows.map((r) => ({
    id: r.id, type: r.page_type, title: r.title, status: r.status, scope: r.scope, body: r.body_markdown ?? '', metadata: r.metadata ?? {},
    lastUpdatedBy: r.last_updated_by, inbound: Number(r.inbound_links ?? 0), outbound: Number(r.outbound_links ?? 0),
    sources: Number(r.sources ?? 0), newestSource: r.newest ? new Date(r.newest) : null, openCommitment: r.open_commitment === true,
  }));
}

/** Change one note's upkeep mark (and its status), only if no writer changed the note since it was read. */
async function setUpkeep(id: string, rev: number, upkeep: Record<string, unknown> | null, status?: string): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe(
    `UPDATE wiki_pages
        SET metadata = CASE WHEN $2::jsonb IS NULL THEN metadata - 'upkeep' ELSE metadata || jsonb_build_object('upkeep', $2::jsonb) END
                       || jsonb_build_object('rev', COALESCE((metadata->>'rev')::int, 0) + 1),
            status = COALESCE($4, status)
      WHERE id = $1 AND COALESCE((metadata->>'rev')::int, 0) = $3`,
    id, upkeep === null ? null : JSON.stringify(upkeep), rev, status ?? null,
  );
  return Number(n) === 1;
}

const pkDay = (d: Date) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10);

/** Run the upkeep for one user. With `dryRun`, nothing is changed and nothing recorded. */
export async function runUpkeepForUser(
  clientNumber: string, userId: number, opts: { dryRun?: boolean; now?: Date } = {},
): Promise<{ plan: UpkeepPlan; archived: number; staled: number; freshened: number; restored: number }> {
  const now = opts.now ?? new Date();
  const [orphanDays, staleDays] = await Promise.all([
    getBehaviorValue('wiki.orphan_days', { clientNumber, userId }),
    getBehaviorValue('wiki.stale_days', { clientNumber, userId }),
  ]);
  const notes = await loadUpkeepNotes(clientNumber, userId);
  const plan = planUpkeep(notes, { now, orphanDays, staleDays });
  let archived = 0; let staled = 0; let freshened = 0; let restored = 0;
  if (!opts.dryRun) {
    const byId = new Map(notes.map((n) => [n.id, n]));
    const rev = (id: string) => Number(byId.get(id)?.metadata?.rev ?? 0) || 0;
    const kept = (id: string) => { const u = { ...(byId.get(id)?.metadata?.upkeep ?? {}) }; delete u.archived; delete u.archivedAt; return u; };
    for (const a of plan.archive) if (await setUpkeep(a.id, rev(a.id), { ...kept(a.id), archived: a.reason, archivedAt: now.toISOString() }, 'archived')) archived += 1;
    for (const s of plan.stale) if (await setUpkeep(s.id, rev(s.id), { ...(byId.get(s.id)?.metadata?.upkeep ?? {}), stale: true, staleSince: now.toISOString() })) staled += 1;
    for (const f of plan.fresh) {
      const u = { ...(byId.get(f.id)?.metadata?.upkeep ?? {}) }; delete u.stale; delete u.staleSince;
      if (await setUpkeep(f.id, rev(f.id), Object.keys(u).length ? u : null)) freshened += 1;
    }
    for (const r of plan.restored) {
      const u = kept(r.id);
      if (await setUpkeep(r.id, rev(r.id), Object.keys(u).length ? u : null)) restored += 1;
    }
    const date = pkDay(now);
    const list = (xs: Array<{ title: string }>) => xs.slice(0, 50).map((x) => `- ${x.title}`);
    await saveSource({
      clientNumber, userId, kind: 'record', externalId: `upkeep:${date}`, title: `Wiki upkeep, ${date}`, occurredAt: now, asOf: now,
      body: [
        `Wiki upkeep on ${date}: ${archived} archived, ${staled} marked stale, ${freshened} fresh again, ${restored} back from the archive.`,
        `Thresholds: orphan after ${orphanDays} days, stale after ${staleDays} days.`,
        ...(plan.archive.length ? ['', 'Archived:', ...plan.archive.slice(0, 50).map((a) => `- ${a.title} (${a.reason})`)] : []),
        ...(plan.stale.length ? ['', 'Marked stale:', ...list(plan.stale)] : []),
        ...(plan.samePhone.length ? ['', 'Same phone number, for him to decide:', ...plan.samePhone.map((p) => `- ${p.notes.join(' / ')}`)] : []),
        ...(plan.possiblySame.length ? ['', 'Possibly the same person, for him to decide:', ...plan.possiblySame.slice(0, 50).map((p) => `- ${p.note} / ${p.others.join(' / ')}`)] : []),
        ...(plan.contradictions.length ? ['', 'Disagreeing readings of one task:', ...plan.contradictions.slice(0, 50).map((c) => `- ${c.a} (${c.states[0]}) / ${c.b} (${c.states[1]})`)] : []),
      ].join('\n'),
      details: {
        archived, staled, freshened, restored, orphanDays, staleDays,
        samePhone: plan.samePhone.length, possiblySame: plan.possiblySame.length, contradictions: plan.contradictions.length,
      },
    });
  }
  return { plan, archived, staled, freshened, restored };
}

/** Has today's upkeep run for this user? (It runs once a day, from the hourly Wiki job.) */
export async function upkeepDoneToday(clientNumber: string, userId: number, now = new Date()): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT 1 FROM wiki_sources WHERE client_number = $1 AND user_id = $2 AND kind = 'record' AND external_id = $3`,
    clientNumber, userId, `upkeep:${pkDay(now)}`,
  );
  return rows.length > 0;
}
