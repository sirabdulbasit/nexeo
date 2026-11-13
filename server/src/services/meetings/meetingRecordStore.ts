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
}
export interface MeetingRecord {
  id: string; client_number: string; user_id: number; meeting_key: string; event_id: string | null;
  conference_record: string | null; space: string | null; title: string | null; platform: string;
  start_at: Date | null; end_at: Date | null; way: MeetingWay; sources: Array<{ way: MeetingWay; ref: string; received_at: string }>;
  participants: Participant[]; transcript: TranscriptLine[]; minutes: string | null; minutes_offered: string | null;
  minutes_edited: boolean; decisions: string[]; action_items: ActionItem[]; status: MeetingStatus;
  status_reason: string | null; updated_flag: boolean; reread_due_at: Date | null; created_at: Date; updated_at: Date;
}

export const keyForEvent = (eventId: string) => `event:${eventId}`;
export const keyForConference = (space: string, start: Date) => `conf:${space}@${start.toISOString()}`;

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
  base: { title?: string | null; eventId?: string | null; start?: Date | null; end?: Date | null; way?: MeetingWay; reason?: string; conferenceRecord?: string | null },
): Promise<MeetingRecord> {
  const existing = await byKey(clientNumber, userId, key);
  if (existing) {
    // A finished record is never pushed back to an earlier state by a late status.
    if (existing.status === 'record_ready' || existing.status === 'transcript_ready') return existing;
    await prisma.$executeRawUnsafe(
      `UPDATE meeting_records SET status = $2, status_reason = $3, conference_record = COALESCE(conference_record, $4), updated_at = now() WHERE id = $1`,
      existing.id, status, base.reason ?? null, base.conferenceRecord ?? null,
    );
    return (await getRecord(clientNumber, userId, existing.id))!;
  }
  const id = `mtg_${crypto.randomBytes(8).toString('hex')}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO meeting_records (id, client_number, user_id, meeting_key, event_id, title, start_at, end_at, way, status, status_reason, conference_record)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (client_number, user_id, meeting_key) DO NOTHING`,
    id, clientNumber, userId, key, base.eventId ?? null, base.title ?? null, base.start ?? null, base.end ?? null,
    base.way ?? 'google_transcript', status, base.reason ?? null, base.conferenceRecord ?? null,
  );
  return (await byKey(clientNumber, userId, key))!;
}

/**
 * A transcript arrives. The first one makes the record; a later one attaches as a source and replaces the
 * transcript only when it is better (higher way, or the same way with more lines: Google's entries can be
 * incomplete right after fileGenerated). Returns whether the minutes must be (re-)derived.
 */
export async function putTranscript(
  clientNumber: string, userId: number, key: string,
  t: {
    way: MeetingWay; ref: string; title?: string | null; eventId?: string | null; conferenceRecord?: string | null;
    space?: string | null; platform?: string; start?: Date | null; end?: Date | null;
    participants: Participant[]; transcript: TranscriptLine[];
  },
): Promise<{ record: MeetingRecord; derive: boolean }> {
  const now = new Date().toISOString();
  const source = { way: t.way, ref: t.ref, received_at: now };
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
    if (made && made.id === id) return { record: made, derive: t.transcript.length > 0 };
    return putTranscript(clientNumber, userId, key, t); // lost a race: attach to the winner
  }
  const sources = Array.isArray(existing.sources) ? existing.sources : [];
  const known = sources.some((s) => s.way === t.way && s.ref === t.ref);
  const hasTranscript = Array.isArray(existing.transcript) && existing.transcript.length > 0;
  const better = !hasTranscript
    || WAY_RANK[t.way] > WAY_RANK[existing.way]
    || (t.way === existing.way && t.transcript.length > existing.transcript.length);
  await prisma.$executeRawUnsafe(
    `UPDATE meeting_records SET
        sources = $2::jsonb,
        event_id = coalesce(event_id, $3), conference_record = coalesce(conference_record, $4), space = coalesce(space, $5),
        title = coalesce(title, $6), start_at = coalesce(start_at, $7), end_at = coalesce(end_at, $8),
        way = CASE WHEN $9 THEN $10 ELSE way END,
        participants = CASE WHEN $9 THEN $11::jsonb ELSE participants END,
        transcript = CASE WHEN $9 THEN $12::jsonb ELSE transcript END,
        status = CASE WHEN $9 AND status NOT IN ('record_ready') THEN 'transcript_ready' ELSE status END,
        updated_at = now()
      WHERE id = $1`,
    existing.id, JSON.stringify(known ? sources : [...sources, source]), t.eventId ?? null, t.conferenceRecord ?? null,
    t.space ?? null, t.title ?? null, t.start ?? null, t.end ?? null, better, t.way,
    JSON.stringify(t.participants), JSON.stringify(t.transcript),
  );
  return { record: (await getRecord(clientNumber, userId, existing.id))!, derive: better && t.transcript.length > 0 };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * C6: merge freshly derived minutes and items without undoing his decisions. Accepted and skipped items stay as
 * they are; a new item is proposed only if no existing item (any state) or open item says the same thing.
 */
export function mergeDerived(
  rec: Pick<MeetingRecord, 'minutes' | 'minutes_edited' | 'action_items' | 'status'>,
  derived: { minutes: string; decisions: string[]; action_items: Array<Omit<ActionItem, 'id' | 'state'>> },
  openTitles: string[] = [],
): { minutes: string | null; minutes_offered: string | null; decisions: string[]; action_items: ActionItem[]; updated: boolean } {
  const existing = Array.isArray(rec.action_items) ? rec.action_items : [];
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

export async function saveDerived(id: string, m: ReturnType<typeof mergeDerived>): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE meeting_records SET minutes = $2, minutes_offered = $3, decisions = $4::jsonb, action_items = $5::jsonb,
        status = 'record_ready', status_reason = NULL, updated_flag = $6, updated_at = now() WHERE id = $1`,
    id, m.minutes, m.minutes_offered, JSON.stringify(m.decisions), JSON.stringify(m.action_items), m.updated,
  );
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
