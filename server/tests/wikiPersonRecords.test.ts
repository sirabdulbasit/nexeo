/**
 * Integration records merge into People by exact email (founder, 24 Nov 2026: "merge directory into people
 * and always do the same where you can updating additional information if comes"). Wiki-Knowledge §0.29.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

import { buildNotes, recordsFor, recordFacts, factValue, type StoredItem, type PersonRecord } from '../src/services/wiki/wikiBuilder';
import { extractWikiLinks } from '../src/services/wiki/wikiLinks';

const at = (d: string) => new Date(`${d}T09:00:00+05:00`);
const items: StoredItem[] = [
  { id: 'm1', sourceType: 'gmail', at: at('2026-11-01'), payload: { threadId: 't1', subject: 'Budget', from: 'Abdul Rafay <abdul.rafay@tmcltd.com>', to: 'basit@tmcltd.com', userRepliedThread: true } },
  { id: 'm2', sourceType: 'gmail', at: at('2026-11-02'), payload: { threadId: 't2', subject: 'Hello', from: 'Sara <sara@other.com>', to: 'basit@tmcltd.com', userRepliedThread: true } },
];
const record = (fields: Record<string, string>, name = 'Abdul Rafay Hussain'): PersonRecord =>
  ({ integration: 'TMC Employee Directory', title: `TMC Employee Directory · ${name}`, fields });
const ctxWith = (records?: Map<string, PersonRecord[]>) =>
  ({ userName: 'Basit Ahmed', userEmail: 'basit@tmcltd.com', now: at('2026-11-12'), records });
const person = (notes: ReturnType<typeof buildNotes>, email: string) =>
  notes.find((n) => n.type === 'person' && (n.ids ?? []).includes(`email:${email}`))!;

const dir = { ...record({ name: 'Abdul Rafay Hussain', email: 'abdul.rafay@tmcltd.com', designation: 'MTO', departmentName: 'SAP Controlling', phone: '923313301946', profilePicture: '/x.jpg', reportsTo: '', dateOfBirth: '2000-04-18', gender: 'male', contractEndDate: '2026-10-30' }), sourceId: 'src_rafay' };

describe('integration records merge into People', () => {
  it('a person whose email matches a record gets its facts, a link to it and its phone', () => {
    const notes = buildNotes(items, ctxWith(new Map([['abdul.rafay@tmcltd.com', [dir]]])));
    const p = person(notes, 'abdul.rafay@tmcltd.com');
    expect(p.body).toContain('## From TMC Employee Directory');
    expect(p.body).toContain('- **designation:** MTO');
    expect(p.body).toContain('- **departmentName:** SAP Controlling');
    expect(p.sourceIds).toContain('src_rafay');
    expect(p.properties!.phone).toBe('923313301946');
    expect((p.properties!.records as any[])[0]).toMatchObject({ integration: 'TMC Employee Directory', designation: 'MTO' });
  });

  it('a field naming a known person or business unit becomes a link; sensitive fields never reach the note', () => {
    const boss = record({ name: 'Rai Sohaib Amjad', email: 'rai@tmcltd.com', reportsTo: 'Nobody' });
    const withBoss = record({ ...dir.fields, reportsTo: 'Rai Sohaib Amjad', businessUnit: 'TMC Private Limited' });
    const linkable = new Map([['rai sohaib amjad', 'Rai Sohaib Amjad'], ['tmc private limited', 'TMC Private Limited']]);
    const notes = buildNotes(items, { ...ctxWith(new Map([['abdul.rafay@tmcltd.com', [withBoss]], ['rai@tmcltd.com', [boss]]])), linkable });
    const p = person(notes, 'abdul.rafay@tmcltd.com');
    expect(p.body).toContain('- **reportsTo:** [[Rai Sohaib Amjad]]');
    expect(p.body).toContain('- **businessUnit:** [[TMC Private Limited]]');
    expect(extractWikiLinks(p.body).map((l: any) => l.title)).toEqual(expect.arrayContaining(['Rai Sohaib Amjad', 'TMC Private Limited']));
    expect(p.body).not.toMatch(/dateOfBirth|gender|contractEndDate|2000-04-18/);
    expect(JSON.stringify(p.properties)).not.toMatch(/dateOfBirth|gender|contractEndDate/);
    expect(factValue('Someone Unknown', linkable)).toBe('Someone Unknown');
  });

  it('leaves out the matching address, pictures and empty fields', () => {
    expect(recordFacts(dir).map(([k]) => k)).toEqual(['name', 'designation', 'departmentName', 'phone']);
  });

  it('never merges on a name: a person without the address gets nothing', () => {
    const notes = buildNotes(items, ctxWith(new Map([['abdul.rafay@tmcltd.com', [dir]]])));
    const sara = person(notes, 'sara@other.com');
    expect(sara.body).not.toContain('## From');
    expect(sara.properties!.records).toBeNull();
  });

  it('updates when the record changes and clears when it is gone', () => {
    const changed = record({ ...dir.fields, designation: 'Consultant' });
    const after = person(buildNotes(items, ctxWith(new Map([['abdul.rafay@tmcltd.com', [changed]]]))), 'abdul.rafay@tmcltd.com');
    expect(after.body).toContain('- **designation:** Consultant');
    expect(after.body).not.toContain('- **designation:** MTO');
    const gone = person(buildNotes(items, ctxWith(new Map())), 'abdul.rafay@tmcltd.com');
    expect(gone.body).not.toContain('## From');
    expect(gone.properties!.records).toBeNull();
  });

  it('a known contact phone still wins over the record phone', () => {
    const notes = buildNotes(items, { ...ctxWith(new Map([['abdul.rafay@tmcltd.com', [dir]]])), knownPhones: new Map([['abdul.rafay@tmcltd.com', '0300']]) });
    expect(person(notes, 'abdul.rafay@tmcltd.com').properties!.phone).toBe('0300');
  });

  it('records from several integrations are each listed once, matched case-insensitively', () => {
    const crm = { integration: 'Odoo CRM', title: 'Odoo CRM · Rafay', fields: { email: 'Abdul.Rafay@tmcltd.com', stage: 'Won' } };
    const m = new Map([['abdul.rafay@tmcltd.com', [dir, crm, dir]]]);
    expect(recordsFor(['ABDUL.RAFAY@tmcltd.com'], m).map((r) => r.integration)).toEqual(['Odoo CRM', 'TMC Employee Directory']);
  });

  it('builds the same note twice from the same input (a repeat run writes 0)', () => {
    const m = new Map([['abdul.rafay@tmcltd.com', [dir]]]);
    expect(person(buildNotes(items, ctxWith(m)), 'abdul.rafay@tmcltd.com')).toEqual(person(buildNotes(items, ctxWith(m)), 'abdul.rafay@tmcltd.com'));
  });
});

describe('a directory person he never dealt with still gets a People note (founder 25 Nov: "Rafay should be there")', () => {
  const only = { ...record({ name: 'Abdul Rafay Hussain', email: 'rafay.h@tmcltd.com', designation: 'MTO', reportsTo: 'Rai Sohaib Amjad', gender: 'male' }), sourceId: 'src_r2' };
  const boss = { ...record({ name: 'Rai Sohaib Amjad', email: 'rai@tmcltd.com' }, 'Rai Sohaib Amjad'), sourceId: 'src_rai' };
  const m = new Map([['rafay.h@tmcltd.com', [only]], ['rai@tmcltd.com', [boss]], ['abdul.rafay@tmcltd.com', [dir]]]);

  it('creates a person note titled by the record name, citing the record, sensitive fields left out', () => {
    const notes = buildNotes(items, ctxWith(m));
    const p = person(notes, 'rafay.h@tmcltd.com');
    expect(p.title).toBe('Abdul Rafay Hussain');
    expect(p.sourceIds).toEqual(['src_r2']);
    expect(p.body).toContain('- **designation:** MTO');
    expect(p.body).toContain('- **reportsTo:** [[Rai Sohaib Amjad]]');
    expect(p.body).not.toMatch(/gender/);
    expect(notes.filter((n) => n.title.toLowerCase().includes('rafay')).map((n) => n.title)).toContain('Abdul Rafay Hussain');
  });

  it('an address the user already dealt with keeps its one note (no duplicate)', () => {
    const notes = buildNotes(items, ctxWith(m));
    expect(notes.filter((n) => (n.ids ?? []).includes('email:abdul.rafay@tmcltd.com'))).toHaveLength(1);
  });

  it('a record with no name or no email stays a source only; a taken name gets the address', () => {
    const noName = new Map([['x@tmcltd.com', [{ integration: 'Odoo', title: 'Odoo · ', fields: { email: 'x@tmcltd.com' } }]]]);
    expect(buildNotes(items, ctxWith(noName)).some((n) => (n.ids ?? []).includes('email:x@tmcltd.com'))).toBe(false);
    const twin = new Map([['sara2@tmcltd.com', [record({ name: 'Sara', email: 'sara2@tmcltd.com' }, 'Sara')]]]);
    expect(person(buildNotes(items, ctxWith(twin)), 'sara2@tmcltd.com').title).toBe('Sara (sara2@tmcltd.com)');
  });

  it('is stable: the same input builds the same notes', () => {
    expect(buildNotes(items, ctxWith(m))).toEqual(buildNotes(items, ctxWith(m)));
  });
});

describe('record-only people skip the user and role addresses', () => {
  it('no note for the user himself or a no-reply address', () => {
    const m = new Map([['basit@tmcltd.com', [record({ name: 'Basit Ahmed', email: 'basit@tmcltd.com' }, 'Basit Ahmed')]], ['noreply@tmcltd.com', [record({ name: 'HR Bot', email: 'noreply@tmcltd.com' }, 'HR Bot')]]]);
    const titles = buildNotes(items, ctxWith(m)).map((n) => n.title);
    expect(titles).not.toContain('Basit Ahmed');
    expect(titles).not.toContain('HR Bot');
  });
});
