/**
 * Meaning notes (docs/Wiki-Knowledge.md §0.13 part 10): projects, topics,
 * decisions and commitments read by the model from the conversations he wrote
 * in. The model is mocked here; on production it is Gemini Flash.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

import { parseExtraction, buildMeaningNotes, conversationsOf, openNow, fingerprint, renderConversation, renameClashes, type Conversation } from '../src/services/wiki/wikiMeaning';
import { extractWikiLinks } from '../src/services/wiki/wikiLinks';

const src = (id: string, day: string, from: string, body: string, extra: Record<string, unknown> = {}) => ({
  id, kind: 'email', title: 'ECP Payroll', occurredAt: new Date(`${day}T09:00:00Z`), threadKey: 't1', clientNumber: 'T-1', userId: 2, scope: 'user',
  externalId: id, feedEventId: null, participants: [from, 'basit@acme.com'], body, details: { from, to: 'basit@acme.com', ...extra },
}) as any;
const now = new Date('2026-11-13T12:00:00Z');
const ctx = { personByEmail: new Map([['fida@acme.com', 'Fida Khan']]), now, ownEmails: new Set(['basit@acme.com']) };

describe('meaning notes', () => {
  it('reads only the conversations he wrote in, newest first', () => {
    const convs = conversationsOf([
      src('a', '2026-11-01', 'fida@acme.com', 'Please send the plan'),
      src('b', '2026-11-02', 'Basit <basit@acme.com>', 'Will do', { labels: ['SENT'], to: 'fida@acme.com' }),
      { ...src('d', '2026-11-03', 'Basit <basit@acme.com>', 'Day Brief', { labels: ['SENT'] }), threadKey: 't3' }, // Brain's own mail to him: not a conversation
      { ...src('c', '2026-11-05', 'news@x.com', 'Newsletter'), threadKey: 't2' },
    ], new Set(['basit@acme.com']));
    expect(convs.map((c) => c.key)).toEqual(['t1']);
    // His sent mail with no recipient field recorded is still his conversation.
    expect(conversationsOf([{ ...src('e', '2026-11-04', 'Basit <basit@acme.com>', 'x', { labels: ['SENT'], to: undefined }), threadKey: 't4' }], new Set(['basit@acme.com'])).map((c) => c.key)).toEqual(['t4']);
    expect(convs[0].sources.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('a conversation\'s fingerprint changes when an email is added or its text changes', () => {
    const c1: Conversation = { key: 't1', subject: 's', last: now, sources: [src('a', '2026-11-01', 'f', 'one')] };
    const c2: Conversation = { ...c1, sources: [...c1.sources, src('b', '2026-11-02', 'f', 'two')] };
    const c3: Conversation = { ...c1, sources: [src('a', '2026-11-01', 'f', 'one, corrected')] };
    expect(fingerprint(c1)).not.toBe(fingerprint(c2));
    expect(fingerprint(c1)).not.toBe(fingerprint(c3));
    expect(fingerprint(c1)).toBe(fingerprint({ ...c1 }));
    expect(renderConversation(c2).indexOf('one')).toBeLessThan(renderConversation(c2).indexOf('two')); // oldest first
  });

  it('keeps what the model said only when it is well formed; never guesses', () => {
    expect(parseExtraction('not json')).toEqual({ projects: [], topics: [], decisions: [], commitments: [] });
    const ex = parseExtraction('```json\n{"projects":[{"name":"ECP Payroll","summary":"Payroll on SAP"},{"name":"x"}],"commitments":[{"what":"Send the plan","owner":"Fida <FIDA@acme.com>","state":"maybe","date":"13 Nov"}],"decisions":[{"what":"ok"}]}\n```');
    expect(ex.projects.map((p) => p.name)).toEqual(['ECP Payroll']); // a 1-letter name is dropped
    expect(ex.commitments[0]).toMatchObject({ owner: 'fida@acme.com', state: 'open', date: null }); // bad state → open, bad date → none
    expect(ex.decisions).toEqual([]); // too short to be a decision
  });

  it('an old open commitment is history, not open (he ruled: read everything, but old requests are not open items)', () => {
    expect(openNow('open', new Date('2026-11-01'), now)).toBe(true);
    expect(openNow('open', new Date('2026-07-01'), now)).toBe(false);
    expect(openNow('done', new Date('2026-11-12'), now)).toBe(false);
  });

  it('builds linked notes: the project lists its people, decisions and commitments; a commitment he owes says "you"', () => {
    const conv: Conversation = { key: 't1', subject: 'ECP Payroll', last: new Date('2026-11-12T09:00:00Z'), sources: [src('a', '2026-11-12', 'fida@acme.com', 'x')] };
    const old: Conversation = { key: 't9', subject: 'Old thing', last: new Date('2026-06-01T09:00:00Z'), sources: [{ ...src('z', '2026-06-01', 'fida@acme.com', 'y'), threadKey: 't9' }] };
    const notes = buildMeaningNotes([
      { conv, ex: { projects: [{ name: 'ECP Payroll', summary: 'Payroll on SAP.', status: 'build' }], topics: [{ name: 'Namespaces' }], decisions: [{ what: 'Use a partner namespace', by: 'fida@acme.com', date: '2026-11-12' }], commitments: [{ what: 'Approve the plan', owner: 'basit@acme.com', to: 'fida@acme.com', state: 'open', due: null, date: null, evidence: null }] } },
      { conv: old, ex: { projects: [], topics: [], decisions: [], commitments: [{ what: 'Send the old file', owner: 'fida@acme.com', state: 'open', due: null, date: null, evidence: null }] } },
    ], ctx);
    const by = (t: string, title: string) => notes.find((n) => n.type === t && n.title === title)!;
    const project = by('project', 'ECP Payroll');
    expect(project.body).toContain('[[Fida Khan]]');
    expect(project.body).toContain('[[Decision: Use a partner namespace]]');
    expect(project.body).toContain('[[Approve the plan (you)]]');
    const mine = by('commitment', 'Approve the plan (you)');
    expect(mine.body).toContain('**Owed by:** you');
    expect(mine.properties).toMatchObject({ state: 'open', openNow: true, ownedByYou: true });
    const stale = by('commitment', 'Send the old file (Fida Khan)');
    expect(stale.properties).toMatchObject({ state: 'history', openNow: false });
    expect(by('topic', 'Namespaces').body).toContain('[[ECP Payroll]]');
    expect(mine.sourceIds).toEqual(['a']);
    // Every link points at a note that was built, or at a person note.
    const titles = new Set([...notes.map((n) => n.title.toLowerCase()), 'fida khan']);
    for (const n of notes) for (const l of extractWikiLinks(n.body)) expect(titles.has(l.key), `${n.title} -> ${l.key}`).toBe(true);
  });

  it('his word wins: a task he confirmed is his and open, one he said is someone else\'s is not his, a closed one is done', () => {
    const conv: Conversation = { key: 't1', subject: 'Escalations', last: new Date('2026-11-12T09:00:00Z'), sources: [src('a', '2026-11-12', 'fida@acme.com', 'x')] };
    const ex = { projects: [], topics: [], decisions: [], commitments: [
      { what: 'Expedite HCM developments and secure missing data', owner: 'basit@acme.com', state: 'open' as const, due: null, date: null, evidence: null },
      { what: 'Give Salman a downtime slot for the CPU upgrade', owner: 'salman@acme.com', state: 'open' as const, due: null, date: null, evidence: null },
      { what: 'Report unexpected authenticator setup', owner: 'basit@acme.com', state: 'open' as const, due: null, date: null, evidence: null },
    ] };
    const notes = buildMeaningNotes([{ conv, ex }], { ...ctx, rulings: [
      { itemId: 'w1', thread: 't1', title: 'Expedite HCM developments and secure missing data', kind: 'watch', ownerName: 'Javed Rashid', why: 'an escalation report' },
      { itemId: 'm1', thread: 't1', title: 'Give Salman Amin a downtime slot for the deepmarks CPU upgrade', kind: 'mine' },
      { itemId: 'c1', thread: null, title: 'Report unexpected authenticator setup', kind: 'closed', why: 'not a task' },
      { itemId: 'm2', thread: null, title: 'Add the make-to-order process to the ProPlan sheet', kind: 'mine' },
    ] });
    const c = (t: string) => notes.find((n) => n.type === 'commitment' && n.title.startsWith(t))!;
    expect(c('Expedite HCM').properties).toMatchObject({ ownedByYou: false, ruling: 'watch', openNow: true });
    expect(c('Expedite HCM').body).toContain('**Owed by:** Javed Rashid');
    expect(c('Give Salman').properties).toMatchObject({ ownedByYou: true, state: 'open', ruling: 'mine' });
    expect(c('Report unexpected').properties).toMatchObject({ state: 'done', openNow: false, ruling: 'closed' });
    expect(c('Add the make-to-order').properties).toMatchObject({ ownedByYou: true, openNow: true, ruling: 'mine', actionItem: 'm2' });
  });

  it('one task in several conversations is one commitment citing them all', () => {
    const c1: Conversation = { key: 't1', subject: 'a', last: new Date('2026-11-10T09:00:00Z'), sources: [src('a', '2026-11-10', 'f', 'x')] };
    const c2: Conversation = { key: 't2', subject: 'b', last: new Date('2026-11-12T09:00:00Z'), sources: [{ ...src('b', '2026-11-12', 'f', 'y'), threadKey: 't2' }] };
    const task = (what: string) => ({ projects: [], topics: [], decisions: [], commitments: [{ what, owner: 'basit@acme.com', state: 'open' as const, due: null, date: null, evidence: null }] });
    const notes = buildMeaningNotes([{ conv: c2, ex: task('Send Haseeb your comments on the Travel Booking Audit spec') }, { conv: c1, ex: task('Send your comments on the Travel Booking Audit spec') }], ctx);
    const cs = notes.filter((n) => n.type === 'commitment');
    expect(cs).toHaveLength(1);
    expect([...cs[0].sourceIds!].sort()).toEqual(['a', 'b']);
  });

  it('a project named like another note gets its kind in the title, and links follow it', () => {
    const out = renameClashes([
      { type: 'project', title: 'Vision Metric', body: 'x' },
      { type: 'commitment', title: 'Fix it (you)', body: '**Project:** [[Vision Metric]]' },
    ] as any, new Set(['vision metric']));
    expect(out[0].title).toBe('Vision Metric (project)');
    expect(out[1].body).toBe('**Project:** [[Vision Metric (project)]]');
  });

  it('projects and topics are written before what links to them, and a topic that is a project is the project', () => {
    const conv: Conversation = { key: 't1', subject: 's', last: now, sources: [src('a', '2026-11-12', 'fida@acme.com', 'x')] };
    const notes = buildMeaningNotes([{ conv, ex: { projects: [{ name: 'TMC Context', summary: '' }], topics: [{ name: 'Pricing' }], decisions: [], commitments: [{ what: 'Update the context', owner: 'fida@acme.com', state: 'open', due: null, date: null, evidence: null }] } },
      { conv: { ...conv, key: 't2' }, ex: { projects: [], topics: [{ name: 'TMC Context' }], decisions: [], commitments: [] } }], ctx);
    expect(notes.map((n) => n.type)).toEqual(['project', 'topic', 'commitment']);
    expect(notes.filter((n) => n.title === 'TMC Context')).toHaveLength(1);
  });
});
