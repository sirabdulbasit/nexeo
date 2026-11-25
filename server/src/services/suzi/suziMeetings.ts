/**
 * F-4 Meeting Assistant ops through POST /suzi/v1/act (Functional Charter, agreed 12 Nov 2026).
 *
 *   meeting.list    {from?, to?, person?}                 his records, newest first
 *   meeting.get     {meeting_id}                          the record, with sources[].way (C7)
 *   meeting.delete  {meeting_id}                          confirmed and signed (irreversible)
 *   meeting.upload  {event_id?, title, start, end, transcript[], minutes, action_items[]}
 *                                                          from the computer, on his yes; attaches to the same record (C5)
 *   meeting.attend {event_id, way:"google_transcript"}   Way A: his hosted Meet's transcription switched on (meetAttend.ts)
 *   meeting.attend (other ways) / meeting.leave            "not_yet" until Way B is agreed and built
 *
 * Only he reads his records. Meeting data reaches Nexeo only while his Meeting Assistant switch is on (F-4.10).
 */
import {
  deleteRecord, getRecord, keyForEvent, listRecords, mergeDerived, overlappingRecord, putTranscript, saveDerived,
  type MeetingRecord, type TranscriptLine,
} from '../meetings/meetingRecordStore';

type Args = Record<string, unknown>;
type Result = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const fail = (error: string, detail?: string): Result => ({ ok: false, error, ...(detail ? { detail } : {}) });
export const MEETING_OPS = ['meeting.list', 'meeting.get', 'meeting.delete', 'meeting.upload', 'meeting.attend', 'meeting.leave', 'meeting.item', 'meeting.reread', 'meeting.transcript_edit'] as const;

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/** F-4.4's shape, as Suzi reads it. */
export function toWire(r: MeetingRecord, full: boolean): Record<string, unknown> {
  const base = {
    meeting_id: r.id, event_id: r.event_id, title: r.title, platform: r.platform, start: iso(r.start_at), end: iso(r.end_at),
    way: r.way, sources: (r.sources ?? []).map((s) => ({ way: s.way, received_at: s.received_at, ...(s.text_from ? { text_from: s.text_from } : {}) })), status: r.status,
    ...(r.status_reason ? { reason: r.status_reason } : {}), ...(r.updated_flag ? { updated: true } : {}),
    action_items_proposed: (r.action_items ?? []).filter((a) => a.state === 'proposed').length,
  };
  if (!full) return base;
  return {
    // T39: where the transcript's text came from: Google's own document (word for word as Google shows it) or the
    // Meet API's entries (only when there is no document yet). Records read before 18 Nov carry no text_from.
    ...base, participants: r.participants ?? [], transcript: r.transcript ?? [],
    transcript_from: r.way === 'google_transcript' ? ((r.sources ?? []).filter((s) => s.way === r.way).map((s) => s.text_from).filter(Boolean).pop() ?? 'google_entries') : r.way,
    minutes: r.minutes,
    ...(r.minutes_offered ? { minutes_offered: r.minutes_offered } : {}), decisions: r.decisions ?? [], action_items: r.action_items ?? [],
    // Record standard (25 Nov): risks, open questions, chair, purpose, draft/approved; English transcript; corrections.
    ...wireFields(r),
  };
}

function lines(v: unknown): TranscriptLine[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20_000).map((x: any) => ({ t: text(x?.t), speaker: text(x?.speaker) || 'Unknown speaker', text: text(x?.text) })).filter((l) => l.text);
}

export async function runMeetingOp(
  clientNumber: string, userId: number, op: string, a: Args, confirmed: boolean, gate: { signatureVerified: boolean }, timezone?: string,
): Promise<Result> {
  // Way A (16 Nov): meeting.attend {event_id, way:"google_transcript"} switches his hosted Meet's transcription on.
  if (op === 'meeting.attend' && text(a.way) === 'google_transcript') {
    const { meetingAttendWayA } = await import('../meetings/meetAttend');
    return meetingAttendWayA(clientNumber, userId, text(a.event_id));
  }
  if (op === 'meeting.leave' && text(a.event_id) && !text(a.meeting_id)) {
    const { meetingLeaveWayA } = await import('../meetings/meetAttend');
    return meetingLeaveWayA(clientNumber, userId, text(a.event_id));
  }
  if (op === 'meeting.leave' && text(a.event_id) && text(a.meeting_id)) return fail('bad_args', 'exactly one of event_id or meeting_id');
  if (op === 'meeting.attend' || op === 'meeting.leave') return fail('not_yet', 'joining as a participant (Way B) is not built yet');
  if (op === 'meeting.list') {
    // T39 r3 (18 Nov): a bare date is his local day; `to` includes the whole of it (to: "2026-11-16" found nothing).
    const { localDayStart } = await import('./zonedTime');
    const { safeTimezone } = await import('./dayBriefFacts');
    const tz = safeTimezone(timezone);
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    const at = (v: string, end: boolean) => {
      if (!DAY.test(v)) return new Date(v);
      const next = end ? new Date(Date.parse(`${v}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : v;
      return localDayStart(next, tz) ?? new Date(NaN);
    };
    const from = text(a.from) ? at(text(a.from), false) : undefined;
    const to = text(a.to) ? at(text(a.to), true) : undefined;
    if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) return fail('bad_date');
    const rows = await listRecords(clientNumber, userId, { from, to, person: text(a.person) || undefined });
    return { ok: true, item: { meetings: rows.map((r) => toWire(r, false)) } };
  }
  const id = text(a.meeting_id);
  if (op === 'meeting.get') {
    const r = id ? await getRecord(clientNumber, userId, id) : null;
    return r ? { ok: true, item: toWire(r, true) } : fail('not_found');
  }
  // F-4.7 (b): skip an action item, or put it back to proposed. His own record, reversible: confirmed, unsigned.
  if (op === 'meeting.item') {
    const itemId = text(a.item_id);
    const decision = text(a.decision);
    if (decision !== 'skip' && decision !== 'propose') return fail('bad_decision', 'decision is skip or propose');
    if (!confirmed) return fail('needs_confirmation');
    const { setActionItemState } = await import('../meetings/meetingRecordStore');
    const state = await setActionItemState(clientNumber, userId, id, itemId, decision === 'skip' ? 'skipped' : 'proposed');
    return state ? { ok: true, item: { meeting_id: id, item_id: itemId, state } } : fail('not_found');
  }
  // T39 round 2 (both AGREE 18 Nov): read Google's transcript again on his word. {meeting_id}, or {all: true, days?}
  // for his Google-transcript meetings of the last `days` (default 14, at most 30; at most 10 per call). The minutes and
  // proposed items are re-made only when the text changed; his decisions on items stay (mergeDerived).
  if (op === 'meeting.reread') return reread(clientNumber, userId, a);
  if (op === 'meeting.transcript_edit') { // record standard (25 Nov): a correction is kept with who, when, before, after
    if (!confirmed) return fail('needs_confirmation');
    const { editTranscriptLine } = await import('../meetings/meetingRecordFields');
    const r = await editTranscriptLine(clientNumber, userId, id, Number(a.index), text(a.text), 'you, through Suzi');
    if (r !== 'ok') return fail(r, r === 'bad_line' ? 'index is a transcript line, text is the corrected words' : undefined);
    const after = await getRecord(clientNumber, userId, id);
    return after ? { ok: true, item: toWire(after, true) } : fail('not_found');
  }
  if (op === 'meeting.delete') {
    if (!confirmed) return fail('needs_confirmation');
    if (!gate.signatureVerified) return fail('needs_signature', 'deleting a meeting record is irreversible and must be signed');
    return (id && await deleteRecord(clientNumber, userId, id)) ? { ok: true, item: { meeting_id: id, deleted: true } } : fail('not_found');
  }
  if (op === 'meeting.upload') {
    if (!confirmed) return fail('needs_confirmation');
    // W-1 / F-4.6 (founder 13 Nov): notes taken on his computer go to his record whether Meeting Assistant is on or off.
    // The switch governs Nexeo joining or reading Google's transcript, not his own notes.
    const start = new Date(text(a.start)); const end = new Date(text(a.end));
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return fail('bad_date', 'start and end are always required (C5)');
    const eventId = text(a.event_id) || null;
    const key = eventId ? keyForEvent(eventId) : ((await overlappingRecord(clientNumber, userId, start, end))?.meeting_key ?? `upload:${start.toISOString()}`);
    const t = lines(a.transcript);
    const { record, derive } = await putTranscript(clientNumber, userId, key, {
      way: 'computer', ref: `upload:${start.toISOString()}`, title: text(a.title) || null, eventId, start, end,
      participants: [...new Set(t.map((l) => l.speaker))].filter((n) => n !== 'Unknown speaker').map((name) => ({ name })), transcript: t,
    });
    // The computer's own minutes stand only when its transcript is the best the record has.
    const minutes = text(a.minutes);
    const { decisionsArg, actionItemsArg, recordFieldsArg, transcriptEnArg, saveRecordFields } = await import('../meetings/meetingRecordFields');
    if (derive && minutes) {
      // Record standard (25 Nov): decisions, items with owner/date/dependency, as Suzi's minutes give them.
      await saveDerived(record.id, mergeDerived(record, { minutes, decisions: decisionsArg(a.decisions), action_items: actionItemsArg(a.action_items) as any }));
    }
    // Risks, open questions, chair, purpose, draft/approved, and the English transcript are kept on every upload.
    await saveRecordFields(record.id, recordFieldsArg(a), transcriptEnArg(a.transcript_en)).catch(() => undefined);
    const after = await getRecord(clientNumber, userId, record.id);
    return { ok: true, item: toWire(after ?? record, false) };
  }
  return fail('unknown_op');
}

export const REREAD_MAX = 10;
async function reread(clientNumber: string, userId: number, a: Args): Promise<Result> {
  const prisma = (await import('../../db/prisma')).default;
  const all = a.all === true;
  const id = text(a.meeting_id);
  if (!all && !id) return fail('bad_args', 'meeting_id, or all: true');
  const days = Math.min(Math.max(Number(a.days) || 14, 1), 30);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; meeting_key: string; conference_record: string | null; title: string | null; event_id: string | null; start_at: Date | null; end_at: Date | null; way: string }>>(
    all
      ? `SELECT id, meeting_key, conference_record, title, event_id, start_at, end_at, way FROM meeting_records
          WHERE client_number = $1 AND user_id = $2 AND way = 'google_transcript' AND conference_record IS NOT NULL
            AND start_at > now() - ($3 || ' days')::interval ORDER BY start_at DESC LIMIT ${REREAD_MAX}`
      : `SELECT id, meeting_key, conference_record, title, event_id, start_at, end_at, way FROM meeting_records
          WHERE client_number = $1 AND user_id = $2 AND id = $3`,
    clientNumber, userId, all ? String(days) : id,
  );
  if (!all && !rows.length) return fail('not_found');
  if (!all && (rows[0].way !== 'google_transcript' || !rows[0].conference_record)) return fail('bad_state', 'only a meeting with a Google Meet transcript can be read again');
  const { meetFor } = await import('../meetings/meetTranscripts');
  const meet = await meetFor(userId);
  if (!meet) return fail('not_connected', 'Google is not connected');
  const { ingestConference } = await import('../meetings/meetingProcessor');
  const { wordsOf } = await import('../meetings/meetingRecordStore');
  const out: unknown[] = [];
  for (const r of rows) {
    const before = await getRecord(clientNumber, userId, r.id);
    const after = await ingestConference(clientNumber, userId, meet, r.conference_record!, r.meeting_key,
      { title: r.title, eventId: r.event_id, start: r.start_at, end: r.end_at }, { reread: true }).catch(() => null);
    const w = after ? toWire(after, true) as any : null;
    out.push(w
      ? { meeting_id: r.id, transcript_from: w.transcript_from, lines: w.transcript.length, words: wordsOf(w.transcript),
          changed: JSON.stringify(before?.transcript ?? []) !== JSON.stringify(after!.transcript ?? []) }
      : { meeting_id: r.id, error: 'not_read' });
  }
  return { ok: true, item: { meetings: out } };
}

function wireFields(r: MeetingRecord): Record<string, unknown> {
  const f: any = r.record_fields ?? {};
  return {
    risks: Array.isArray(f.risks) ? f.risks : [], open_questions: Array.isArray(f.open_questions) ? f.open_questions : [],
    ...(f.chair ? { chair: f.chair } : {}), ...(f.purpose ? { purpose: f.purpose } : {}),
    record_status: f.record_status === 'approved' ? 'approved' : 'draft',
    ...(Array.isArray(r.transcript_en) && r.transcript_en.length ? { transcript_en: r.transcript_en } : {}),
    ...(Array.isArray(r.transcript_edits) && r.transcript_edits.length ? { transcript_edits: r.transcript_edits } : {}),
  };
}
