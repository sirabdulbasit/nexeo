/**
 * F-4 Meeting Assistant ops through POST /suzi/v1/act (Functional Charter, agreed 12 Nov 2026).
 *
 *   meeting.list    {from?, to?, person?}                 his records, newest first
 *   meeting.get     {meeting_id}                          the record, with sources[].way (C7)
 *   meeting.delete  {meeting_id}                          confirmed and signed (irreversible)
 *   meeting.upload  {event_id?, title, start, end, transcript[], minutes, action_items[]}
 *                                                          from the computer, on his yes; attaches to the same record (C5)
 *   meeting.attend / meeting.leave                         Way B only: "not_yet" until Way B is agreed and built
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
export const MEETING_OPS = ['meeting.list', 'meeting.get', 'meeting.delete', 'meeting.upload', 'meeting.attend', 'meeting.leave', 'meeting.item'] as const;

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/** F-4.4's shape, as Suzi reads it. */
export function toWire(r: MeetingRecord, full: boolean): Record<string, unknown> {
  const base = {
    meeting_id: r.id, event_id: r.event_id, title: r.title, platform: r.platform, start: iso(r.start_at), end: iso(r.end_at),
    way: r.way, sources: (r.sources ?? []).map((s) => ({ way: s.way, received_at: s.received_at })), status: r.status,
    ...(r.status_reason ? { reason: r.status_reason } : {}), ...(r.updated_flag ? { updated: true } : {}),
    action_items_proposed: (r.action_items ?? []).filter((a) => a.state === 'proposed').length,
  };
  if (!full) return base;
  return {
    ...base, participants: r.participants ?? [], transcript: r.transcript ?? [], minutes: r.minutes,
    ...(r.minutes_offered ? { minutes_offered: r.minutes_offered } : {}), decisions: r.decisions ?? [], action_items: r.action_items ?? [],
  };
}

function lines(v: unknown): TranscriptLine[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20_000).map((x: any) => ({ t: text(x?.t), speaker: text(x?.speaker) || 'Unknown speaker', text: text(x?.text) })).filter((l) => l.text);
}

export async function runMeetingOp(
  clientNumber: string, userId: number, op: string, a: Args, confirmed: boolean, gate: { signatureVerified: boolean },
): Promise<Result> {
  if (op === 'meeting.attend' || op === 'meeting.leave') return fail('not_yet', 'joining as a participant (Way B) is not built yet');
  if (op === 'meeting.list') {
    const from = text(a.from) ? new Date(text(a.from)) : undefined;
    const to = text(a.to) ? new Date(text(a.to)) : undefined;
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
    if (derive && minutes) {
      const items = Array.isArray(a.action_items) ? (a.action_items as any[]).filter((x) => x && text(x.title)).map((x) => ({ title: text(x.title), ...(text(x.owner_name) ? { owner_name: text(x.owner_name) } : {}), ...(text(x.due) ? { due: text(x.due) } : {}) })) : [];
      await saveDerived(record.id, mergeDerived(record, { minutes, decisions: [], action_items: items }));
    }
    const after = await getRecord(clientNumber, userId, record.id);
    return { ok: true, item: toWire(after ?? record, false) };
  }
  return fail('unknown_op');
}
