/**
 * Every kind of integration lands in its part of the Wiki (founder 25 Nov 2026; Wiki-Knowledge §0.32, contract
 * agreed with the Integration session). The wizard sets what a row is; the Wiki builds that kind of note.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

import { buildRowNotes, STEP_ENTITIES, type RowSource } from '../src/services/wiki/wikiIntegrationNotes';
import { entityOf, recordDomain, buildNotes, type StoredItem } from '../src/services/wiki/wikiBuilder';
import { NOTE_TYPES } from '../src/services/wiki/wikiStructure';

const row = (key: string, entity: string | undefined, fields: Record<string, string>, extra: Record<string, unknown> = {}): RowSource => ({
  id: `src_${key}`, externalId: `integration:i1:${key}`, title: fields.name ?? key,
  details: { store: 'integration', integration: 'Projects Sheet', integrationId: 'i1', titleField: 'name', fields, ...(entity ? { entity } : {}), ...extra },
});

describe('integration rows become the kind of note the wizard set', () => {
  it('each kind is a Wiki note type, identified by the row, cited, with facts as properties', () => {
    for (const e of STEP_ENTITIES) expect(NOTE_TYPES as readonly string[]).toContain(e);
    const [n] = buildRowNotes([row('P-7', 'project', { name: 'Alpha Rollout', status: 'Active', owner: 'Sara Khan' })], new Map(), new Map());
    expect(n).toMatchObject({ type: 'project', title: 'Alpha Rollout', ids: ['record:i1:i1:p-7'], sourceIds: ['src_P-7'] });
    expect(n.properties).toMatchObject({ integration: 'Projects Sheet', status: 'Active', owner: 'Sara Khan' });
    expect(n.properties).not.toHaveProperty('name');
  });

  it('a field naming an existing note is a link; an unknown name stays text (no link that cannot resolve)', () => {
    const [n] = buildRowNotes([row('T-1', 'commitment', { name: 'Send Q4 report', owner: 'Sara Khan', client: 'Nobody Ltd' })],
      new Map([['sara khan', 'Sara Khan']]), new Map());
    expect(n.body).toContain('- **owner:** [[Sara Khan]]');
    expect(n.body).toContain('- **client:** Nobody Ltd');
  });

  it('personal fields never reach the note', () => {
    const [n] = buildRowNotes([row('D-1', 'decision', { name: 'Hire', candidateDateOfBirth: '1990-01-01', salary: '9' })], new Map(), new Map());
    expect(JSON.stringify(n)).not.toMatch(/1990-01-01|salary/);
  });

  it('a name held by another note gets the integration added; the row\'s own note keeps its name', () => {
    const taken = new Map([['project|alpha rollout', ['email:x@y.com']]]);
    expect(buildRowNotes([row('P-7', 'project', { name: 'Alpha Rollout' })], new Map(), taken)[0].title).toBe('Alpha Rollout (Projects Sheet)');
    const mine = new Map([['project|alpha rollout', ['record:i1:i1:p-7']]]);
    expect(buildRowNotes([row('P-7', 'project', { name: 'Alpha Rollout' })], new Map(), mine)[0].title).toBe('Alpha Rollout');
    const two = buildRowNotes([row('A', 'topic', { name: 'Same' }), row('B', 'topic', { name: 'Same' })], new Map(), new Map());
    expect(two.map((n) => n.title)).toEqual(['Same', 'Same (Projects Sheet)']);
  });

  it('stale rows, "none", people, companies and unnamed rows make no note here', () => {
    const out = buildRowNotes([
      row('S', 'project', { name: 'Old' }, { stale: true }),
      row('N', 'none', { name: 'Raw' }),
      row('P', 'person', { name: 'Ali', email: 'ali@x.com' }),
      row('C', 'company', { name: 'Acme', website: 'acme.com' }),
      { ...row('U', 'project', { status: 'x' }), title: '' },
    ], new Map(), new Map());
    expect(out).toEqual([]);
  });

  it('builds the same notes twice from the same rows (a repeat run writes 0)', () => {
    const rows = [row('P-1', 'project', { name: 'B' }), row('P-2', 'meeting', { name: 'A' })];
    expect(buildRowNotes(rows, new Map(), new Map())).toEqual(buildRowNotes([...rows].reverse(), new Map(), new Map()));
  });
});

describe('the wizard entity decides people and companies too', () => {
  it('entityOf: the wizard choice wins; an old row with an email is a person, without one it stays a source', () => {
    expect(entityOf({ entity: 'company' }, { email: 'info@acme.com' })).toBe('company');
    expect(entityOf({}, { email: 'ali@acme.com' })).toBe('person');
    expect(entityOf({}, { name: 'x' })).toBe('none');
    expect(entityOf({ entity: 'bogus' }, { name: 'x' })).toBe('none');
  });

  it('recordDomain reads a website first, then a business email; never a free mail domain', () => {
    expect(recordDomain({ website: 'https://www.Acme.com/about' })).toBe('acme.com');
    expect(recordDomain({ contact: 'sales@globex.io' })).toBe('globex.io');
    expect(recordDomain({ contact: 'someone@gmail.com' })).toBeNull();
  });

  it('a company row merges into the company note of the same domain, and a new one gets its own note', () => {
    const at = new Date('2026-11-01T09:00:00+05:00');
    const items: StoredItem[] = [{ id: 'm1', sourceType: 'gmail', at, payload: { threadId: 't', subject: 'Hi', from: 'Ali <ali@acme.com>', to: 'me@mine.com', userRepliedThread: true } }];
    const companyRecords = new Map([
      ['acme.com', [{ integration: 'CRM', title: 'Acme Corp', fields: { name: 'Acme Corp', website: 'acme.com', tier: 'Gold' }, sourceId: 'c1' }]],
      ['globex.io', [{ integration: 'CRM', title: 'Globex', fields: { name: 'Globex', website: 'globex.io', tier: 'Silver' }, sourceId: 'c2' }]],
    ]);
    const notes = buildNotes(items, { userName: 'Me', userEmail: 'me@mine.com', now: at, companyRecords });
    const acme = notes.find((n) => n.type === 'company' && (n.ids ?? []).includes('domain:acme.com'))!;
    expect(acme.body).toContain('## From CRM');
    expect(acme.body).toContain('- **tier:** Gold');
    expect(acme.sourceIds).toContain('c1');
    const globex = notes.find((n) => n.type === 'company' && (n.ids ?? []).includes('domain:globex.io'))!;
    expect(globex).toMatchObject({ title: 'Globex', sourceIds: ['c2'] });
    expect(notes.filter((n) => n.type === 'person').map((n) => n.title)).not.toContain('Globex');
  });
});
