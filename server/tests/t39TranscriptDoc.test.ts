/**
 * T39 (founder 18 Nov 2026: "the transcript Google itself made is one thing, the one you show me another"). Pinned:
 *  PARSE   Google's transcript document is read word for word: lines after the "Transcript" heading, "Speaker: text",
 *          elapsed stamps skipped, a line with no "Name:" joins the line before, stops at "Transcription ended after";
 *          the title line (a date with a colon) is never a speaker;
 *  ALIGN   each line takes its speaker's next API entry time at or after its stamp; times never go backwards;
 *  READ    once FILE_GENERATED, the document's text wins (textFrom google_doc); without a document, or when it can't be
 *          read, the API entries stand (google_entries).
 */
import { describe, it, expect, vi } from 'vitest';

const exported = { text: '' as string | null };
vi.mock('googleapis', () => ({
  google: {
    drive: () => ({ files: { export: async () => { if (exported.text === null) throw new Error('403'); return { data: exported.text }; } } }),
    meet: () => ({}),
  },
}));
vi.mock('../src/services/integrationService', () => ({ getAuthenticatedClient: async () => ({ client: {} }) }));

import { parseTranscriptDoc, alignDoc, readTranscript } from '../src/services/meetings/meetTranscripts';

const DOC = [
  '﻿PMS System Demo - Vision Metrics - 2026/11/16 11:01 PKT - Transcript',
  'Attendees',
  'Basit Ahmed, Sofia Rana, Ali Raza',
  'Transcript',
  'Sofia Rana: Good morning everyone. Shall we start?',
  'Basit Ahmed: Yes please.',
  'the second half of a long line',
  '00:05:00',
  'Ali Raza: The dashboard loads in 2 seconds.',
  'Sofia Rana: ',
  'Transcription ended after 00:56:34',
  'This editable transcript was computer generated and might contain errors.',
].join('\n');

describe('PARSE', () => {
  it('word for word, stamps skipped, continuation joined, footer and title never lines', () => {
    expect(parseTranscriptDoc(DOC)).toEqual([
      { speaker: 'Sofia Rana', text: 'Good morning everyone. Shall we start?', offsetMs: 0 },
      { speaker: 'Basit Ahmed', text: 'Yes please. the second half of a long line', offsetMs: 0 },
      { speaker: 'Ali Raza', text: 'The dashboard loads in 2 seconds.', offsetMs: 300_000 },
    ]);
  });
  it('a document with no heading still never takes the title line as a speaker', () => {
    expect(parseTranscriptDoc(DOC.replace('\nTranscript\n', '\n')).map((l) => l.speaker)).toEqual(['Sofia Rana', 'Basit Ahmed', 'Ali Raza']);
  });
});

describe('ALIGN', () => {
  it("the speaker's next entry time at or after the stamp; never backwards", () => {
    const entries = [
      { t: '2026-11-16T06:01:47.000Z', speaker: 'Sofia Rana', text: 'Good morning' },
      { t: '2026-11-16T06:01:52.000Z', speaker: 'Sofia Rana', text: 'everyone' },
      { t: '2026-11-16T06:02:00.000Z', speaker: 'Basit Ahmed', text: 'Yes' },
      { t: '2026-11-16T06:06:30.000Z', speaker: 'Ali Raza', text: 'The dashboard' },
    ];
    const out = alignDoc(parseTranscriptDoc(DOC), entries, '2026-11-16T06:01:17.000Z');
    expect(out.map((l) => l.t)).toEqual(['2026-11-16T06:01:47.000Z', '2026-11-16T06:02:00.000Z', '2026-11-16T06:06:30.000Z']);
    const noEntries = alignDoc(parseTranscriptDoc(DOC), [], '2026-11-16T06:01:17.000Z');
    expect(noEntries.map((l) => l.t)).toEqual(['2026-11-16T06:01:17.000Z', '2026-11-16T06:01:17.000Z', '2026-11-16T06:06:17.000Z']);
  });
});

describe('READ', () => {
  const meet = (state: string, doc?: string) => ({
    conferenceRecords: {
      transcripts: {
        list: async () => ({ data: { transcripts: [{ name: 'tr/1', state, startTime: '2026-11-16T06:01:17Z', ...(doc ? { docsDestination: { document: doc } } : {}) }] } }),
        entries: { list: async () => ({ data: { transcriptEntries: [{ startTime: '2026-11-16T06:01:47Z', participant: 'p/1', text: 'Good morning' }] } }) },
      },
      participants: { list: async () => ({ data: { participants: [{ name: 'p/1', signedinUser: { displayName: 'Sofia Rana' } }] } }) },
    },
  });
  it('the document wins once generated', async () => {
    exported.text = DOC;
    const r = await readTranscript(meet('FILE_GENERATED', 'doc1'), 'conf', { userId: 2 });
    expect(r.textFrom).toBe('google_doc');
    expect(r.lines.map((l) => l.text)).toEqual(['Good morning everyone. Shall we start?', 'Yes please. the second half of a long line', 'The dashboard loads in 2 seconds.']);
  });
  it('no document, not generated yet, no user or an unreadable document: the entries stand', async () => {
    exported.text = DOC;
    expect((await readTranscript(meet('FILE_GENERATED'), 'conf', { userId: 2 })).textFrom).toBe('google_entries');
    expect((await readTranscript(meet('ENDED', 'doc1'), 'conf', { userId: 2 })).textFrom).toBe('google_entries');
    expect((await readTranscript(meet('FILE_GENERATED', 'doc1'), 'conf')).textFrom).toBe('google_entries');
    exported.text = null;
    const r = await readTranscript(meet('FILE_GENERATED', 'doc1'), 'conf', { userId: 2 });
    expect(r).toMatchObject({ textFrom: 'google_entries', lines: [{ speaker: 'Sofia Rana', text: 'Good morning' }] });
  });
});
