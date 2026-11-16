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
    expect(a.externalId).toMatch(/^g1:Design\.pdf:[0-9a-f]{12}$/);
    // Two attachments of one name in one email, with different content, are two sources.
    const b = attachmentSource({ clientNumber: 'T-1', userId: 2, gmailMessageId: 'g1', filename: 'Design.pdf', mimeType: 'application/pdf', receivedAt: new Date(), text: 'y' });
    expect(b.externalId).not.toBe(a.externalId);
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
    expect(d.ids).toEqual(['document:design.pdf:a1:Design.pdf']);
    expect(d.body).toContain('**Latest from:** you on 2026-11-10');
    expect(links(d.body).sort()).toEqual(['Fida Khan', 'PMS Pilot']);
    expect(d.sourceIds!.sort()).toEqual(['a1', 'a2', 'e1', 'e2']);
    expect((d.properties as any).versions).toBe(2);
  });
});

describe('documents: a file name is a label, not an identity (review 16 Nov, P1)', () => {
  const inv = (id: string, from: string, thread: string, day: string, ref = `INV-${id}00`) => ({
    id, kind: 'attachment', title: 'Invoice.pdf', occurredAt: new Date(`${day}T09:00:00Z`), threadKey: thread, clientNumber: 'T-1', userId: 2, scope: 'user',
    externalId: `${id}:Invoice.pdf`, feedEventId: null, participants: [from], body: `Invoice No: ${ref}\nInvoice for services rendered in the month. `.repeat(3),
    details: { filename: 'Invoice.pdf', mimeType: 'application/pdf', from, gmailMessageId: `g${id}` },
  }) as any;
  const ctx = { personByEmail: new Map([['ali@a.com', 'Ali Khan'], ['sara@b.com', 'Sara Malik']]), emailIdByMessage: new Map(), projectsByThread: new Map(), ownEmails: new Set(['basit@acme.com']) };

  it('two unrelated invoices with one name are two documents, told apart by who sent them', () => {
    const notes = buildDocumentNotes([inv('a', 'ali@a.com', 't1', '2026-11-01'), inv('b', 'sara@b.com', 't2', '2026-11-03')], ctx);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.title).sort()).toEqual(['Invoice.pdf (from Ali Khan)', 'Invoice.pdf (from Sara Malik)']);
    expect(notes.every((n) => (n.properties as any).versions === 1)).toBe(true);
    expect(new Set(notes.map((n) => n.ids![0])).size).toBe(2);
  });

  it('two invoices from one vendor in two purchases stay two documents (review 16 Nov, second P1)', () => {
    const notes = buildDocumentNotes([inv('a', 'ali@a.com', 'purchase-1', '2026-11-01', 'INV-001'), inv('c', 'ali@a.com', 'purchase-2', '2026-11-20', 'INV-002')], ctx);
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((n) => n.title)).size).toBe(2);
    // Even in one conversation: two reference numbers are two invoices.
    expect(buildDocumentNotes([inv('a', 'ali@a.com', 't1', '2026-11-01', 'INV-001'), inv('c', 'ali@a.com', 't1', '2026-11-20', 'INV-002')], ctx)).toHaveLength(2);
  });

  it('a genuine revision is one document with its trail when the model says so: the same invoice again, or a revised draft', () => {
    const yes = { verdict: () => true, pending: [] as any[] };
    const again = buildDocumentNotes([inv('a', 'ali@a.com', 't1', '2026-11-01', 'INV-001'), { ...inv('c', 'ali@a.com', 't9', '2026-11-20', 'INV-001'), body: 'Invoice No: INV-001\nRevised: corrected amount for the services rendered in October, replacing the earlier copy.' }], { ...ctx, same: yes });
    expect(again).toHaveLength(1);
    expect((again[0].properties as any).versions).toBe(2);
    expect(again[0].ids).toEqual(['document:invoice.pdf:a:Invoice.pdf']);
    const design = (id: string, body: string) => ({ ...inv(id, 'ali@a.com', 't1', '2026-11-01'), body, details: { filename: 'Invoice.pdf', mimeType: 'application/pdf', from: 'ali@a.com', gmailMessageId: `g${id}` } });
    expect(buildDocumentNotes([design('a', 'Draft terms of the engagement. '.repeat(4)), design('b', 'Final terms of the engagement, signed. '.repeat(4))], { ...ctx, same: yes })).toHaveLength(1);
  });

  it('third P1: two vendors that both number an invoice INV-001 are two documents, and are never even put to the model', () => {
    const asking = { verdict: () => true, pending: [] as any[] };
    const notes = buildDocumentNotes([inv('a', 'ali@a.com', 'purchase-a', '2026-11-01', 'INV-001'), inv('b', 'sara@b.com', 'purchase-b', '2026-11-03', 'INV-001')], { ...ctx, same: asking });
    expect(notes).toHaveLength(2);
    expect(asking.pending).toHaveLength(0);
  });

  it('class: with no answer from the model nothing but identical content is one document; the pair is put to the model', () => {
    const cases: any[][] = [
      [inv('a', 'ali@a.com', 't1', '2026-11-01', 'INV-001'), inv('c', 'ali@a.com', 't1', '2026-11-20', 'INV-002')], // one vendor, one thread, two numbers
      [inv('a', 'ali@a.com', 't1', '2026-11-01', 'INV-001'), { ...inv('c', 'ali@a.com', 't2', '2026-11-20', 'INV-001'), body: 'Invoice No: INV-001\nA different month of services rendered, on the same template as before, for another period.' }], // same number, other text
      [inv('a', 'ali@a.com', 't1', '2026-11-01', 'INV-001'), { ...inv('c', 'sara@b.com', 't1', '2026-11-02', 'INV-001'), body: 'Invoice No: INV-001\nIssued by another organisation in the same conversation, for its own services and amounts.' }], // two senders in one thread
    ];
    for (const pair of cases) {
      const asking = { verdict: () => undefined, pending: [] as any[] };
      expect(buildDocumentNotes(pair, { ...ctx, same: asking })).toHaveLength(2);
      expect(buildDocumentNotes(pair, ctx)).toHaveLength(2);
      expect(asking.pending).toHaveLength(1);
      expect(asking.pending[0].anchor).toBe('c');
      expect(buildDocumentNotes(pair, { ...ctx, same: { verdict: () => false, pending: [] } })).toHaveLength(2);
    }
    // The same file sent again is the same document with no model at all.
    const same = buildDocumentNotes([inv('a', 'ali@a.com', 't1', '2026-11-01', 'INV-001'), inv('c', 'ali@a.com', 't7', '2026-11-20', 'INV-001')].map((x, i) => ({ ...x, body: 'Invoice No: INV-001\nIdentical content of one invoice file, sent twice by the vendor.' })), ctx);
    expect(same).toHaveLength(1);
    expect((same[0].properties as any).versions).toBe(2);
    // The same text with another file size is not known to be the same file: it is put to the model.
    const sized = [inv('a', 'ali@a.com', 't1', '2026-11-01'), inv('c', 'ali@a.com', 't1', '2026-11-20')].map((x, i) => ({ ...x, body: 'Scanned page. '.repeat(10), details: { ...x.details, size: 1000 + i } }));
    const asking = { verdict: () => undefined, pending: [] as any[] };
    expect(buildDocumentNotes(sized, { ...ctx, same: asking })).toHaveLength(2);
    expect(asking.pending).toHaveLength(1);
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
  const s = (id: string, thread: string, day: string, people: string[]) => ({ id, kind: 'email', title: thread, occurredAt: new Date(`${day}T09:00:00Z`), threadKey: thread, clientNumber: 'T-1', userId: 2, scope: 'user', externalId: id, feedEventId: null, participants: people, body: '', details: {} }) as any;
  const conv = (key: string, day: string, people: string[] = ['fida@acme.com']) => ({ key, subject: key, sources: [s(`${key}1`, key, day, people)], last: new Date(`${day}T09:00:00Z`) });
  const ex = (c: any, project = 'Payroll') => ({ projects: project ? [{ name: project, summary: '' }] : [], topics: [], decisions: [], commitments: [c] });
  const yes = { verdict: () => true, pending: [] as any[] };
  const no = { verdict: () => false, pending: [] as any[] };
  const ctx = { personByEmail: new Map([['fida@acme.com', 'Fida Khan']]), now: new Date('2026-11-13T12:00:00Z'), ownEmails: new Set(['basit@acme.com']), same: yes };

  it('a later conversation saying the task was done closes it (the model says it is that task), citing both', () => {
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

  it('the same words in another project never close it: flagged for him, kept open (review 16 Nov, P1)', () => {
    const notes = buildMeaningNotes([
      { conv: conv('alpha', '2026-11-01'), ex: ex({ what: 'Send the proposal', owner: 'fida@acme.com', state: 'open' }, 'Project Alpha') },
      { conv: conv('beta', '2026-11-08'), ex: ex({ what: 'Send the proposal', owner: null, state: 'done' }, 'Project Beta') },
    ] as any, ctx).filter((n) => n.type === 'commitment');
    expect(notes).toHaveLength(2);
    const alpha = notes.find((n) => (n.properties as any).conversation === 'alpha')!;
    // Another project: never even a candidate, whatever the model would say.
    expect((alpha.properties as any).state).toBe('open');
    expect((alpha.properties as any).possiblyDoneIn).toBeUndefined();
    expect((alpha.properties as any).closedIn).toBeUndefined();
  });

  it('a candidate the model has not answered yet stays open and is flagged; one it says is different stays open, unflagged', () => {
    const items = [
      { conv: conv('t1', '2026-11-01'), ex: ex({ what: 'Send the payroll sheet for October', owner: 'fida@acme.com', state: 'open' }) },
      { conv: conv('t2', '2026-11-08'), ex: ex({ what: 'Payroll sheet for October sent', owner: null, state: 'done' }) },
    ] as any;
    const asking = { verdict: () => undefined, pending: [] as any[] };
    const waiting = buildMeaningNotes(items, { ...ctx, same: asking }).filter((n) => n.type === 'commitment');
    expect(waiting.find((n) => (n.properties as any).conversation === 't1')!.properties).toMatchObject({ state: 'open', possiblyDoneIn: 't2' });
    expect(asking.pending).toHaveLength(1);
    expect(asking.pending[0].anchor).toBe('t11');
    const refused = buildMeaningNotes(items, { ...ctx, same: no }).filter((n) => n.type === 'commitment');
    const t1 = refused.find((n) => (n.properties as any).conversation === 't1')!;
    expect((t1.properties as any).state).toBe('open');
    expect((t1.properties as any).possiblyDoneIn).toBeUndefined();
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
    const n = { type: 'person', title: 'x', body: 'text', properties: { a: 1 }, ids: ['email:x@y.com'], sourceIds: ['s1'] };
    const archived = { status: 'archived', bodyMarkdown: 'text', metadata: { upkeep: { archived: 'orphan' }, properties: { a: 1 }, ids: ['email:x@y.com'] } };
    expect(prunedAndUnchanged(archived, n, new Set(['s1']))).toBe(true);
    expect(prunedAndUnchanged(archived, { ...n, body: 'new text' }, new Set(['s1']))).toBe(false);
    // A new source is something new: it comes back.
    expect(prunedAndUnchanged(archived, { ...n, sourceIds: ['s1', 's2'] }, new Set(['s1']))).toBe(false);
    expect(prunedAndUnchanged({ ...archived, metadata: { ...archived.metadata, upkeep: undefined } }, n, new Set(['s1']))).toBe(false);
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

describe('the same conversation reads the same every run', () => {
  it('two emails of one moment keep one order, whatever order they come in', async () => {
    const { conversationsOf, fingerprint } = await import('../src/services/wiki/wikiMeaning');
    const e = (id: string) => ({ id, kind: 'email', title: 's', occurredAt: new Date('2026-11-01T09:00:00Z'), threadKey: 't', clientNumber: 'T-1', userId: 2, scope: 'user', externalId: id, feedEventId: null, participants: [], body: id, details: { from: 'basit@acme.com', to: 'x@y.com', labels: ['SENT'] } }) as any;
    const own = new Set(['basit@acme.com']);
    const [a] = conversationsOf([e('a'), e('b')], own);
    const [b] = conversationsOf([e('b'), e('a')], own);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.sources.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('one ask put to two people', () => {
  it('is two commitments with two identities, so neither overwrites the other', () => {
    const s = { id: 'e1', kind: 'email', title: 't', occurredAt: new Date('2026-11-10T09:00:00Z'), threadKey: 't1', clientNumber: 'T-1', userId: 2, scope: 'user', externalId: 'e1', feedEventId: null, participants: [], body: '', details: {} } as any;
    const conv = { key: 't1', subject: 't', sources: [s], last: s.occurredAt };
    const ex = { projects: [], topics: [], decisions: [], commitments: [
      { what: 'Check the changes for Lahore resources', owner: 'a@x.com', state: 'open' as const },
      { what: 'Check the changes for Lahore resources', owner: 'b@x.com', state: 'open' as const },
    ] };
    const notes = buildMeaningNotes([{ conv, ex }] as any, { personByEmail: new Map(), now: new Date('2026-11-12'), ownEmails: new Set() }).filter((n) => n.type === 'commitment');
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((n) => n.ids![0])).size).toBe(2);
  });
});

describe('same words, two projects (review 16 Nov, P1)', () => {
  it('two open tasks with one title in two projects are two notes, each project linking to its own', () => {
    const s = (id: string, thread: string) => ({ id, kind: 'email', title: thread, occurredAt: new Date('2026-11-05T09:00:00Z'), threadKey: thread, clientNumber: 'T-1', userId: 2, scope: 'user', externalId: id, feedEventId: null, participants: ['fida@acme.com'], body: '', details: {} }) as any;
    const conv = (key: string) => ({ key, subject: `Subject ${key}`, sources: [s(`${key}1`, key)], last: new Date('2026-11-05T09:00:00Z') });
    const ex = (project: string) => ({ projects: [{ name: project, summary: '' }], topics: [], decisions: [], commitments: [{ what: 'Send the proposal', owner: 'fida@acme.com', state: 'open' }] });
    const notes = buildMeaningNotes([{ conv: conv('alpha'), ex: ex('Project Alpha') }, { conv: conv('beta'), ex: ex('Project Beta') }] as any,
      { personByEmail: new Map([['fida@acme.com', 'Fida Khan']]), now: new Date('2026-11-13T12:00:00Z'), ownEmails: new Set(['basit@acme.com']) });
    const cs = notes.filter((n) => n.type === 'commitment');
    expect(cs).toHaveLength(2);
    const alpha = notes.find((n) => n.title === 'Project Alpha')!;
    const beta = notes.find((n) => n.title === 'Project Beta')!;
    const titleOf = (conv: string) => cs.find((c) => (c.properties as any).conversation === conv)!.title;
    expect(links(alpha.body)).toContain(titleOf('alpha'));
    expect(links(beta.body)).toContain(titleOf('beta'));
    expect(titleOf('alpha')).not.toBe(titleOf('beta'));
  });
});

describe('unchanged means the whole note, not only its text (review 16 Nov, P1)', () => {
  const stored = { status: 'active', scope: 'user', bodyMarkdown: 'Same summary', metadata: { wiki: 2, rev: 3, properties: { state: 'open', due: null }, ids: ['commitment:t1:x'] } };
  const built = { type: 'commitment', title: 'x', body: 'Same summary', properties: { state: 'open', due: null }, ids: ['commitment:t1:x'], sourceIds: ['s1'] };

  it('fully unchanged input writes nothing', () => {
    expect(unchangedNote(stored, built, new Set(['s1']))).toBe(true);
  });
  it('the same summary with a new source is a change: its trail must update', () => {
    expect(unchangedNote(stored, { ...built, sourceIds: ['s1', 's2'] }, new Set(['s1']))).toBe(false);
    expect(unchangedNote(stored, built, new Set(['s1', 'old']))).toBe(false);
  });
  it('a property-only correction is a change', () => {
    expect(unchangedNote(stored, { ...built, properties: { state: 'done' } }, new Set(['s1']))).toBe(false);
  });
  it('a changed identifier or scope is a change', () => {
    expect(unchangedNote(stored, { ...built, ids: ['commitment:t1:x:fida@acme.com'] }, new Set(['s1']))).toBe(false);
    expect(unchangedNote(stored, { ...built, scope: 'tenant' }, new Set(['s1']))).toBe(false);
  });
  it('an unresolved link is still rewritten until it reaches its note', () => {
    expect(unchangedNote({ ...stored, metadata: { ...stored.metadata, unresolvedLinks: ['y'] } }, built, new Set(['s1']))).toBe(false);
  });
});

describe('his own addresses', () => {
  it('the same mailbox at a sister domain of his organisation is his; another mailbox is not', async () => {
    const { withSisterAddresses } = await import('../src/services/wiki/wikiSync');
    const own = withSisterAddresses(new Set(['basit.ahmed@tmcltd.com']), ['basit.ahmed@tmcltd.ai', 'fida@tmcltd.ai', 'basit.ahmed@other.com']);
    expect([...own].sort()).toEqual(['basit.ahmed@tmcltd.ai', 'basit.ahmed@tmcltd.com']);
  });
});

describe('documents he sent from either of his addresses', () => {
  it('are one document, and two same-name documents never share a title', () => {
    const f = (id: string, from: string, thread: string, day: string) => ({
      id, kind: 'attachment', title: 'list.xlsx', occurredAt: new Date(`${day}T09:00:00Z`), threadKey: thread, clientNumber: 'T-1', userId: 2, scope: 'user',
      externalId: `${id}:list.xlsx`, feedEventId: null, participants: [from], body: 'Employee list with departments and grades. '.repeat(4),
      details: { filename: 'list.xlsx', mimeType: 'application/vnd.ms-excel', from, gmailMessageId: `g${id}` },
    }) as any;
    const ctx = { personByEmail: new Map(), emailIdByMessage: new Map(), projectsByThread: new Map(), ownEmails: new Set(['basit@tmc.com', 'basit@tmc.ai']) };
    const one = buildDocumentNotes([f('a', 'basit@tmc.com', 't1', '2026-11-01'), f('b', 'basit@tmc.ai', 't2', '2026-11-05')], ctx);
    expect(one).toHaveLength(1);
    expect(one[0].ids).toEqual(['document:list.xlsx:a:list.xlsx']);
    const g = (id: string, from: string, thread: string, day: string) => ({ ...f(id, from, thread, day), body: `Employee list ${id}, with departments and grades. `.repeat(4) });
    const titles = buildDocumentNotes([g('a', 'x@a.com', 't1', '2026-11-01'), g('b', 'y@b.com', 't2', '2026-11-05'), g('c', 'y@b.com', 't3', '2026-11-06')], ctx).map((n) => n.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('distinct obligations of one kind stay distinct (review 16 Nov, second P1)', () => {
  const s = (id: string, thread: string, day: string) => ({ id, kind: 'email', title: thread, occurredAt: new Date(`${day}T09:00:00Z`), threadKey: thread, clientNumber: 'T-1', userId: 2, scope: 'user', externalId: id, feedEventId: null, participants: ['fida@acme.com'], body: '', details: {} }) as any;
  const conv = (key: string, day: string) => ({ key, subject: key, sources: [s(`${key}1`, key, day)], last: new Date(`${day}T09:00:00Z`) });
  const ex = (cs: any[]) => ({ projects: [{ name: 'Payroll', summary: '' }], topics: [], decisions: [], commitments: cs });
  // The model says "the same" to everything here: periods, numbers, due dates and recipients still keep them apart.
  const ctx = { personByEmail: new Map([['fida@acme.com', 'Fida Khan']]), now: new Date('2026-12-21T12:00:00Z'), ownEmails: new Set(['basit@acme.com']), same: { verdict: () => true, pending: [] as any[] } };
  const tasks = (notes: any[]) => notes.filter((n) => n.type === 'commitment');

  it('November and December reports, one owner, one project: two obligations; December done never removes November', async () => {
    const notes = tasks(buildMeaningNotes([
      { conv: conv('nov', '2026-11-15'), ex: ex([{ what: 'Submit November payroll report', owner: 'fida@acme.com', due: '2026-11-20', state: 'open' }]) },
      { conv: conv('dec', '2026-12-18'), ex: ex([{ what: 'Submit December payroll report', owner: 'fida@acme.com', due: '2026-12-20', state: 'done' }]) },
    ] as any, ctx));
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => (n.properties as any).conversation === 'nov')!.properties).toMatchObject({ state: 'open' });
  });

  it('a "done" with no owner for December does not close November', () => {
    const notes = tasks(buildMeaningNotes([
      { conv: conv('nov', '2026-11-15'), ex: ex([{ what: 'Submit November payroll report', owner: 'fida@acme.com', state: 'open' }]) },
      { conv: conv('dec', '2026-12-18'), ex: ex([{ what: 'December payroll report submitted', owner: null, state: 'done' }]) },
    ] as any, ctx));
    expect(notes.find((n) => (n.properties as any).conversation === 'nov')!.properties).toMatchObject({ state: 'open' });
    expect((notes.find((n) => (n.properties as any).conversation === 'nov')!.properties as any).closedIn).toBeUndefined();
  });

  it('different due dates or recipients are different obligations', () => {
    const two = (a: any, b: any) => tasks(buildMeaningNotes([{ conv: conv('t1', '2026-11-15'), ex: ex([a]) }, { conv: conv('t2', '2026-11-18'), ex: ex([b]) }] as any, ctx)).length;
    expect(two({ what: 'Send the payroll sheet', owner: 'fida@acme.com', due: '2026-11-20', state: 'open' }, { what: 'Send the payroll sheet', owner: 'fida@acme.com', due: '2026-12-20', state: 'open' })).toBe(2);
    expect(two({ what: 'Send the payroll sheet', owner: 'fida@acme.com', to: 'a@x.com', state: 'open' }, { what: 'Send the payroll sheet', owner: 'fida@acme.com', to: 'b@x.com', state: 'open' })).toBe(2);
    // Only the month differs, no due dates: still two.
    expect(two({ what: 'Submit the payroll report for November', owner: 'fida@acme.com', state: 'open' }, { what: 'Submit the payroll report for December', owner: 'fida@acme.com', state: 'open' })).toBe(2);
    expect(two({ what: 'Pay invoice 1041', owner: 'fida@acme.com', state: 'open' }, { what: 'Pay invoice 1042', owner: 'fida@acme.com', state: 'open' })).toBe(2);
    // The same obligation, grounded and worded the same: still one.
    expect(two({ what: 'Send the payroll sheet for October', owner: 'fida@acme.com', state: 'open' }, { what: 'Send the October payroll sheet', owner: 'fida@acme.com', state: 'open' })).toBe(1);
  });

  it('his word on November\'s task is not applied to December\'s', () => {
    const notes = tasks(buildMeaningNotes([{ conv: conv('dec', '2026-12-18'), ex: ex([{ what: 'Submit December payroll report', owner: 'fida@acme.com', state: 'open' }]) }] as any,
      { ...ctx, rulings: [{ itemId: 'o1', thread: null, title: 'Submit November payroll report', kind: 'closed' }] }));
    const dec = notes.find((n) => (n.properties as any).conversation === 'dec')!;
    expect((dec.properties as any).state).toBe('open');
    expect((dec.properties as any).ruledBy).toBeUndefined();
  });
});

describe('identity is a judgement of meaning, never of words (review 16 Nov, third P1; tag identity-from-words)', () => {
  const s = (id: string, thread: string, day: string) => ({ id, kind: 'email', title: thread, occurredAt: new Date(`${day}T09:00:00Z`), threadKey: thread, clientNumber: 'T-1', userId: 2, scope: 'user', externalId: id, feedEventId: null, participants: ['fida@acme.com'], body: '', details: {} }) as any;
  const conv = (key: string, day: string) => ({ key, subject: key, sources: [s(`${key}1`, key, day)], last: new Date(`${day}T09:00:00Z`) });
  const ex = (cs: any[]) => ({ projects: [{ name: 'Payroll', summary: '' }], topics: [], decisions: [], commitments: cs });
  const base = { personByEmail: new Map([['fida@acme.com', 'Fida Khan']]), now: new Date('2026-11-21T12:00:00Z'), ownEmails: new Set(['basit@acme.com']) };
  const tasks = (notes: any[]) => notes.filter((n) => n.type === 'commitment');
  const pair = (a: string, b: string, extra: any = {}) => [
    { conv: conv('t1', '2026-11-10'), ex: ex([{ what: a, owner: 'fida@acme.com', state: 'open' }]) },
    { conv: conv('t2', '2026-11-12'), ex: ex([{ what: b, owner: 'fida@acme.com', state: 'open', ...extra }]) },
  ] as any;
  // Every kind of near-identical wording, the identical one included.
  const VARIANTS: Array<[string, string]> = [
    ['Approve payroll release', 'Reject payroll release'],
    ['Send the payroll sheet', 'Send the payroll sheet'],
    ['Send the payroll sheet to finance', 'Do not send the payroll sheet to finance'],
    ['Hire the payroll analyst', 'Dismiss the payroll analyst'],
    ['Share the payroll summary with the board', 'Share the payroll summary with the auditors'],
  ];

  it('with no answer from the model, nothing is ever merged, closed or ruled, however alike the words', () => {
    for (const [a, b] of VARIANTS) {
      const asking = { verdict: () => undefined, pending: [] as any[] };
      expect(tasks(buildMeaningNotes(pair(a, b), { ...base, same: asking }))).toHaveLength(2);
      // And with no judge at all (an older caller): the same.
      expect(tasks(buildMeaningNotes(pair(a, b), base))).toHaveLength(2);
      // The pair was put to the model, not decided here.
      expect(asking.pending).toHaveLength(1);
      expect(asking.pending[0].a.what === a || asking.pending[0].b.what === a).toBe(true);
    }
  });

  it('opposite actions stay two tasks when the model says they differ, and a paraphrase becomes one when it says so', () => {
    const byMeaning = { verdict: undefined as any, pending: [] as any[] };
    const answers = new Map<string, boolean>();
    byMeaning.verdict = (k: string) => answers.get(k);
    const items = pair('Approve payroll release', 'Reject payroll release');
    buildMeaningNotes(items, { ...base, same: byMeaning });
    answers.set(byMeaning.pending[0].key, false);
    expect(tasks(buildMeaningNotes(items, { ...base, same: byMeaning }))).toHaveLength(2);
    const para = pair('Send the October payroll sheet to finance', 'Send finance the payroll sheet for October');
    const asking = { verdict: (k: string) => answers.get(k), pending: [] as any[] };
    buildMeaningNotes(para, { ...base, same: asking });
    answers.set(asking.pending[0].key, true);
    const one = tasks(buildMeaningNotes(para, { ...base, same: asking }));
    expect(one).toHaveLength(1);
    expect(one[0].sourceIds!.sort()).toEqual(['t11', 't21']);
  });

  it('his Action Center word is applied to a task only when the model says it is that task', () => {
    const items = [{ conv: conv('t1', '2026-11-10'), ex: ex([{ what: 'Reject payroll release', owner: 'basit@acme.com', state: 'open' }]) }] as any;
    const rulings = [{ itemId: 'o1', thread: 't1', title: 'Approve payroll release', kind: 'closed' as const }];
    const refused = tasks(buildMeaningNotes(items, { ...base, rulings, same: { verdict: () => false, pending: [] } }));
    expect(refused[0].properties).toMatchObject({ state: 'open' });
    expect((refused[0].properties as any).ruledBy).toBeUndefined();
    const unanswered = tasks(buildMeaningNotes(items, { ...base, rulings, same: { verdict: () => undefined, pending: [] } }));
    expect((unanswered[0].properties as any).ruledBy).toBeUndefined();
    const agreed = tasks(buildMeaningNotes(items, { ...base, rulings, same: { verdict: () => true, pending: [] } }));
    expect(agreed[0].properties).toMatchObject({ state: 'done', ruledBy: 'him' });
  });

  it('two readings the model gave from one conversation are never merged, even on a yes', () => {
    const items = [{ conv: conv('t1', '2026-11-10'), ex: ex([{ what: 'Approve payroll release', owner: 'fida@acme.com', state: 'open' }, { what: 'Approve the payroll release today', owner: 'fida@acme.com', state: 'open' }]) }] as any;
    expect(tasks(buildMeaningNotes(items, { ...base, same: { verdict: () => true, pending: [] } }))).toHaveLength(2);
  });

  it('an answer counts only when the model says the same AND sure; a pair has one key in either order', async () => {
    const { parseVerdict, pairKey, isSame } = await import('../src/services/wiki/wikiSame');
    expect(parseVerdict('{"same": true, "sure": true, "why": "paraphrase"}')).toMatchObject({ same: true, sure: true });
    expect(parseVerdict('{"same": true, "sure": false}')).toMatchObject({ same: true, sure: false });
    expect(parseVerdict('maybe')).toBeNull();
    expect(pairKey('same:', 'a', 'x', 'b', 'y', 'v1')).toBe(pairKey('same:', 'b', 'y', 'a', 'x', 'v1'));
    expect(pairKey('same:', 'a', 'x', 'b', 'y', 'v1')).not.toBe(pairKey('same:', 'a', 'x changed', 'b', 'y', 'v1'));
    expect(pairKey('same:', 'a', 'x', 'b', 'y', 'v1')).not.toBe(pairKey('same:', 'a', 'x', 'b', 'y', 'v2'));
    const j = { verdict: () => undefined, pending: [] as any[] };
    const p = { key: 'k', a: {}, b: {}, anchor: 's' };
    expect(isSame(j, p)).toBe(false);
    expect(isSame(j, p)).toBe(false);
    expect(j.pending).toHaveLength(1);
    expect(isSame(undefined, p)).toBe(false);
  });
});

describe('his Action Center word is always in the Wiki (found 16 Nov against his real list)', () => {
  const s = { id: 'e1', kind: 'email', title: 't1', occurredAt: new Date('2026-11-10T09:00:00Z'), threadKey: 't1', clientNumber: 'T-1', userId: 2, scope: 'user', externalId: 'e1', feedEventId: null, participants: ['numair@acme.com'], body: '', details: {} } as any;
  const conv = { key: 't1', subject: 'TMC Systems Catalogue', sources: [s], last: s.occurredAt };
  const ex = { projects: [], topics: [], decisions: [], commitments: [{ what: 'Send a calendar invite to discuss the source of the systems catalogue', owner: 'basit@acme.com', state: 'open' as const }] };
  const base = { personByEmail: new Map([['numair@acme.com', 'Numair Khan']]), now: new Date('2026-11-16T12:00:00Z'), ownEmails: new Set(['basit@acme.com']) };

  it('an entry no reading was found to match still becomes a note: someone else\'s is theirs, a closed one is done', () => {
    const rulings = [
      { itemId: 'w1', thread: 't1', title: 'Implement TMC Systems Catalogue', kind: 'watch' as const, ownerEmail: 'numair@acme.com', ownerName: 'Numair', why: 'his team builds it' },
      { itemId: 'c1', thread: null, title: 'Report unexpected authenticator setup', kind: 'closed' as const, why: 'not a task' },
    ];
    const notes = buildMeaningNotes([{ conv, ex }] as any, { ...base, rulings, same: { verdict: () => false, pending: [] } }).filter((n) => n.type === 'commitment');
    expect(notes).toHaveLength(3);
    const w = notes.find((n) => (n.properties as any).actionItem === 'w1')!;
    expect(w.title).toBe('Implement TMC Systems Catalogue (Numair Khan)');
    expect(w.properties).toMatchObject({ ownedByYou: false, ruling: 'watch', owner: 'numair@acme.com', openNow: true });
    expect(links(w.body)).toContain('Numair Khan');
    expect(w.sourceIds).toEqual(['e1']);
    const c = notes.find((n) => (n.properties as any).actionItem === 'c1')!;
    expect(c.properties).toMatchObject({ state: 'done', openNow: false, ruling: 'closed' });
    // The other task in that conversation is its own obligation, untouched by his word on the first.
    expect((notes.find((n) => !(n.properties as any).actionItem)!.properties as any).ruledBy).toBeUndefined();
  });

  it('a period or number rules a pair out only on a clear clash', async () => {
    const { periodsClash } = await import('../src/services/wiki/wikiMeaning');
    expect(periodsClash('Approve the August missing timesheet', 'Approve missing timesheet for August 2026')).toBe(false);
    expect(periodsClash('Submit November payroll report', 'Submit December payroll report')).toBe(true);
    expect(periodsClash('Pay invoice 1041', 'Pay invoice 1042')).toBe(true);
    expect(periodsClash('Approve 40 missing August hours', 'Approve missing timesheet for August')).toBe(false);
    expect(periodsClash('Close Q3 books', 'Close Q4 books')).toBe(true);
    expect(periodsClash('Send the plan', 'Send the plan for 2026')).toBe(false);
  });
});
