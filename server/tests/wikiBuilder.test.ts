/**
 * Wiki builder — stored feed items in, linked notes out (docs/Wiki-Knowledge.md §6 step 2).
 * `buildNotes` is pure, so these run on plain data.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

import { buildNotes, parseAddresses, isRoleAddress, isJunkAddress, orgLabel, nameFromEmail, type StoredItem } from '../src/services/wiki/wikiBuilder';
import { extractWikiLinks } from '../src/services/wiki/wikiLinks';

let n = 0;
const at = (d: string) => new Date(`${d}T09:00:00+05:00`);
const mail = (d: string, p: Record<string, any>): StoredItem => ({ id: `m${++n}`, sourceType: 'gmail', at: at(d), payload: p });
const cal = (d: string, p: Record<string, any>): StoredItem => ({ id: `c${++n}`, sourceType: 'gcal', at: at(d), payload: { start: `${d}T10:00:00+05:00`, ...p } });
const chat = (d: string, p: Record<string, any>): StoredItem => ({ id: `g${++n}`, sourceType: 'gchat', at: at(d), payload: p });
const ctx = { userName: 'Basit Ahmed', userEmail: 'basit@acme.com', now: at('2026-11-12') };
const find = (notes: ReturnType<typeof buildNotes>, type: string, title: string) => notes.find((x) => x.type === type && x.title === title);
const titlesOf = (notes: ReturnType<typeof buildNotes>, type: string) => notes.filter((x) => x.type === type).map((x) => x.title).sort();

describe('wikiBuilder helpers', () => {
  it('parses address lists and tells people from mailboxes', () => {
    expect(parseAddresses('"Khan, Ali" <Ali@X.com>, sara@y.com')).toEqual([{ email: 'ali@x.com', name: 'Khan, Ali' }, { email: 'sara@y.com', name: null }]);
    expect(isRoleAddress('hr@acme.com')).toBe(true);
    expect(isRoleAddress('ph.all@acme.com')).toBe(true);
    expect(isRoleAddress('ali.khan@acme.com')).toBe(false);
    expect(isJunkAddress('no-reply@shop.com')).toBe(true);
    expect(orgLabel('acme.com')).toBe(orgLabel('acme.ai'));
    expect(orgLabel('sapphire.com.pk')).toBe('sapphire');
    expect(nameFromEmail('ali.khan@acme.com')).toBe('Ali Khan');
  });
});

describe('buildNotes', () => {
  const items: StoredItem[] = [
    // A thread the user wrote in: Ali and Sara get notes; the no-reply and the list do not.
    mail('2026-11-01', { threadId: 't1', subject: 'Pricing', from: 'Ali Khan <ali.khan@acme.com>', to: 'basit@acme.com', cc: 'sara@gmail.com, hr@acme.com' }),
    mail('2026-11-02', { threadId: 't1', subject: 'Re: Pricing', from: 'Basit Ahmed <basit@acme.com>', to: 'ali.khan@acme.com', labels: ['SENT'] }),
    // Same mailbox at the sibling domain: the same person.
    mail('2026-11-03', { threadId: 't2', subject: 'Contract', from: 'ali.khan@acme.ai', to: 'basit@acme.com', userRepliedThread: true }),
    // A newsletter the user never answered: no note.
    mail('2026-11-03', { threadId: 't3', subject: 'Weekly digest', from: 'Digest <news@letters.com>', to: 'basit@acme.com' }),
    mail('2026-11-04', { threadId: 't4', subject: 'Hello', from: 'Stranger <stranger@else.com>', to: 'basit@acme.com' }),
    // A recurring meeting, one entry stored twice.
    cal('2026-11-05', { title: 'Weekly Sync', eventId: 'e1', attendees: ['basit@acme.com', 'ali.khan@acme.com', 'omar@partner.io'], organizer: 'basit@acme.com' }),
    cal('2026-11-05', { title: 'Weekly Sync', eventId: 'e1', attendees: ['basit@acme.com', 'ali.khan@acme.com', 'omar@partner.io'], organizer: 'basit@acme.com' }),
    cal('2026-11-19', { title: 'Weekly Sync', eventId: 'e2', attendees: ['basit@acme.com', 'ali.khan@acme.com'], organizer: 'basit@acme.com' }),
    cal('2026-11-06', { title: 'Focus time', eventId: 'e3', attendees: ['basit@acme.com'], organizer: 'basit@acme.com' }),
    // Chat: a standing space, a per-meeting space, a bot, a nameless sender, the user himself.
    chat('2026-11-07', { spaceType: 'SPACE', spaceDisplayName: 'Deals', spaceName: 'spaces/1', senderDisplayName: 'Ali Khan' }),
    chat('2026-11-07', { spaceType: 'SPACE', spaceDisplayName: 'Deals', spaceName: 'spaces/1', senderDisplayName: 'Ali Khan' }),
    chat('2026-11-07', { spaceType: 'SPACE', spaceDisplayName: 'Deals', spaceName: 'spaces/1', senderDisplayName: 'Basit Ahmed' }),
    chat('2026-11-07', { spaceType: 'SPACE', spaceDisplayName: 'Deals', spaceName: 'spaces/1', senderDisplayName: 'Task Sync Bot' }),
    chat('2026-11-07', { spaceType: 'SPACE', spaceDisplayName: 'Deals', spaceName: 'spaces/1', senderDisplayName: 'users/123' }),
    chat('2026-11-07', { spaceType: 'SPACE', spaceDisplayName: 'Weekly Sync - Nov 5', spaceName: 'spaces/2', senderDisplayName: 'Zed Once' }),
    chat('2026-11-08', { spaceType: 'DIRECT_MESSAGE', senderDisplayName: 'Hina Shah' }),
  ];
  const notes = buildNotes(items, ctx);

  it('writes a note only for people the user dealt with', () => {
    expect(titlesOf(notes, 'person')).toEqual(['Ali Khan', 'Hina Shah', 'Omar', 'Sara']);
  });

  it('joins one person across addresses and across email, calendar and chat', () => {
    const ali = find(notes, 'person', 'Ali Khan')!;
    expect(ali.properties).toMatchObject({
      emails: expect.arrayContaining(['ali.khan@acme.com', 'ali.khan@acme.ai']),
      company: 'acme.com', emailThreads: 2, meetings: 1, chatMessages: 2, knownFrom: ['chat', 'email', 'meeting'],
      lastSeen: '2026-11-07',
    });
    expect(extractWikiLinks(ali.body).map((l) => l.title).sort()).toEqual(['Deals', 'Weekly Sync', 'acme.com']);
    expect(ali.body).toContain('Pricing (2 messages)');
  });

  it('writes one note per meeting title, counting a repeated entry once', () => {
    expect(titlesOf(notes, 'meeting')).toEqual(['Weekly Sync']);
    const m = find(notes, 'meeting', 'Weekly Sync')!;
    expect(m.properties).toMatchObject({ occurrences: 2, firstOn: '2026-11-05', nextOn: '2026-11-19', attendees: 2 });
    expect(extractWikiLinks(m.body).map((l) => l.title).sort()).toEqual(['Ali Khan', 'Omar']);
  });

  it('writes companies and standing groups, linked to their people', () => {
    expect(titlesOf(notes, 'company')).toEqual(['acme.com', 'partner.io']);
    expect(find(notes, 'company', 'acme.com')!.properties).toMatchObject({ domains: ['acme.ai', 'acme.com'], people: 1 });
    expect(titlesOf(notes, 'group')).toEqual(['Deals']);
    expect(extractWikiLinks(find(notes, 'group', 'Deals')!.body).map((l) => l.title)).toEqual(['Ali Khan']);
  });

  it('every link in every note points at a note that was built', () => {
    const built = new Set(notes.map((x) => x.title.toLowerCase()));
    for (const note of notes) for (const l of extractWikiLinks(note.body)) expect(built.has(l.key), `${note.title} → ${l.title}`).toBe(true);
  });

  it('cites its sources and is the same on a second run', () => {
    expect(find(notes, 'person', 'Hina Shah')!.sourceIds).toHaveLength(1);
    // The trail is complete: every item a person appears in is cited.
    expect(find(notes, 'person', 'Ali Khan')!.sourceIds!.length).toBeGreaterThanOrEqual(7);
    expect(buildNotes(items, ctx)).toEqual(notes);
  });

  it('keeps two people with one name at two organisations apart, and fixes "Last, First"', () => {
    const two = buildNotes([
      mail('2026-11-01', { threadId: 'a', subject: 'A', from: 'Ali Raza <a.raza@one.com>', to: 'basit@acme.com', userRepliedThread: true }),
      mail('2026-11-01', { threadId: 'b', subject: 'B', from: 'Ali Raza <ali@two.com>', to: 'basit@acme.com', userRepliedThread: true }),
      mail('2026-11-01', { threadId: 'c', subject: 'C', from: '"Puyol, Hector" <h.puyol@sap.com>', to: 'basit@acme.com', userRepliedThread: true }),
    ], ctx);
    expect(titlesOf(two, 'person')).toEqual(['Ali Raza', 'Ali Raza (two.com)', 'Hector Puyol']);
  });

  // docs/Wiki-Knowledge.md §0.7 standard 2: people are one on evidence, never on a matching name alone.
  it('does not merge a work address and a personal one on the name alone: two notes that point at each other', () => {
    const notes = buildNotes([
      mail('2026-11-01', { threadId: 'a', subject: 'A', from: 'Sara Malik <sara.malik@one.com>', to: 'basit@acme.com', userRepliedThread: true }),
      mail('2026-11-02', { threadId: 'b', subject: 'B', from: 'Sara Malik <smalik88@gmail.com>', to: 'basit@acme.com', userRepliedThread: true }),
    ], ctx);
    expect(titlesOf(notes, 'person')).toEqual(['Sara Malik', 'Sara Malik (gmail.com)']);
    const work = find(notes, 'person', 'Sara Malik')!;
    const personal = find(notes, 'person', 'Sara Malik (gmail.com)')!;
    expect(work.ids).toEqual(['email:sara.malik@one.com']);
    expect(personal.ids).toEqual(['email:smalik88@gmail.com']);
    expect(work.body).toContain('**Possibly the same person:** [[Sara Malik (gmail.com)]]');
    expect(personal.body).toContain('**Possibly the same person:** [[Sara Malik]]');
  });

  it('merges on evidence: the same mailbox name, the same organisation, or the user\'s word', () => {
    const items = [
      mail('2026-11-01', { threadId: 'a', subject: 'A', from: 'Omar Zaid <omar.zaid@one.com>', to: 'basit@acme.com', userRepliedThread: true }),
      mail('2026-11-02', { threadId: 'b', subject: 'B', from: 'Omar Zaid <omar.zaid@gmail.com>', to: 'basit@acme.com', userRepliedThread: true }),
      mail('2026-11-03', { threadId: 'c', subject: 'C', from: 'Hina Shah <hina@one.com>', to: 'basit@acme.com', userRepliedThread: true }),
      mail('2026-11-04', { threadId: 'd', subject: 'D', from: 'Hina Shah <h.shah@one.com>', to: 'basit@acme.com', userRepliedThread: true }),
      mail('2026-11-05', { threadId: 'e', subject: 'E', from: 'Sara Malik <sara.malik@one.com>', to: 'basit@acme.com', userRepliedThread: true }),
      mail('2026-11-06', { threadId: 'f', subject: 'F', from: 'Sara Malik <smalik88@gmail.com>', to: 'basit@acme.com', userRepliedThread: true }),
    ];
    const plain = buildNotes(items, ctx);
    // Same mailbox name (omar.zaid@…) and same organisation (two one.com addresses): one note each.
    expect([...find(plain, 'person', 'Omar Zaid')!.ids!].sort()).toEqual(['email:omar.zaid@gmail.com', 'email:omar.zaid@one.com']);
    expect([...find(plain, 'person', 'Hina Shah')!.ids!].sort()).toEqual(['email:h.shah@one.com', 'email:hina@one.com']);
    expect(titlesOf(plain, 'person')).toEqual(['Hina Shah', 'Omar Zaid', 'Sara Malik', 'Sara Malik (gmail.com)']);
    // He said the two Sara Maliks are one person: from then on they are built as one.
    const confirmed = buildNotes(items, { ...ctx, confirmedSame: [['email:sara.malik@one.com', 'email:smalik88@gmail.com']] });
    expect(titlesOf(confirmed, 'person')).toEqual(['Hina Shah', 'Omar Zaid', 'Sara Malik']);
    expect([...find(confirmed, 'person', 'Sara Malik')!.ids!].sort()).toEqual(['email:sara.malik@one.com', 'email:smalik88@gmail.com']);
    expect(find(confirmed, 'person', 'Sara Malik')!.body).not.toContain('Possibly the same person');
  });

  it('gives a meeting its calendar series as its identity: instances of one series, one id', () => {
    const notes = buildNotes([
      cal('2026-11-03', { eventId: 'abc123_20261103T050000Z', title: 'Weekly sync', attendees: 'hina@one.com', organizer: 'basit@acme.com' }),
      cal('2026-11-10', { eventId: 'abc123_20261110T050000Z', title: 'Weekly sync', attendees: 'hina@one.com', organizer: 'basit@acme.com' }),
    ], ctx);
    expect(find(notes, 'meeting', 'Weekly sync')!.ids).toEqual(['event:abc123']);
  });

  it('one calendar series is one meeting note, titled as it was last held, even when its title changed', () => {
    const notes = buildNotes([
      cal('2026-11-11', { eventId: 'uat9_20261111T100000Z', title: 'UAT Session (Wednesday 11th)', attendees: 'hina@one.com', organizer: 'basit@acme.com' }),
      cal('2026-11-12', { eventId: 'uat9_20261112T100000Z', title: 'UAT Session (Thursday 12th)', attendees: 'hina@one.com, omar@one.com', organizer: 'basit@acme.com' }),
    ], ctx);
    expect(titlesOf(notes, 'meeting')).toEqual(['UAT Session (Thursday 12th)']);
    const m = find(notes, 'meeting', 'UAT Session (Thursday 12th)')!;
    expect(m.ids).toEqual(['event:uat9']);
    expect(m.properties).toMatchObject({ occurrences: 2 });
    // Every link in every note still points at a note that was built.
    const titles = new Set(notes.map((n) => n.title.toLowerCase()));
    for (const n of notes) for (const l of extractWikiLinks(n.body)) expect(titles.has(l.key), `${n.title} -> ${l.key}`).toBe(true);
  });

  it('gives a company and a standing group their outside identifiers', () => {
    const notes = buildNotes([
      mail('2026-11-01', { threadId: 'a', subject: 'A', from: 'Hina Shah <hina@one.com>', to: 'basit@acme.com', userRepliedThread: true }),
      chat('2026-11-02', { spaceName: 'spaces/AAA', spaceDisplayName: 'Deals', spaceType: 'SPACE', senderDisplayName: 'Hina Shah', text: 'one' }),
      chat('2026-11-03', { spaceName: 'spaces/AAA', spaceDisplayName: 'Deals', spaceType: 'SPACE', senderDisplayName: 'Hina Shah', text: 'two' }),
    ], ctx);
    expect(find(notes, 'company', 'one.com')!.ids).toEqual(['domain:one.com']);
    // A company cites what its people were learned from.
    expect(find(notes, 'company', 'one.com')!.sourceIds!.length).toBeGreaterThan(0);
    expect(find(notes, 'company', 'one.com')!.sourceIds).toEqual(expect.arrayContaining(find(notes, 'person', 'Hina Shah')!.sourceIds!));
    const group = notes.find((x) => x.type === 'group');
    if (group) expect(group.ids).toEqual(['space:spaces/AAA']);
  });
});
