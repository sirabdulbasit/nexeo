/**
 * F-4 Meeting Assistant (Functional Charter, agreed 12 Nov 2026): the meeting record, one per meeting PER USER.
 *
 *   F-4.4  {meeting_id, event_id?, title, platform, start, end, way, sources[{way, ref, received_at}],
 *           participants[{name, email?}], transcript[{t, speaker, text}], minutes, decisions[], action_items[], status}
 *   F-4.5  keyed by the calendar event (or the Meet conference and its start), never by the way it arrived. The first
 *          arrival makes the record; later ones attach as sources[]. The best transcript wins: google_transcript, then
 *          participant, imported, computer. Re-deriving never undoes his decisions (C6): accepted or skipped action
 *          items stay, only new ones are proposed; minutes he edited are kept and the improved version is offered.
 *   F-4.10 for him alone; he can delete it; after 12 months only the minutes and action items are kept. No sound.
 */
import { stableJson } from '../../utils/stableJson';
import crypto from 'crypto';
import prisma from '../../db/prisma';

export type MeetingWay = 'google_transcript' | 'participant' | 'imported' | 'computer';
export type MeetingStatus = 'transcribing' | 'transcript_ready' | 'record_ready' | 'not_covered' | 'failed';
export const WAY_RANK: Record<MeetingWay, number> = { google_transcript: 4, participant: 3, imported: 2, computer: 1 };

export interface TranscriptLine { t: string; speaker: string; text: string }
export interface Participant { name: string; email?: string }
export interface ActionItem {
  id: string; title: string; owner_name?: string; person_id?: string; due?: string;
  state: 'proposed' | 'accepted' | 'skipped'; task_id?: string;
  /** Record standard (25 Nov): no owner given → owner_needed, never an invented owner; and where it was said. */
  owner_needed?: true; dependency?: string; status?: string; source?: [string, string]; ref?: string;
}
export interface MeetingRecord {
  id: string; client_number: string; user_id: number; meeting_key: string; event_id: string | null;
  conference_record: string | null; space: string | null; title: string | null; platform: string;
  start_at: Date | null; end_at: Date | null; way: MeetingWay; sources: Array<{ way: MeetingWay; ref: string; received_at: string; text_from?: TextFrom }>;
  participants: Participant[]; transcript: TranscriptLine[]; minutes: string | null; minutes_offered: string | null;
  minutes_edited: boolean; decisions: Array<string | { id: string; text: string; confirmed_by?: string; source?: [string, string] }>; action_items: ActionItem[]; status: MeetingStatus;
  record_fields?: Record<string, unknown>; transcript_en?: TranscriptLine[] | null; transcript_edits?: unknown[];
  status_reason: string | null; updated_flag: boolean; reread_due_at: Date | null; created_at: Date; updated_at: Date; changed_at?: Date;
}

/**
 * F-4.9: tell his live Suzi sessions when a record's status really changes (meeting.status). Fire-and-forget: a
 * push that fails changes nothing here, and Suzi's meeting.list read stays correct.
 */
// ON since 16 Nov 2026: Suzi's server has POST /admin/meeting-status (patch 0002, installed 12:42:51 PKT on the
// founder's "ok do it"), and suzi-b5 sent its "go". Off = nothing pushed and the pack's status_push absent: Suzi polls.
export const PUSH_STATUS = { on: true };
function pushStatus(r: MeetingRecord | null | undefined): void {
  if (!r || !PUSH_STATUS.on) return;
  const proposed = (Array.isArray(r.action_items) ? r.action_items : []).filter((a) => a.state === 'proposed').length;
  void import('../suzi/gatewayAdminClient').then(({ pushMeetingStatus }) => pushMeetingStatus(
    { userId: r.user_id, clientNumber: r.client_number },
    { meeting_id: r.id, event_id: r.event_id, title: r.title, status: r.status, reason: r.status_reason,
      ...(r.status === 'record_ready' ? { updated: !!r.updated_flag, action_items_proposed: proposed } : {}) },
  )).catch(() => undefined);
}

export const keyForEvent = (eventId: string) => `event:${eventId}`;
export const keyForConference = (space: string, start: Date) => `conf:${space}@${start.toISOString()}`;

export const byKeyPublic = (clientNumber: string, userId: number, key: string) => byKey(clientNumber, userId, key);
async function byKey(clientNumber: string, userId: number, key: string): Promise<MeetingRecord | null> {
  const rows = await prisma.$queryRawUnsafe<MeetingRecord[]>(
    `SELECT * FROM meeting_records WHERE client_number = $1 AND user_id = $2 AND meeting_key = $3`, clientNumber, userId, key,
  );
  return rows[0] ?? null;
}

export async function getRecord(clientNumber: string, userId: number, id: string): Promise<MeetingRecord | null> {
  const rows = await prisma.$queryRawUnsafe<MeetingRecord[]>(
    `SELECT * FROM meeting_records WHERE client_number = $1 AND user_id = $2 AND id = $3`, clientNumber, userId, id,
  );
  return rows[0] ?? null;
}

/** A record he already has for this time, so an arrival without an event attaches to it (F-4.5). */
export async function overlappingRecord(clientNumber: string, userId: number, start: Date, end: Date): Promise<MeetingRecord | null> {
  const rows = await prisma.$queryRawUnsafe<MeetingRecord[]>(
    `SELECT * FROM meeting_records WHERE client_number = $1 AND user_id = $2 AND start_at < $4 AND end_at > $3
      ORDER BY abs(extract(epoch from (start_at - $3::timestamptz))) LIMIT 1`, clientNumber, userId, start, end,
  );
  return rows[0] ?? null;
}

/** A status with no transcript yet (transcribing, not_covered, failed): makes the record if needed. */
export async function setStatus(
  clientNumber: string, userId: number, key: string, status: MeetingStatus,
  base: { title?: string | null; eventId?: string | null; start?: Date | null; end?: Date | null; way?: MeetingWay; reason?: string; conferenceRecord?: string | null; quiet?: boolean },
): Promise<MeetingRecord> {
  const existing = await byKey(clientNumber, userId, key);
  if (existing) {
    // A finished record is never pushed back to an earlier state by a late status.
    if (existing.status === 'record_ready' || existing.status === 'transcript_ready') return existing;
    // His "no notes" for this meeting (meeting.leave) stands until his own meeting.attend (transcribing) replaces it.
    if (existing.status === 'not_covered' && existing.status_reason === 'his_choice' && status !== 'transcribing') return existing;
    await prisma.$executeRawUnsafe(
      `UPDATE meeting_records SET changed_at = CASE WHEN status IS DISTINCT FROM $2 OR status_reason IS DISTINCT FROM $3 THEN now() ELSE changed_at END,
         status = $2, status_reason = $3, conference_record = COALESCE(conference_record, $4), updated_at = now() WHERE id = $1`,
      existing.id, status, base.reason ?? null, base.conferenceRecord ?? null,
    );
    const after = (await getRecord(clientNumber, userId, existing.id))!;
    if (!base.quiet && (existing.status !== status || (existing.status_reason ?? null) !== (base.reason ?? null))) pushStatus(after);
    return after;
  }
  const id = `mtg_${crypto.randomBytes(8).toString('hex')}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO meeting_records (id, client_number, user_id, meeting_key, event_id, title, start_at, end_at, way, status, status_reason, conference_record)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (client_number, user_id, meeting_key) DO NOTHING`,
    id, clientNumber, userId, key, base.eventId ?? null, base.title ?? null, base.start ?? null, base.end ?? null,
    base.way ?? 'google_transcript', status, base.reason ?? null, base.conferenceRecord ?? null,
  );
  const made = (await byKey(clientNumber, userId, key))!;
  if (made?.id === id && !base.quiet) pushStatus(made); // a lost race was pushed by the winner
  return made;
}

/**
 * A transcript arrives. The first one makes the record; a later one attaches as a source and replaces the
 * transcript only when it is better (higher way, or the same way with more lines: Google's entries can be
 * incomplete right after fileGenerated). Returns whether the minutes must be (re-)derived.
 */
export type TextFrom = 'google_doc' | 'google_entries';
const TEXT_FROM_RANK: Record<string, number> = { google_entries: 0, google_doc: 1 };
export const wordsOf = (lines: TranscriptLine[]): number => (lines ?? []).reduce((n, l) => n + String(l?.text ?? '').split(/\s+/).filter(Boolean).length, 0);

export async function putTranscript(
  clientNumber: string, userId: number, key: string,
  t: {
    way: MeetingWay; ref: string; title?: string | null; eventId?: string | null; conferenceRecord?: string | null;
    space?: string | null; platform?: string; start?: Date | null; end?: Date | null;
    participants: Participant[]; transcript: TranscriptLine[];
    /** T39: Google's transcript document, or the Meet API's entries (rougher; Google's document wins). */
    textFrom?: TextFrom;
  },
): Promise<{ record: MeetingRecord; derive: boolean }> {
  const now = new Date().toISOString();
  const source = { way: t.way, ref: t.ref, received_at: now, ...(t.textFrom ? { text_from: t.textFrom } : {}) };
  const existing = await byKey(clientNumber, userId, key);
  if (!existing) {
    const id = `mtg_${crypto.randomBytes(8).toString('hex')}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO meeting_records (id, client_number, user_id, meeting_key, event_id, conference_record, space, title, platform,
         start_at, end_at, way, sources, participants, transcript, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,'transcript_ready')
       ON CONFLICT (client_number, user_id, meeting_key) DO NOTHING`,
      id, clientNumber, userId, key, t.eventId ?? null, t.conferenceRecord ?? null, t.space ?? null, t.title ?? null,
      t.platform ?? 'meet', t.start ?? null, t.end ?? null, t.way, JSON.stringify([source]),
      JSON.stringify(t.participants), JSON.stringify(t.transcript),
    );
    const made = await byKey(clientNumber, userId, key);
    if (made && made.id === id) { pushStatus(made); return { record: made, derive: t.transcript.length > 0 }; }
    return putTranscript(clientNumber, userId, key, t); // lost a race: attach to the winner
  }
  const sources = Array.isArray(existing.sources) ? existing.sources : [];
  const known = sources.some((s) => s.way === t.way && s.ref === t.ref);
  const hasTranscript = Array.isArray(existing.transcript) && existing.transcript.length > 0;
  // T39 (18 Nov): within one way, Google's document beats the API entries, then more WORDS win (the document joins a
  // speaker's entries into fewer, fuller lines, so a line count would keep the rougher copy).
  const fromOld = TEXT_FROM_RANK[sources.filter((x) => x.way === existing.way).map((x) => x.text_from).filter(Boolean).pop() ?? 'google_entries'] ?? 0;
  const fromNew = TEXT_FROM_RANK[t.textFrom ?? 'google_entries'] ?? 0;
  const better = !hasTranscript
    || WAY_RANK[t.way] > WAY_RANK[existing.way]
    || (t.way === existing.way && (fromNew > fromOld || (fromNew === fromOld && wordsOf(t.transcript) > wordsOf(existing.transcript))));
  const nextSources = known
    ? sources.map((x) => (better && x.way === t.way && x.ref === t.ref && t.textFrom ? { ...x, text_from: t.textFrom } : x))
    : [...sources, source];
  await prisma.$executeRawUnsafe(
    `UPDATE meeting_records SET
        sources = $2::jsonb,
        event_id = coalesce(event_id, $3), conference_record = coalesce(conference_record, $4), space = coalesce(space, $5),
        title = coalesce(title, $6), start_at = coalesce(start_at, $7), end_at = coalesce(end_at, $8),
        way = CASE WHEN $9 THEN $10 ELSE way END,
        participants = CASE WHEN $9 THEN $11::jsonb ELSE participants END,
        transcript = CASE WHEN $9 THEN $12::jsonb ELSE transcript END,
        changed_at = CASE WHEN $9 AND status NOT IN ('record_ready', 'transcript_ready') THEN now() ELSE changed_at END,
        status = CASE WHEN $9 AND status NOT IN ('record_ready') THEN 'transcript_ready' ELSE status END,
        updated_at = now()
      WHERE id = $1`,
    existing.id, JSON.stringify(nextSources), t.eventId ?? null, t.conferenceRecord ?? null,
    t.space ?? null, t.title ?? null, t.start ?? null, t.end ?? null, better, t.way,
    JSON.stringify(t.participants), JSON.stringify(t.transcript),
  );
  const after = (await getRecord(clientNumber, userId, existing.id))!;
  if (after && after.status !== existing.status) pushStatus(after);
  return { record: after, derive: better && t.transcript.length > 0 };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * C6: merge freshly derived minutes and items without undoing his decisions. Accepted and skipped items stay as
 * they are; a new item is proposed only if no existing item (any state) or open item says the same thing.
 */
export function mergeDerived(
  rec: Pick<MeetingRecord, 'minutes' | 'minutes_edited' | 'action_items' | 'status'>,
  derived: { minutes: string; decisions: MeetingRecord['decisions']; action_items: Array<Omit<ActionItem, 'id' | 'state'>> },
  openTitles: string[] = [],
): { minutes: string | null; minutes_offered: string | null; decisions: MeetingRecord['decisions']; action_items: ActionItem[]; updated: boolean } {
  // An item already on the record keeps his decision (state, task), but gains an owner, date or dependency it was
  // missing when the same item arrives with them (25 Nov: the 13:21 record had lost its owner and "Fri 28 Nov").
  const fill = new Map(derived.action_items.map((a) => [norm(a.title), a]));
  const existing = (Array.isArray(rec.action_items) ? rec.action_items : []).map((e) => {
    const d = fill.get(norm(e.title));
    if (!d) return e;
    const out: ActionItem = { ...e };
    for (const k of ['owner_name', 'person_id', 'due', 'dependency', 'status', 'source'] as const) if ((out as any)[k] === undefined && (d as any)[k] !== undefined) (out as any)[k] = (d as any)[k];
    if (out.owner_name || out.person_id) delete out.owner_needed;
    return out;
  });
  const seen = new Set([...existing.map((a) => norm(a.title)), ...openTitles.map(norm)]);
  const added: ActionItem[] = [];
  for (const a of derived.action_items) {
    const k = norm(a.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    added.push({ ...a, id: `ai_${crypto.randomBytes(4).toString('hex')}`, state: 'proposed' });
  }
  const minutesKept = rec.minutes_edited && rec.minutes;
  return {
    minutes: minutesKept ? rec.minutes : derived.minutes,
    minutes_offered: minutesKept ? derived.minutes : null,
    decisions: derived.decisions,
    action_items: [...existing, ...added],
    updated: rec.status === 'record_ready',
  };
}

/** True when the notes a save would write differ from what the record already holds: minutes, offered minutes,
 *  decisions or action items. A re-read that produced the same notes is not a change. */
export function notesChanged(
  prev: Pick<MeetingRecord, 'minutes' | 'minutes_offered' | 'decisions' | 'action_items'> | null | undefined,
  m: Pick<ReturnType<typeof mergeDerived>, 'minutes' | 'minutes_offered' | 'decisions' | 'action_items'>,
): boolean {
  if (!prev) return true;
  // Key order is not a change: Postgres jsonb returns keys in its own order (found 16 Nov on a real Postgres).
  const j = (v: unknown) => stableJson(v ?? null);
  return (prev.minutes ?? null) !== (m.minutes ?? null) || (prev.minutes_offered ?? null) !== (m.minutes_offered ?? null)
    || j(prev.decisions ?? []) !== j(m.decisions ?? []) || j(prev.action_items ?? []) !== j(m.action_items ?? []);
}

export async function saveDerived(id: string, m: ReturnType<typeof mergeDerived>): Promise<void> {
  // The real-change filter (suzi-b5, 14 Nov): a save pushes only when the record became record_ready or its notes
  // changed, and updated:true marks a re-read that actually changed them. The same notes again push nothing and
  // leave updated_flag as it was.
  const prev = (await prisma.$queryRawUnsafe<MeetingRecord[]>(`SELECT * FROM meeting_records WHERE id = $1`, id).catch(() => [] as MeetingRecord[]))[0];
  const wasReady = prev?.status === 'record_ready';
  const changed = notesChanged(prev, m);
  if (wasReady && !changed) return;
  await prisma.$executeRawUnsafe(
    `UPDATE meeting_records SET minutes = $2, minutes_offered = $3, decisions = $4::jsonb, action_items = $5::jsonb,
        status = 'record_ready', status_reason = NULL, updated_flag = $6, updated_at = now(), changed_at = now() WHERE id = $1`,
    id, m.minutes, m.minutes_offered, JSON.stringify(m.decisions), JSON.stringify(m.action_items), m.updated && wasReady && changed,
  );
  const rows = await prisma.$queryRawUnsafe<MeetingRecord[]>(`SELECT * FROM meeting_records WHERE id = $1`, id).catch(() => [] as MeetingRecord[]);
  pushStatus(rows[0]);
}

export async function setTitle(id: string, title: string): Promise<void> {
  await prisma.$executeRawUnsafe(`UPDATE meeting_records SET title = $2, updated_at = now() WHERE id = $1`, id, title.slice(0, 200));
}

export async function scheduleReread(id: string, at: Date | null): Promise<void> {
  await prisma.$executeRawUnsafe(`UPDATE meeting_records SET reread_due_at = $2 WHERE id = $1`, id, at);
}

export async function listRecords(
  clientNumber: string, userId: number, f: { from?: Date; to?: Date; person?: string } = {},
): Promise<MeetingRecord[]> {
  const rows = await prisma.$queryRawUnsafe<MeetingRecord[]>(
    `SELECT * FROM meeting_records WHERE client_number = $1 AND user_id = $2
        AND ($3::timestamptz IS NULL OR start_at >= $3) AND ($4::timestamptz IS NULL OR start_at < $4)
      ORDER BY start_at DESC NULLS LAST LIMIT 200`,
    clientNumber, userId, f.from ?? null, f.to ?? null,
  );
  const p = (f.person ?? '').trim().toLowerCase();
  if (!p) return rows;
  return rows.filter((r) => (r.participants ?? []).some((x) => `${x.name} ${x.email ?? ''}`.toLowerCase().includes(p)));
}

export async function deleteRecord(clientNumber: string, userId: number, id: string): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe(
    `DELETE FROM meeting_records WHERE client_number = $1 AND user_id = $2 AND id = $3`, clientNumber, userId, id,
  );
  return Number(n) > 0;
}

/** F-4.10: after 12 months only the minutes and action items are kept. */
export async function trimOldTranscripts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const n = await prisma.$executeRawUnsafe(
    `UPDATE meeting_records SET transcript = '[]'::jsonb, participants = participants, trimmed_at = now(), updated_at = now()
      WHERE trimmed_at IS NULL AND coalesce(end_at, created_at) < $1`, cutoff,
  );
  return Number(n);
}

/**
 * F-4.7 (suzi-23, Nexeo AGREE 13 Nov): one action item's state, in ONE statement (accepted with its task, skipped, or back
 * to proposed). Only his own record; an item id that is not in it changes nothing. Returns the new state, or null.
 */
export async function setActionItemState(
  clientNumber: string, userId: number, meetingId: string, itemId: string, state: 'proposed' | 'accepted' | 'skipped', taskId?: string | null,
): Promise<'proposed' | 'accepted' | 'skipped' | null> {
  if (!meetingId || !itemId) return null;
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE meeting_records
        SET action_items = (
              SELECT jsonb_agg(CASE WHEN e->>'id' = $4
                                    THEN (e || jsonb_build_object('state', $5::text)) || CASE WHEN $6::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('task_id', $6::text) END
                                    ELSE e END ORDER BY o)
                FROM jsonb_array_elements(action_items) WITH ORDINALITY AS t(e, o)),
            changed_at = CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(action_items) y WHERE y->>'id' = $4 AND y->>'state' IS DISTINCT FROM $5::text)
                              THEN now() ELSE changed_at END,
            updated_at = now()
      WHERE id = $3 AND client_number = $1 AND user_id = $2
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(action_items) x WHERE x->>'id' = $4)
      RETURNING id`,
    clientNumber, userId, meetingId, itemId, state, taskId ?? null,
  );
  return rows.length ? state : null;
}
