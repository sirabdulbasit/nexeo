/**
 * Wiki citations — who may cite what (docs/Wiki-Knowledge.md §0.1.6, §0.7 standard 3).
 *
 * A citation is checked where it is written:
 *  - never across clients;
 *  - one user's own source is never cited by another user's note;
 *  - one user's own source is never cited by a shared note, and the shared
 *    note's text is not written either;
 *  - a source that does not exist is not evidence;
 *  - one refused source refuses the whole write: nothing is cited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const t = vi.hoisted(() => ({
  notes: [] as any[], sources: [] as any[], citations: [] as Array<{ noteId: string; sourceId: string }>, created: [] as any[],
}));

vi.mock('../src/db/prisma', () => {
  const p: any = {
    $transaction: async (fn: any) => fn(p),
    // Both reads are confined to the caller's client, as the real queries are.
    $queryRawUnsafe: async (sql: string, a: any, b: any, c?: any) => {
      if (/FROM wiki_sources/.test(sql)) return t.sources.filter((s) => s.client_number === a && (b as string[]).includes(s.id));
      if (/FROM wiki_pages/.test(sql)) return t.notes.filter((n) => n.id === a && n.client_number === b && (n.scope === 'tenant' || n.user_id === c));
      throw new Error(`unexpected query: ${sql}`);
    },
    $executeRawUnsafe: async (sql: string, noteId: string, ids?: string[]) => {
      if (/INSERT INTO wiki_note_sources/.test(sql)) {
        for (const id of ids ?? []) if (!t.citations.some((c) => c.noteId === noteId && c.sourceId === id)) t.citations.push({ noteId, sourceId: id });
      }
      return 0;
    },
    wikiPage: {
      findFirst: async () => null,
      findMany: async () => [],
      create: async ({ data }: any) => { const row = { id: 'new', scope: 'user', ...data }; t.created.push(row); return row; },
      update: async () => ({}),
    },
    wikiPageLink: { findMany: async () => [], deleteMany: async () => ({}), createMany: async () => ({}), count: async () => 0 },
  };
  return { __esModule: true, default: p, prisma: p };
});

import { mayCite, assertCitable, citeSources, CitationRefused } from '../src/services/wiki/wikiSources';
import { writeNote } from '../src/services/wiki/wikiStore';

const note = (id: string, client: string, user: number, scope: string) => ({ id, client_number: client, user_id: user, scope });
const source = note;
const u1 = { clientNumber: 'T-1', userId: 1 };
const u2 = { clientNumber: 'T-1', userId: 2 };
const otherClient = { clientNumber: 'T-2', userId: 1 };

beforeEach(() => {
  t.notes = [note('n-mine', 'T-1', 1, 'user'), note('n-theirs', 'T-1', 2, 'user'), note('n-shared', 'T-1', 1, 'tenant'), note('n-other-client', 'T-2', 1, 'user')];
  t.sources = [source('s-mine', 'T-1', 1, 'user'), source('s-company', 'T-1', 1, 'tenant'), source('s-mine-2', 'T-1', 1, 'user')];
  t.citations = [];
  t.created = [];
});

describe('wiki citations', () => {
  it('rule: same client always; a private source only by its own user\'s private note', () => {
    const mine = { clientNumber: 'T-1', userId: 1, scope: 'user' };
    const company = { clientNumber: 'T-1', userId: 1, scope: 'tenant' };
    expect(mayCite(mine, mine)).toBe(true);
    expect(mayCite(mine, company)).toBe(true);
    expect(mayCite({ ...mine, userId: 2 }, company)).toBe(true);
    expect(mayCite(company, company)).toBe(true);
    expect(mayCite({ ...mine, userId: 2 }, mine)).toBe(false); // another user's private source
    expect(mayCite(company, mine)).toBe(false); // private into shared
    expect(mayCite({ ...mine, clientNumber: 'T-2' }, mine)).toBe(false); // across clients
    expect(mayCite({ ...mine, clientNumber: 'T-2' }, company)).toBe(false); // across clients, even company knowledge
  });

  it('a note cites its own user\'s sources and the company\'s, each once', async () => {
    await citeSources(u1, 'n-mine', ['s-mine', 's-company', 's-mine']);
    await citeSources(u1, 'n-mine', ['s-mine']);
    expect(t.citations).toEqual([{ noteId: 'n-mine', sourceId: 's-mine' }, { noteId: 'n-mine', sourceId: 's-company' }]);
  });

  it('refuses a citation across clients', async () => {
    await expect(citeSources(otherClient, 'n-other-client', ['s-company'])).rejects.toBeInstanceOf(CitationRefused);
    expect(t.citations).toEqual([]);
  });

  it('refuses another user\'s private source', async () => {
    await expect(citeSources(u2, 'n-theirs', ['s-mine'])).rejects.toBeInstanceOf(CitationRefused);
    expect(t.citations).toEqual([]);
  });

  it('refuses a private source on a shared note', async () => {
    await expect(citeSources(u1, 'n-shared', ['s-mine'])).rejects.toBeInstanceOf(CitationRefused);
    expect(t.citations).toEqual([]);
  });

  it('refuses a source that does not exist, and names it', async () => {
    const err = await assertCitable({ clientNumber: 'T-1', userId: 1, scope: 'user' }, ['s-mine', 's-gone']).catch((e) => e);
    expect(err).toBeInstanceOf(CitationRefused);
    expect(err.refused).toEqual(['s-gone']);
  });

  it('one refused source refuses them all: nothing is cited', async () => {
    await expect(citeSources(u1, 'n-shared', ['s-company', 's-mine'])).rejects.toBeInstanceOf(CitationRefused);
    expect(t.citations).toEqual([]);
  });

  it('refuses a note that does not exist', async () => {
    await expect(citeSources(u1, 'n-none', ['s-mine'])).rejects.toThrow(/no note/);
  });

  it('a writer cannot cite into another user\'s private note, or into a note of another client', async () => {
    await expect(citeSources(u1, 'n-theirs', ['s-company'])).rejects.toThrow(/no note/);
    await expect(citeSources(u1, 'n-other-client', ['s-company'])).rejects.toThrow(/no note/);
    expect(t.citations).toEqual([]);
  });

  it('any user of the client may cite company knowledge into a shared note', async () => {
    await citeSources(u2, 'n-shared', ['s-company']);
    expect(t.citations).toEqual([{ noteId: 'n-shared', sourceId: 's-company' }]);
  });

  it('writeNote: a shared note learned from a private source is not written at all', async () => {
    await expect(
      writeNote({ clientNumber: 'T-1', userId: 1, type: 'company', title: 'Acme', body: 'From his mail.', scope: 'tenant', sourceIds: ['s-mine'], actor: 'test' }),
    ).rejects.toBeInstanceOf(CitationRefused);
    expect(t.created).toEqual([]);
    expect(t.citations).toEqual([]);
  });

  it('writeNote: a private note learned from the same user\'s sources is written and cited', async () => {
    t.notes.push(note('new', 'T-1', 1, 'user'));
    const r = await writeNote({ clientNumber: 'T-1', userId: 1, type: 'person', title: 'Ali', body: 'Buyer.', sourceIds: ['s-mine', 's-mine-2'], actor: 'test' });
    expect(r.created).toBe(true);
    expect(t.citations.map((c) => c.sourceId)).toEqual(['s-mine', 's-mine-2']);
  });
});
