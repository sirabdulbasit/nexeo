/**
 * Meeting transcripts as Wiki sources (docs/Wiki-Knowledge.md §0.13 part 11).
 *
 * The Meeting Assistant (F-4) keeps one record per meeting per user, with the
 * transcript, the minutes, the decisions and the action items it derived. Each
 * record that holds a transcript is landed as one `transcript` source, its text
 * encrypted at rest (F-4.10), with the derived parts in its details. From it:
 *  - the meeting's note cites it and shows the minutes (wikiBuilder);
 *  - its decisions and action items become decision and commitment notes, with
 *    his accept or skip as his word (wikiMeaning, no second model reading).
 * A record he deleted takes its source with it.
 */
import prisma from '../../db/prisma';
import { saveSource, removeSource, listSources, sourceId, type Source } from './wikiSources';

export const TRANSCRIPT_KIND = 'transcript' as const;

export interface RecordRow {
  id: string; client_number: string; user_id: number; event_id: string | null; title: string | null;
  start_at: Date | null; end_at: Date | null; way: string; status: string; participants: any; transcript: any;
  minutes: string | null; decisions: any; action_items: any; updated_at: Date;
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** JSON with every object's keys sorted, so two equal values print the same. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** The calendar series a record belongs to (Google's event id without the instance suffix). */
export function seriesOf(eventId: string | null | undefined): string | null {
  const s = String(eventId ?? '').trim();
  return s ? s.split('_')[0] : null;
}

/** The record's transcript as text: one line per turn. */
export function transcriptText(lines: unknown): string {
  return arr(lines)
    .map((l) => `${String(l?.t ?? '').trim()} ${String(l?.speaker ?? '').trim()}: ${String(l?.text ?? '').trim()}`.trim())
    .filter((l) => l.length > 2)
    .join('\n');
}

/** What lands for one record, or null when it holds no transcript yet. */
export function sourceFromRecord(r: RecordRow) {
  const text = transcriptText(r.transcript);
  if (!text) return null;
  const participants = arr(r.participants).map((p) => (p?.email ? `${p.name ?? ''} <${p.email}>`.trim() : String(p?.name ?? ''))).filter(Boolean);
  return {
    clientNumber: r.client_number, userId: Number(r.user_id), kind: TRANSCRIPT_KIND, externalId: r.id,
    threadKey: seriesOf(r.event_id) ? `event:${seriesOf(r.event_id)}` : `meeting:${r.id}`,
    title: r.title ?? null, occurredAt: r.start_at ?? null, participants,
    body: text, encrypt: true, asOf: r.updated_at,
    details: {
      meetingId: r.id, eventId: r.event_id, series: seriesOf(r.event_id), way: r.way, status: r.status,
      end: r.end_at ? new Date(r.end_at).toISOString() : null,
      people: arr(r.participants).map((p) => ({ name: p?.name ?? null, email: p?.email ? String(p.email).toLowerCase() : null })),
      minutes: r.minutes ? String(r.minutes).slice(0, 6000) : null,
      decisions: arr(r.decisions).map((d) => String(typeof d === 'string' ? d : d?.what ?? d?.text ?? '')).filter(Boolean),
      actionItems: arr(r.action_items).map((a) => ({
        id: a?.id ?? null, title: String(a?.title ?? ''), ownerName: a?.owner_name ?? null, due: a?.due ?? null,
        state: a?.state ?? 'proposed', taskId: a?.task_id ?? null,
      })).filter((a) => a.title),
    },
  };
}

/** Land every transcript this user's meeting records hold; remove the sources of records he deleted. */
export async function landTranscripts(clientNumber: string, userId: number): Promise<{ records: number; landed: number; removed: number }> {
  const rows = await prisma.$queryRawUnsafe<RecordRow[]>(
    `SELECT id, client_number, user_id, event_id, title, start_at, end_at, way, status, participants, transcript,
            minutes, decisions, action_items, updated_at
       FROM meeting_records WHERE client_number = $1 AND user_id = $2`,
    clientNumber, userId,
  ); // A failed read throws: an empty answer here would remove every transcript source below.
  let landed = 0;
  const live = new Set<string>();
  for (const r of rows) {
    const src = sourceFromRecord(r);
    if (!src) continue;
    live.add(sourceId(clientNumber, userId, TRANSCRIPT_KIND, r.id));
    const held: any[] = await prisma.$queryRawUnsafe(
      `SELECT details FROM wiki_sources WHERE id = $1`, sourceId(clientNumber, userId, TRANSCRIPT_KIND, r.id),
    );
    // Unchanged record: nothing to land (the text is encrypted, so the details tell).
    // (The database stores keys in its own order: compared key-sorted.)
    if (held[0] && stableJson(held[0].details ?? {}) === stableJson({ ...(held[0].details ?? {}), ...JSON.parse(JSON.stringify(src.details)) })) continue;
    await saveSource(src);
    landed += 1;
  }
  let removed = 0;
  const held = await listSources(clientNumber, userId, [TRANSCRIPT_KIND]);
  for (const s of held) {
    if (live.has(s.id)) continue;
    // Its record is gone (he deleted it, F-4.10): the Wiki lets go of it too.
    if (await removeSource({ clientNumber, userId }, s.id).then((r) => r.removed).catch(() => false)) removed += 1;
  }
  return { records: rows.length, landed, removed };
}

/** The transcript sources of a user, for the builders. */
export async function transcriptSources(clientNumber: string, userId: number): Promise<Source[]> {
  return listSources(clientNumber, userId, [TRANSCRIPT_KIND]);
}

/**
 * A recorded meeting read as a conversation for the meaning notes: its decisions, and its action items
 * as commitments. The Meeting Assistant already read the transcript, so no model reads it again. His
 * word on an item holds: skipped is dropped; accepted is his task (it is in his Action Center, whose
 * rulings the meaning notes read as well); proposed is open, not yet confirmed.
 */
export function meetingExtractions(
  sources: Source[],
  who: { ownEmails: Set<string>; userName?: string | null },
): Array<{ conv: { key: string; subject: string; sources: Source[]; last: Date }; ex: {
  projects: never[]; topics: never[];
  decisions: Array<{ what: string; by: null; date: string | null }>;
  commitments: Array<{ what: string; owner: string | null; to: null; due: string | null; state: 'open' | 'done' | 'dropped'; evidence: string; date: string | null }>;
} }> {
  const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9؀-ۿ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const own = [...who.ownEmails][0] ?? null;
  const out = [];
  for (const s of sources) {
    const d = (s.details ?? {}) as any;
    const at = s.occurredAt ?? new Date(0);
    const date = at.getTime() > 0 ? at.toISOString().slice(0, 10) : null;
    const people: Array<{ name: string | null; email: string | null }> = arr(d.people);
    const emailOf = (name: unknown): string | null => {
      const n = norm(name);
      if (!n) return null;
      if (who.userName && (norm(who.userName) === n || norm(who.userName).split(' ')[0] === n)) return own;
      const hit = people.find((p) => p.email && (norm(p.name) === n || norm(p.name).split(' ')[0] === n.split(' ')[0]));
      return hit?.email ?? null;
    };
    const decisions = arr(d.decisions).map((x) => String(x).trim()).filter((x) => x.length >= 5).map((what) => ({ what: what.slice(0, 240), by: null, date }));
    const commitments = arr(d.actionItems).filter((a) => String(a?.title ?? '').trim().length >= 5).map((a) => ({
      what: String(a.title).trim().slice(0, 200),
      owner: emailOf(a.ownerName),
      to: null,
      due: typeof a.due === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a.due) ? a.due.slice(0, 10) : null,
      state: (a.state === 'skipped' ? 'dropped' : 'open') as 'open' | 'dropped',
      evidence: a.state === 'accepted' ? 'accepted by him from the meeting' : a.state === 'skipped' ? 'skipped by him' : 'proposed from the meeting; not yet accepted',
      date,
    }));
    if (decisions.length === 0 && commitments.length === 0) continue;
    out.push({ conv: { key: `meeting:${d.meetingId ?? s.externalId}`, subject: `Meeting: ${s.title ?? 'untitled'} (${date ?? ''})`, sources: [s], last: at }, ex: { projects: [], topics: [], decisions, commitments } });
  }
  return out;
}
