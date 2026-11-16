/**
 * Wiki structure parts 11 and 13 (docs/Wiki-Knowledge.md §0.13): meeting transcripts, documents,
 * systems / KPIs / business units, company names, cross-conversation closing, and the daily upkeep.
 * Everything tested here is pure; the database paths are proven on production with throwaway rows.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

import { sourceFromRecord, transcriptText, seriesOf, meetingExtractions, type RecordRow } from '../src/services/wiki/wikiTranscripts';
import { buildNotes, type StoredItem } from '../src/services/wiki/wikiBuilder';
import { isDocument, buildDocumentNotes, attachmentPageText, attachmentSource, kindName } from '../src/services/wiki/wikiDocuments';
import { buildSystemNotes, dimensions, readingsText } from '../src/services/wiki/wikiSystems';
import { parseCompanyName } from '../src/services/wiki/wikiCompanyNames';
import { buildMeaningNotes } from '../src/services/wiki/wikiMeaning';
import { planUpkeep, type UpkeepNote } from '../src/services/wiki/wikiUpkeep';
import { prunedAndUnchanged, unchangedNote } from '../src/services/wiki/wikiSync';
import { extractWikiLinks } from '../src/services/wiki/wikiLinks';
const links = (b: string) => extractWikiLinks(b).map((x) => x.title);

const record = (o: Partial<RecordRow> = {}): RecordRow => ({
  id: 'rec1', client_number: 'T-1', user_id: 2, event_id: 'ser9_20261116T060000Z', title: 'PMS System Demo',
  start_at: new Date('2026-11-16T06:00:00Z'), end_at: new Date('2026-11-16T07:00:00Z'), way: 'google_transcript', status: 'record_ready',
  participants: [{ name: 'Fida Khan', email: 'Fida@acme.com' }, { name: 'Basit Ahmed', email: 'basit@acme.com' }],
  transcript: [{ t: '00:01', speaker: 'Fida Khan', text: 'We will ship the PMS pilot by Friday.' }],
  minutes: 'Pilot agreed. [[Not a link]]', decisions: ['Run the pilot at the Lahore plant'],
  action_items: [
    { id: 'a1', title: 'Send the pilot plan to the plant', owner_name: 'Fida', state: 'accepted', task_id: 'oi1' },
    { id: 'a2', title: 'Book the training room', owner_name: 'Basit Ahmed', state: 'proposed' },
    { id: 'a3', title: 'Order new scanners', owner_name: 'Someone Else', state: 'skipped' },
  ],
  updated_at: new Date('2026-11-16T08:00:00Z'), ...o,
});

describe('part 11: meeting transcripts', () => {
  it('a record with a transcript is one encrypted source, keyed by the record, in its calendar series', () => {
    const s = sourceFromRecord(record())!;
    expect(s.kind).toBe('transcript');
    expect(s.externalId).toBe('rec1');
    expect(s.encrypt).toBe(true);
    expect(s.threadKey).toBe('event:ser9');
    expect(s.body).toContain('Fida Khan: We will ship the PMS pilot by Friday.');
    expect(s.details.decisions).toEqual(['Run the pilot at the Lahore plant']);
    expect(s.details.actionItems.map((a: any) => a.state)).toEqual(['accepted', 'proposed', 'skipped']);
    expect(s.details.people[0].email).toBe('fida@acme.com');
  });

  it('no transcript yet: nothing lands', () => {
    expect(sourceFromRecord(record({ transcript: [] }))).toBeNull();
    expect(transcriptText([{ t: '', speaker: '', text: '' }])).toBe('');
    expect(seriesOf('abc_20261113T043000Z')).toBe('abc');
    expect(seriesOf(null)).toBeNull();
  });

  const tsrc = (o: Partial<RecordRow> = {}) => {
    const s = sourceFromRecord(record(o))!;
    return { id: `src_${o.id ?? 'rec1'}`, kind: 'transcript', title: s.title, occurredAt: s.occurredAt, threadKey: s.threadKey, clientNumber: 'T-1', userId: 2, scope: 'user', externalId: s.externalId, feedEventId: null, participants: s.participants, body: '', details: s.details } as any;
  };

  it('its decisions and action items become meaning items; his skip is dropped, his accept and the proposals are open', () => {
    const [m] = meetingExtractions([tsrc()], { ownEmails: new Set(['basit@acme.com']), userName: 'Basit Ahmed' });
    expect(m.conv.key).toBe('meeting:rec1');
    expect(m.ex.decisions.map((d) => d.what)).toEqual(['Run the pilot at the Lahore plant']);
    const [plan, room, scanners] = m.ex.commitments;
    expect(plan).toMatchObject({ owner: 'fida@acme.com', state: 'open', evidence: 'accepted by him from the meeting' });
    expect(room).toMatchObject({ owner: 'basit@acme.com', state: 'open', evidence: 'proposed from the meeting; not yet accepted' });
    expect(scanners).toMatchObject({ owner: null, state: 'dropped' });
    const notes = buildMeaningNotes([m as any], { personByEmail: new Map([['fida@acme.com', 'Fida Khan']]), now: new Date('2026-11-16T12:00:00Z'), ownEmails: new Set(['basit@acme.com']) });
    const c = notes.find((n) => n.type === 'commitment' && n.title.startsWith('Send the pilot plan'))!;
    expect(c.sourceIds).toEqual(['src_rec1']);
    expect(links(c.body)).toContain('Fida Khan');
    expect(notes.some((n) => n.type === 'decision' && n.title === 'Decision: Run the pilot at the Lahore plant')).toBe(true);
  });

  const at = (d: string) => new Date(`${d}T09:00:00+05:00`);
  const ctx = { userName: 'Basit Ahmed', userEmail: 'basit@acme.com', now: at('2026-11-17') };
  const cal: StoredItem = { id: 'c1', sourceType: 'gcal', at: at('2026-11-16'), payload: { title: 'PMS System Demo - Vision Metrics', eventId: 'ser9', start: '2026-11-16T11:00:00+05:00', attendees: ['basit@acme.com', 'fida@acme.com'], organizer: 'basit@acme.com' } };
  const tr = (o: Partial<RecordRow> = {}): StoredItem => { const s = tsrc(o); return { id: s.id, sourceType: 'meet_transcript', at: s.occurredAt, payload: { ...s.details, title: s.title } }; };

  it('the meeting note of its calendar series cites the transcript and shows the minutes, without reading them as links', () => {
    const notes = buildNotes([cal, tr()], ctx);
    const m = notes.find((n) => n.type === 'meeting')!;
    expect(m.title).toBe('PMS System Demo - Vision Metrics');
    expect(m.sourceIds).toEqual(expect.arrayContaining(['c1', 'src_rec1']));
    expect(m.body).toContain('## Meeting notes');
    expect(m.body).toContain('Pilot agreed. Not a link');
    expect(m.body).toContain('- Book the training room (Basit Ahmed) — proposed');
    expect(links(m.body)).not.toContain('Not a link');
    expect((m.properties as any).recorded).toBe(1);
  });

  it('a recorded meeting with no calendar entry is a meeting note of its own', () => {
    const notes = buildNotes([tr({ id: 'rec2', event_id: null, title: 'Quick call' })], ctx);
    const m = notes.find((n) => n.type === 'meeting')!;
    expect(m.title).toBe('Quick call');
    expect(m.sourceIds).toEqual(['src_rec2']);
  });
});

describe('part 11: documents', () => {
  const att = (id: string, day: string, from: string, o: Record<string, unknown> = {}) => ({
    id, kind: 'attachment', title: 'Design.pdf', occurredAt: new Date(`${day}T09:00:00Z`), threadKey: 't1', clientNumber: 'T-1', userId: 2, scope: 'user',
    externalId: `${id}:Design.pdf`, feedEventId: null, participants: [from], body: 'The design document for the PMS pilot. '.repeat(5),
    details: { filename: 'Design.pdf', mimeType: 'application/pdf', pageCount: 12, from, subject: 'The design', gmailMessageId: `g${id}`, ...o },
  }) as any;

  it('calendar invitations, images and near-empty text are not documents', () => {
    expect(isDocument({ filename: 'invite.ics', mimeType: 'text/calendar', text: 'x'.repeat(500) })).toBe(false);
    expect(isDocument({ filename: 'logo.png', mimeType: 'application/octet-stream', text: 'x'.repeat(500) })).toBe(false);
    expect(isDocument({ filename: 'a.pdf', mimeType: 'application/pdf', text: 'short' })).toBe(false);
    expect(isDocument({ filename: 'a.pdf', mimeType: 'application/pdf', text: 'x'.repeat(200) })).toBe(true);
    expect(kindName('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('Spreadsheet');
    expect(attachmentPageText('# a\n\n**MIME:** x\n\n## Extracted content\nHello there')).toBe('Hello there');
  });

  it('one attachment read twice is one source; the id is the email and the file', () => {
    const a = attachmentSource({ clientNumber: 'T-1', userId: 2, gmailMessageId: 'g1', filename: 'Design.pdf', mimeType: 'application/pdf', receivedAt: new Date(), text: 'x' });
    expect(a.externalId).toBe('g1:Design.pdf');
    expect(a.kind).toBe('attachment');
  });

  it('one note per document: versions newest first, sender and project linked, cites attachments and their emails', () => {
    const notes = buildDocumentNotes([att('a1', '2026-11-01', 'Fida <fida@acme.com>'), att('a2', '2026-11-10', 'basit@acme.com', { subject: 'v2 [[x]]' })], {
      personByEmail: new Map([['fida@acme.com', 'Fida Khan']]), emailIdByMessage: new Map([['ga1', 'e1'], ['ga2', 'e2']]),
      projectsByThread: new Map([['t1', ['PMS Pilot']]]), ownEmails: new Set(['basit@acme.com']),
    });
    expect(notes).toHaveLength(1);
    const d = notes[0];
    expect(d.type).toBe('document');
    expect(d.title).toBe('Design.pdf');
    expect(d.ids).toEqual(['document:design.pdf']);
    expect(d.body).toContain('**Latest from:** you on 2026-11-10');
    expect(links(d.body).sort()).toEqual(['Fida Khan', 'PMS Pilot']);
    expect(d.sourceIds!.sort()).toEqual(['a1', 'a2', 'e1', 'e2']);
    expect((d.properties as any).versions).toBe(2);
  });
});

describe('part 11: systems, KPIs and business units', () => {
  const integrations = [{ id: 'i1', name: 'TMC Employee Directory', purpose: 'Who works where', source_kind: 'sheet', status: 'PAUSED', frequency: 'DAILY', last_run_at: new Date('2026-11-12T09:00:00Z'), last_run_status: 'SUCCESS' }];
  const kpis = [{ id: 'k1', kpi_key: 'new_hires', name: 'New Hires by Business Unit', unit: 'count', direction: 'up', period: 'month', integration_id: 'i1', active: true }];
  const r = (p: string, u: string, v: number) => ({ kpi_key: 'new_hires', period_start: p, dimension_key: `businessUnit=${u}`, value: v, integration_id: 'i1', written_at: new Date('2026-11-12T09:00:00Z') });
  const readings = [r('2026-09-01', 'TMC Private Limited', 4), r('2026-10-01', 'TMC Private Limited', 6), r('2026-10-01', 'TMC Arabia', 1)];

  it('reads dimensions and writes readings as text', () => {
    expect(dimensions('businessUnit=TMC Arabia')).toEqual({ businessUnit: 'TMC Arabia' });
    expect(readingsText(kpis[0], readings).split('\n')[2]).toBe('2026-09-01,businessUnit=TMC Private Limited,4');
  });

  it('a system note, a KPI note with its latest figure and units, and a note per business unit, all linked and cited', () => {
    const notes = buildSystemNotes(integrations, kpis, readings, { sourceOf: () => 'src_k', taken: new Set(['tmc arabia']) });
    const sys = notes.find((n) => n.type === 'system')!;
    const kpi = notes.find((n) => n.type === 'kpi')!;
    const units = notes.filter((n) => n.type === 'business_unit').map((n) => n.title).sort();
    expect(sys.title).toBe('TMC Employee Directory');
    expect(sys.body).toContain('**State:** paused');
    expect(links(sys.body)).toEqual(['New Hires by Business Unit']);
    expect(kpi.body).toContain('**Latest:** 2026-10-01: 7');
    expect((kpi.properties as any).latestValue).toBe(7);
    expect(links(kpi.body)).toEqual(expect.arrayContaining(['TMC Employee Directory', 'TMC Private Limited', 'TMC Arabia (business unit)']));
    // A business unit whose name another note already has gets its kind in its title.
    expect(units).toEqual(['TMC Arabia (business unit)', 'TMC Private Limited']);
    expect(notes.every((n) => (n.sourceIds ?? []).includes('src_k'))).toBe(true);
    expect(kpi.ids).toEqual(['kpi:new_hires']);
  });
});

describe('company names', () => {
  it('takes a name only when the model is sure, and never the domain or an address', () => {
    expect(parseCompanyName('{"name":"Sapphire Textile Mills","sure":true}', 'sapphire.com.pk')).toBe('Sapphire Textile Mills');
    expect(parseCompanyName('{"name":"Sapphire","sure":false}', 'sapphire.com.pk')).toBeNull();
    expect(parseCompanyName('{"name":"sapphire","sure":true}', 'sapphire.com.pk')).toBeNull();
    expect(parseCompanyName('{"name":"www.x.com","sure":true}', 'x.com')).toBeNull();
    expect(parseCompanyName('not json', 'x.com')).toBeNull();
  });

  it('a named company is titled by its name, keeps its domain as an alias and identity, and people link to the name', () => {
    const at = new Date('2026-11-10T09:00:00Z');
    const items: StoredItem[] = [
      { id: 'm1', sourceType: 'gmail', at, payload: { threadId: 't1', subject: 'Hi', from: 'Ali Khan <ali@sapphire.com.pk>', to: 'basit@acme.com' } },
      { id: 'm2', sourceType: 'gmail', at, payload: { threadId: 't1', subject: 'Re: Hi', from: 'basit@acme.com', to: 'ali@sapphire.com.pk', labels: ['SENT'] } },
    ];
    const notes = buildNotes(items, { userName: 'Basit Ahmed', userEmail: 'basit@acme.com', now: new Date('2026-11-12'), companyNames: new Map([['sapphire.com.pk', 'Sapphire Textile Mills']]) });
    const c = notes.find((n) => n.type === 'company')!;
    expect(c.title).toBe('Sapphire Textile Mills');
    expect(c.aliases).toEqual(['sapphire.com.pk']);
    expect(c.ids).toEqual(['domain:sapphire.com.pk']);
    expect(notes.find((n) => n.type === 'person')!.body).toContain('**Company:** [[Sapphire Textile Mills]]');
    // Not named: the domain, as before.
    expect(buildNotes(items, { userName: 'Basit Ahmed', userEmail: 'basit@acme.com', now: new Date('2026-11-12') }).find((n) => n.type === 'company')!.title).toBe('sapphire.com.pk');
  });
});

describe('cross-conversation closing', () => {
  const s = (id: string, thread: string, day: string) => ({ id, kind: 'email', title: thread, occurredAt: new Date(`${day}T09:00:00Z`), threadKey: thread, clientNumber: 'T-1', userId: 2, scope: 'user', externalId: id, feedEventId: null, participants: [], body: '', details: {} }) as any;
  const conv = (key: string, day: string) => ({ key, subject: key, sources: [s(`${key}1`, key, day)], last: new Date(`${day}T09:00:00Z`) });
  const ex = (c: any) => ({ projects: [], topics: [], decisions: [], commitments: [c] });
  const ctx = { personByEmail: new Map([['fida@acme.com', 'Fida Khan']]), now: new Date('2026-11-13T12:00:00Z'), ownEmails: new Set(['basit@acme.com']) };

  it('a later conversation saying the task was done closes it, citing both', () => {
    const notes = buildMeaningNotes([
      { conv: conv('t1', '2026-11-01'), ex: ex({ what: 'Send the payroll sheet for October', owner: 'fida@acme.com', state: 'open' }) },
      { conv: conv('t2', '2026-11-08'), ex: ex({ what: 'Payroll sheet for October sent', owner: null, state: 'done', evidence: 'sent the sheet' }) },
    ] as any, ctx).filter((n) => n.type === 'commitment');
    expect(notes).toHaveLength(1);
    expect((notes[0].properties as any).state).toBe('done');
    expect((notes[0].properties as any).closedIn).toBe('t2');
    expect(notes[0].body).toContain('said in a later conversation');
    expect(notes[0].sourceIds!.sort()).toEqual(['t11', 't21']);
  });

  it('his word keeps it open, and a different task is not closed', () => {
    const kept = buildMeaningNotes([
      { conv: conv('t1', '2026-11-01'), ex: ex({ what: 'Send the payroll sheet for October', owner: 'basit@acme.com', state: 'open' }) },
      { conv: conv('t2', '2026-11-08'), ex: ex({ what: 'Payroll sheet for October sent', owner: null, state: 'done' }) },
    ] as any, { ...ctx, rulings: [{ itemId: 'o1', thread: 't1', title: 'Send the payroll sheet for October', kind: 'mine' }] }).filter((n) => n.type === 'commitment');
    expect(kept.find((n) => n.title.startsWith('Send the payroll'))!.properties).toMatchObject({ state: 'open', ruledBy: 'him' });
    const other = buildMeaningNotes([
      { conv: conv('t1', '2026-11-01'), ex: ex({ what: 'Send the payroll sheet for October', owner: 'fida@acme.com', state: 'open' }) },
      { conv: conv('t2', '2026-11-08'), ex: ex({ what: 'Book the venue for the dinner', owner: null, state: 'done' }) },
    ] as any, ctx).filter((n) => n.type === 'commitment');
    expect(other).toHaveLength(2);
  });
});

describe('part 13: upkeep', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const note = (o: Partial<UpkeepNote>): UpkeepNote => ({
    id: o.id ?? 'n', type: 'person', title: o.title ?? o.id ?? 'n', status: 'active', scope: 'user', body: 'Some text about this person.',
    metadata: { properties: { emails: ['x@y.com'] }, rev: 3 }, lastUpdatedBy: 'wiki_builder', inbound: 1, outbound: 1, sources: 2,
    newestSource: daysAgo(5), openCommitment: false, ...o,
  });
  const cfg = { now, orphanDays: 30, staleDays: 90 };

  it('archives an orphan and an empty note; marks the stale; never touches what is protected', () => {
    const plan = planUpkeep([
      note({ id: 'orphan', inbound: 0, outbound: 0, sources: 1, newestSource: daysAgo(40) }),
      note({ id: 'young-orphan', inbound: 0, outbound: 0, sources: 1, newestSource: daysAgo(10) }),
      note({ id: 'empty', body: '', metadata: { rev: 1 }, sources: 0, inbound: 0, outbound: 0, newestSource: null }),
      note({ id: 'stale', newestSource: daysAgo(120) }),
      note({ id: 'fresh-again', metadata: { properties: { a: 1 }, upkeep: { stale: true } } }),
      note({ id: 'his', lastUpdatedBy: 'user:2', inbound: 0, outbound: 0, sources: 1, newestSource: daysAgo(400) }),
      note({ id: 'open', openCommitment: true, newestSource: daysAgo(400) }),
      note({ id: 'shared', scope: 'tenant', inbound: 0, outbound: 0, sources: 0, newestSource: null }),
      note({ id: 'rule', type: 'rule', inbound: 0, outbound: 0, sources: 0, newestSource: null }),
      note({ id: 'commitment', type: 'commitment', inbound: 0, outbound: 0, sources: 1, newestSource: daysAgo(400) }),
    ], cfg);
    expect(plan.archive).toEqual([{ id: 'orphan', title: 'orphan', reason: 'orphan' }, { id: 'empty', title: 'empty', reason: 'empty' }]);
    expect(plan.stale.map((x) => x.id)).toEqual(['stale']);
    expect(plan.fresh.map((x) => x.id)).toEqual(['fresh-again']);
  });

  it('lists, never merges: a shared phone, a possible same person, two readings of one task that disagree', () => {
    const plan = planUpkeep([
      note({ id: 'a', title: 'Ali Khan', metadata: { properties: { phone: '+92 300 1234567' } } }),
      note({ id: 'b', title: 'Ali K', metadata: { properties: { phone: '+923001234567' } }, body: '**Possibly the same person:** [[Ali Khan]]' }),
      note({ id: 'c1', type: 'commitment', title: 'Send the October payroll sheet (Fida)', metadata: { properties: { conversation: 't1', state: 'open', what: 'Send the October payroll sheet' } } }),
      note({ id: 'c2', type: 'commitment', title: 'Send the October payroll sheet (unknown)', metadata: { properties: { conversation: 't1', state: 'done', what: 'Send the October payroll sheet' } } }),
    ], cfg);
    expect(plan.samePhone).toEqual([{ phone: '+923001234567', notes: ['Ali K', 'Ali Khan'] }]);
    expect(plan.possiblySame).toEqual([{ note: 'Ali K', others: ['Ali Khan'] }]);
    expect(plan.contradictions).toHaveLength(1);
    expect(plan.archive).toEqual([]);
  });

  it('a note written again after it was archived has its archive mark cleared', () => {
    const plan = planUpkeep([note({ id: 'back', metadata: { properties: { a: 1 }, upkeep: { archived: 'orphan' } } })], cfg);
    expect(plan.restored.map((x) => x.id)).toEqual(['back']);
  });

  it('the builders leave an archived note archived until they have something new to say of it', () => {
    const archived = { status: 'archived', bodyMarkdown: 'text', metadata: { upkeep: { archived: 'orphan' } } };
    expect(prunedAndUnchanged(archived, 'text')).toBe(true);
    expect(prunedAndUnchanged(archived, 'new text')).toBe(false);
    expect(prunedAndUnchanged({ ...archived, metadata: {} }, 'text')).toBe(false);
    expect(unchangedNote({ status: 'active', bodyMarkdown: 'x', metadata: { wiki: 2, rev: 1 } }, 'x')).toBe(true);
    expect(unchangedNote({ status: 'active', bodyMarkdown: 'x', metadata: { wiki: 2, rev: 1, unresolvedLinks: ['y'] } }, 'x')).toBe(false);
  });
});

describe('fixes found on the first production run (16 Nov)', () => {
  it('an unchanged record is seen as unchanged whatever order the database keeps its keys in', async () => {
    const { stableJson } = await import('../src/services/wiki/wikiTranscripts');
    expect(stableJson({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(stableJson({ a: [{ x: 1, y: 2 }], b: 1 }));
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 2 }));
  });

  it('one name, one company: a name read for two domains goes to the company with more people', () => {
    const at = new Date('2026-11-10T09:00:00Z');
    const m = (id: string, from: string, thread: string): StoredItem => ({ id, sourceType: 'gmail', at, payload: { threadId: thread, subject: 'x', from, to: 'basit@acme.com' } });
    const sent = (id: string, to: string, thread: string): StoredItem => ({ id, sourceType: 'gmail', at, payload: { threadId: thread, subject: 'x', from: 'basit@acme.com', to, labels: ['SENT'] } });
    const items = [m('1', 'ali@tmc.com', 't1'), sent('2', 'ali@tmc.com', 't1'), m('3', 'sara@tmc.com', 't2'), sent('4', 'sara@tmc.com', 't2'), m('5', 'omar@sister.com', 't3'), sent('6', 'omar@sister.com', 't3')];
    const notes = buildNotes(items, { userName: 'Basit Ahmed', userEmail: 'basit@acme.com', now: new Date('2026-11-12'), companyNames: new Map([['tmc.com', 'TMC'], ['sister.com', 'TMC']]) });
    expect(notes.filter((n) => n.type === 'company').map((n) => n.title).sort()).toEqual(['TMC', 'sister.com']);
    expect(notes.find((n) => n.title === 'sister.com')!.aliases).toBeUndefined();
  });
});

describe('company names read from the writer\'s own words', () => {
  it('quoted earlier messages are cut before the model reads an email', async () => {
    const { ownPart } = await import('../src/services/wiki/wikiCompanyNames');
    expect(ownPart('How do I log in?\nAli Safdar Raja\nKnowledge Streams\n\nOn Tue, Oct 27, 2026 at 11:02 AM Vision Metric <vm@tmcltd.com> wrote:\nDear Ali')).toBe('How do I log in?\nAli Safdar Raja\nKnowledge Streams');
    expect(ownPart('Thanks\n-----Original Message-----\nFrom: x')).toBe('Thanks');
    expect(ownPart('No quote here')).toBe('No quote here');
  });
});
