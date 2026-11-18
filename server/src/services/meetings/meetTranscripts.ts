/**
 * F-4 Way A (Functional Charter, agreed 12 Nov 2026): Google Meet's own transcript, read with each speaker's name.
 *
 * Nobody joins the call. Way A covers only meetings the user HOSTS on a Google account connected to Nexeo; any other
 * meeting is `not_covered` for him and nothing is attempted. Arrival is by Workspace Events (meetEvents.ts) and by a
 * polling fallback ~15 minutes after each hosted event ends (meetPoller.ts), because Google's entries can be
 * incomplete right after `fileGenerated`: a record is read again once, later.
 */
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../integrationService';
import type { Participant, TranscriptLine } from './meetingRecordStore';

export const MEET_LINK = /meet\.google\.com\/([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})/i;
export const meetingCodeOf = (link?: string | null): string | null => (link ? link.match(MEET_LINK)?.[1]?.toLowerCase() ?? null : null);

export async function meetFor(userId: number): Promise<any | null> {
  const { client } = await getAuthenticatedClient(userId);
  return client ? google.meet({ version: 'v2', auth: client }) : null;
}

/** The conference records of one meeting code around a time (a recurring link has one per occurrence). */
export async function conferencesFor(meet: any, code: string, start: Date, end: Date): Promise<Array<{ name: string; space: string; startTime: string; endTime?: string }>> {
  const from = new Date(start.getTime() - 60 * 60_000).toISOString();
  const to = new Date(end.getTime() + 3 * 60 * 60_000).toISOString();
  const r = await meet.conferenceRecords.list({ filter: `space.meeting_code = "${code}" AND start_time >= "${from}" AND start_time <= "${to}"`, pageSize: 10 });
  return (r.data.conferenceRecords ?? []).map((c: any) => ({ name: c.name, space: c.space, startTime: c.startTime, endTime: c.endTime }));
}

/** His conferences that ended since a time: the way an instant Meet (no calendar event) is found by the poller. */
export async function recentConferences(meet: any, since: Date): Promise<Array<{ name: string; space: string; startTime: string; endTime?: string }>> {
  const out: Array<{ name: string; space: string; startTime: string; endTime?: string }> = [];
  let pageToken: string | undefined;
  do {
    const r = await meet.conferenceRecords.list({ filter: `end_time >= "${since.toISOString()}"`, pageSize: 50, pageToken });
    for (const c of r.data.conferenceRecords ?? []) out.push({ name: c.name, space: c.space, startTime: c.startTime, endTime: c.endTime ?? undefined });
    pageToken = r.data.nextPageToken ?? undefined;
  } while (pageToken && out.length < 200);
  return out;
}

export async function conference(meet: any, name: string): Promise<{ name: string; space: string; startTime: string; endTime?: string } | null> {
  const r = await meet.conferenceRecords.get({ name }).catch(() => null);
  return r?.data ? { name: r.data.name, space: r.data.space, startTime: r.data.startTime, endTime: r.data.endTime } : null;
}

const shownName = (p: any): string =>
  String(p?.signedinUser?.displayName ?? p?.anonymousUser?.displayName ?? p?.phoneUser?.displayName ?? '').trim();

/**
 * The transcript of one conference: its state and lines with the speaker's real name. `state` is Google's
 * (STARTED, ENDED, FILE_GENERATED); lines are read whenever entries exist.
 */
export async function readTranscript(meet: any, conferenceName: string, opts: { userId?: number } = {}): Promise<{
  transcriptName: string | null; state: string | null; lines: TranscriptLine[]; participants: Participant[]; minutes: number;
  textFrom?: 'google_doc' | 'google_entries';
}> {
  const ts = await meet.conferenceRecords.transcripts.list({ parent: conferenceName });
  const transcript = (ts.data.transcripts ?? [])[0] ?? null;
  const people = new Map<string, string>();
  let pageToken: string | undefined;
  do {
    const p = await meet.conferenceRecords.participants.list({ parent: conferenceName, pageSize: 100, pageToken });
    for (const x of p.data.participants ?? []) if (x.name) people.set(x.name, shownName(x) || 'Unknown speaker');
    pageToken = p.data.nextPageToken ?? undefined;
  } while (pageToken);
  const participants: Participant[] = [...new Set(people.values())].filter((n) => n !== 'Unknown speaker').map((name) => ({ name }));
  if (!transcript) return { transcriptName: null, state: null, lines: [], participants, minutes: 0 };
  const lines: TranscriptLine[] = [];
  let tok: string | undefined;
  do {
    const e = await meet.conferenceRecords.transcripts.entries.list({ parent: transcript.name, pageSize: 100, pageToken: tok });
    for (const x of e.data.transcriptEntries ?? []) {
      const text = String(x.text ?? '').trim();
      if (!text) continue;
      lines.push({ t: String(x.startTime ?? ''), speaker: people.get(String(x.participant)) ?? 'Unknown speaker', text });
    }
    tok = e.data.nextPageToken ?? undefined;
  } while (tok && lines.length < 20_000);
  const first = lines[0]?.t ? Date.parse(lines[0].t) : NaN;
  const last = lines[lines.length - 1]?.t ? Date.parse(lines[lines.length - 1].t) : NaN;
  const minutes = Number.isFinite(first) && Number.isFinite(last) ? Math.max(1, Math.round((last - first) / 60_000)) : 0;
  // T39 (founder 18 Nov: "the transcript Google made is one thing, the one you show me another"): Google's transcript
  // document is the text he reads in Google; the API's entries are a rougher copy (PMS Demo: 1,063 words in entries,
  // 1,112 in the document). Once the document exists (FILE_GENERATED), its text wins; times come from the entries.
  const docId = transcript.docsDestination?.document;
  if (opts.userId && docId && transcript.state === 'FILE_GENERATED') {
    const text = await docText(opts.userId, String(docId)).catch(() => null);
    const doc = text ? alignDoc(parseTranscriptDoc(text), lines, String(transcript.startTime ?? lines[0]?.t ?? '')) : [];
    if (doc.length) return { transcriptName: transcript.name, state: transcript.state ?? null, lines: doc, participants, minutes, textFrom: 'google_doc' };
  }
  return { transcriptName: transcript.name, state: transcript.state ?? null, lines, participants, minutes, textFrom: 'google_entries' };
}

/** Google's transcript document as plain text (Drive export), with his own token. Null when it can't be read. */
async function docText(userId: number, docId: string): Promise<string | null> {
  const { client } = await getAuthenticatedClient(userId);
  if (!client) return null;
  const drive = google.drive({ version: 'v3', auth: client as any });
  const r = await drive.files.export({ fileId: docId, mimeType: 'text/plain' }, { responseType: 'text' });
  return typeof r.data === 'string' ? r.data : String(r.data ?? '');
}

const STAMP = /^\s*(\d{1,2}):(\d{2}):(\d{2})\s*$/;
const ENDED = /^\s*transcription ended after\s+(\d{1,2}):(\d{2}):(\d{2})/i;
const SPOKEN = /^([^:\n]{1,80}?):\s?(.*)$/;

/**
 * T39: the lines of Google's transcript document, word for word: after the "Transcript" heading, "Speaker: text"
 * lines, with an elapsed-time stamp (hh:mm:ss) every few minutes, ending with "Transcription ended after …".
 * Nothing is reworded; a speaker line with no text is kept out. A line with no "Name:" continues the line before.
 */
export function parseTranscriptDoc(text: string): Array<{ speaker: string; text: string; offsetMs: number }> {
  const raw = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const start = raw.findIndex((l) => /^\s*transcript\s*$/i.test(l));
  const body = start >= 0 ? raw.slice(start + 1) : raw;
  const out: Array<{ speaker: string; text: string; offsetMs: number }> = [];
  let offset = 0;
  for (const l of body) {
    if (!l.trim()) continue;
    if (ENDED.test(l)) break;
    const st = STAMP.exec(l);
    if (st) { offset = ((+st[1] * 60 + +st[2]) * 60 + +st[3]) * 1000; continue; }
    const m = SPOKEN.exec(l);
    if (m && m[1].trim() && !/^https?$/i.test(m[1].trim()) && !/[\/]|\d{4}/.test(m[1])) {
      const said = m[2].trim();
      if (said) out.push({ speaker: m[1].trim(), text: said, offsetMs: offset });
    } else if (out.length) {
      out[out.length - 1].text = `${out[out.length - 1].text} ${l.trim()}`;
    }
  }
  return out;
}

/**
 * Each document line takes the time of its speaker's next API entry at or after the line's stamp (so the times are
 * Google's own); with no such entry, the stamp itself. Times never go backwards.
 */
export function alignDoc(doc: Array<{ speaker: string; text: string; offsetMs: number }>, entries: TranscriptLine[], startIso: string): TranscriptLine[] {
  const start = Date.parse(startIso);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  let i = 0; let lastMs = -Infinity;
  const out: TranscriptLine[] = [];
  for (const d of doc) {
    const floor = Number.isFinite(start) ? start + d.offsetMs : NaN;
    let j = i;
    while (j < entries.length && !(norm(entries[j].speaker) === norm(d.speaker) && (!Number.isFinite(floor) || Date.parse(entries[j].t) >= floor - 60_000))) j++;
    let ms: number;
    if (j < entries.length) { ms = Date.parse(entries[j].t); i = j + 1; } else ms = floor;
    if (!Number.isFinite(ms)) ms = Number.isFinite(lastMs) ? lastMs : 0;
    if (ms < lastMs) ms = lastMs;
    lastMs = ms;
    out.push({ t: new Date(ms).toISOString(), speaker: d.speaker, text: d.text });
  }
  return out;
}
