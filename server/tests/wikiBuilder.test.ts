/**
 * Wiki builder — stored feed items in, linked notes out (docs/BRAIN_WIKI.md §6 step 2).
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
    expect(find(notes, 'person', 'Hina Shah')!.sources).toHaveLength(1);
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
});
