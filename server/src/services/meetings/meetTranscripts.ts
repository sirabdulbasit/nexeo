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
export async function readTranscript(meet: any, conferenceName: string): Promise<{
  transcriptName: string | null; state: string | null; lines: TranscriptLine[]; participants: Participant[]; minutes: number;
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
  return { transcriptName: transcript.name, state: transcript.state ?? null, lines, participants, minutes };
}
