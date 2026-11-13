/**
 * Wiki store — the one door into and out of the wiki (docs/Wiki-Knowledge.md).
 *
 * Under test, against an in-memory stand-in for the three wiki tables:
 *  - links are read from the note text and become link rows;
 *  - rewriting a note rebuilds its links (a removed link disappears);
 *  - a link to a note that does not exist yet is unresolved, and becomes a
 *    real link when that note is written;
 *  - backlinks are returned on read;
 *  - a link never reaches another user's private note;
 *  - properties merge, and a source is cited once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const t = vi.hoisted(() => ({ pages: [] as any[], links: [] as any[], sources: [] as any[], seq: 0 }));

vi.mock('../src/db/prisma', () => {
  const eq = (a: string, f: any) =>
    typeof f === 'string' ? a === f : f.mode === 'insensitive' ? a.toLowerCase() === f.equals.toLowerCase() : a === f.equals;
  const match = (p: any, w: any): boolean =>
    Object.entries(w ?? {}).every(([k, v]: [string, any]) => {
      if (k === 'AND') return v.every((c: any) => match(p, c));
      if (k === 'OR') return v.some((c: any) => match(p, c));
      if (k === 'title') return eq(p.title, v);
      if (k === 'id' && v && typeof v === 'object') return p.id !== v.not;
      if (k === 'metadata') return (p.metadata?.[v.path[0]] ?? []).includes(v.array_contains[0]);
      return p[k] === v;
    });
  const page = (id: string) => t.pages.find((p) => p.id === id);
  const linkMatch = (l: any, w: any) =>
    Object.entries(w ?? {}).every(([k, v]: [string, any]) =>
      k === 'fromPage' ? match(page(l.fromPageId), v) : k === 'toPage' ? match(page(l.toPageId), v) : l[k] === v,
    );
  const p: any = {
    wikiPage: {
      findUnique: async ({ where }: any) => page(where.id) ?? null,
      findFirst: async ({ where }: any) => t.pages.find((x) => match(x, where)) ?? null,
      findMany: async ({ where }: any) => t.pages.filter((x) => match(x, where)),
      create: async ({ data }: any) => {
        const row = { id: `p${++t.seq}`, scope: 'user', inboundLinks: 0, outboundLinks: 0, sourceCount: 0, ...data };
        t.pages.push(row);
        return row;
      },
      update: async ({ where, data }: any) => Object.assign(page(where.id), data),
    },
    wikiPageLink: {
      findMany: async ({ where }: any) =>
        t.links.filter((l) => linkMatch(l, where)).map((l) => ({ ...l, fromPage: page(l.fromPageId), toPage: page(l.toPageId) })),
      deleteMany: async ({ where }: any) => {
        t.links = t.links.filter((l) => !linkMatch(l, where));
      },
      createMany: async ({ data }: any) => {
        for (const d of data)
          if (!t.links.some((l) => l.fromPageId === d.fromPageId && l.toPageId === d.toPageId && l.linkType === d.linkType)) t.links.push(d);
      },
      count: async ({ where }: any) => t.links.filter((l) => linkMatch(l, where)).length,
    },
    wikiPageSource: {
      findFirst: async ({ where }: any) => t.sources.find((s) => Object.entries(where).every(([k, v]) => s[k] === v)) ?? null,
      create: async ({ data }: any) => t.sources.push(data),
      count: async ({ where }: any) => t.sources.filter((s) => s.wikiPageId === where.wikiPageId).length,
    },
  };
  return { __esModule: true, default: p, prisma: p };
});

import { writeNote, getNote, adoptAsNote, WIKILINK } from '../src/services/wiki/wikiStore';
import { renderRecordBody } from '../src/services/integrations/engine/contextWriter';

const base = { clientNumber: 'T-1', userId: 1, actor: 'test' };
const titles = (refs: Array<{ title: string }>) => refs.map((r) => r.title);

beforeEach(() => {
  t.pages = [];
  t.links = [];
  t.sources = [];
  t.seq = 0;
});

describe('wikiStore', () => {
  it('turns [[links]] in the text into links, and returns backlinks on read', async () => {
    await writeNote({ ...base, type: 'person', title: 'Ali Khan', body: 'Buyer.' });
    const w = await writeNote({ ...base, type: 'project', title: 'Project X', body: 'Led by [[ali khan]] and [[Ali Khan|Ali]].' });
    expect(w).toMatchObject({ created: true, linked: 1, unresolved: [] });
    expect(t.links).toHaveLength(1);
    expect(t.links[0].linkType).toBe(WIKILINK);

    const ali = await getNote('T-1', 1, { title: 'ALI KHAN' });
    expect(titles(ali!.backlinks)).toEqual(['Project X']);
    expect(ali!.links).toEqual([]);
    const px = await getNote('T-1', 1, { id: w.id });
    expect(titles(px!.links)).toEqual(['Ali Khan']);
    expect(t.pages.find((p) => p.title === 'Ali Khan').inboundLinks).toBe(1);
    expect(t.pages.find((p) => p.title === 'Project X').outboundLinks).toBe(1);
  });

  it('rebuilds links on rewrite: a link removed from the text is removed', async () => {
    await writeNote({ ...base, type: 'person', title: 'Ali Khan', body: '' });
    await writeNote({ ...base, type: 'person', title: 'Sara', body: '' });
    await writeNote({ ...base, type: 'topic', title: 'Pricing', body: '[[Ali Khan]] and [[Sara]]' });
    const w = await writeNote({ ...base, type: 'topic', title: 'Pricing', body: 'Only [[Sara]] now.' });
    expect(w.created).toBe(false);
    expect(titles((await getNote('T-1', 1, { title: 'Pricing' }))!.links)).toEqual(['Sara']);
    expect(t.pages.find((p) => p.title === 'Ali Khan').inboundLinks).toBe(0);
    expect(t.pages).toHaveLength(3);
  });

  it('keeps a link to a missing note as unresolved, and links it when that note is written', async () => {
    const w = await writeNote({ ...base, type: 'meeting', title: 'Kick-off', body: 'With [[Omar Farooq]].' });
    expect(w).toMatchObject({ linked: 0, unresolved: ['omar farooq'] });
    expect(t.links).toHaveLength(0);

    await writeNote({ ...base, type: 'person', title: 'Omar Farooq', body: '' });
    const omar = await getNote('T-1', 1, { title: 'Omar Farooq' });
    expect(titles(omar!.backlinks)).toEqual(['Kick-off']);
    expect((await getNote('T-1', 1, { title: 'Kick-off' }))!.unresolved).toEqual([]);
  });

  it('never links to, or reads, another user\'s private note; a shared note is reachable', async () => {
    await writeNote({ ...base, userId: 2, type: 'person', title: 'Secret Contact', body: '' });
    await writeNote({ ...base, userId: 2, type: 'policy', title: 'Leave Policy', body: '', scope: 'tenant' });
    const w = await writeNote({ ...base, type: 'topic', title: 'Notes', body: '[[Secret Contact]] [[Leave Policy]]' });
    expect(w).toMatchObject({ linked: 1, unresolved: ['secret contact'] });
    expect(await getNote('T-1', 1, { title: 'Secret Contact' })).toBeNull();
    expect(titles((await getNote('T-1', 1, { title: 'Leave Policy' }))!.backlinks)).toEqual(['Notes']);
    // The other user does not see user 1's private note as a backlink.
    expect((await getNote('T-1', 2, { title: 'Leave Policy' }))!.backlinks).toEqual([]);
  });

  it('ignores links inside code and a note linking to itself', async () => {
    await writeNote({ ...base, type: 'person', title: 'Ali Khan', body: '' });
    const w = await writeNote({ ...base, type: 'topic', title: 'Syntax', body: 'Write `[[Ali Khan]]`.\n```\n[[Ali Khan]]\n```\n[[Syntax]]' });
    expect(w).toMatchObject({ linked: 0, unresolved: [] });
  });

  it('merges properties (null removes a key) and cites a source once', async () => {
    const src = [{ feedEventId: 'fe-1' }];
    await writeNote({ ...base, type: 'person', title: 'Ali Khan', body: '', properties: { email: 'a@x.com', phone: '+92' }, sources: src });
    await writeNote({ ...base, type: 'person', title: 'Ali Khan', body: '', properties: { company: 'Acme', phone: null }, sources: src });
    const ali = await getNote('T-1', 1, { title: 'Ali Khan' });
    expect(ali!.properties).toEqual({ email: 'a@x.com', company: 'Acme' });
    expect(t.sources).toHaveLength(1);
    // Every note carries the mark that tells it from an older page.
    expect(t.pages[0].metadata.wiki).toBe(2);
    expect(t.pages[0].sourceCount).toBe(1);
  });

  it('takes an integration record page into the wiki: marked as a note and linked to the note it is about', async () => {
    await writeNote({ ...base, type: 'person', title: 'Salman Sohail', body: '' });
    const body = renderRecordBody('TMC Employee Directory', 'Salman Sohail', [['department', 'Delivery'], ['title', 'Director']]);
    expect(body).toContain('**About:** [[Salman Sohail]]');
    // The integration writer stores the page itself and replaces its metadata on every write.
    t.pages.push({
      id: 'rec1', clientNumber: 'T-1', userId: 1, pageType: 'org_doc', scope: 'tenant', status: 'active',
      title: 'TMC Employee Directory · Salman Sohail', bodyMarkdown: body, metadata: { integrationId: 'i1', recordKey: 'i1:7' },
      inboundLinks: 0, outboundLinks: 0, lastUpdatedAt: new Date(),
    });
    expect(await adoptAsNote('rec1')).toEqual({ linked: 1, unresolved: [] });
    const rec = t.pages.find((p) => p.id === 'rec1');
    expect(rec.metadata).toMatchObject({ wiki: 2, integrationId: 'i1', recordKey: 'i1:7' });
    expect(titles((await getNote('T-1', 1, { title: 'Salman Sohail' }))!.backlinks)).toEqual(['TMC Employee Directory · Salman Sohail']);
    // Another user of the company can read the shared record.
    expect((await getNote('T-1', 2, { id: 'rec1' }))!.title).toBe('TMC Employee Directory · Salman Sohail');
    // A record about someone with no note yet waits, and connects when the note is written.
    t.pages.push({
      id: 'rec2', clientNumber: 'T-1', userId: 1, pageType: 'org_doc', scope: 'tenant', status: 'active',
      title: 'TMC Employee Directory · Abdul Rafay', bodyMarkdown: renderRecordBody('TMC Employee Directory', 'Abdul Rafay', [['department', 'HR']]),
      metadata: {}, inboundLinks: 0, outboundLinks: 0, lastUpdatedAt: new Date(),
    });
    expect(await adoptAsNote('rec2')).toEqual({ linked: 0, unresolved: ['abdul rafay'] });
    await writeNote({ ...base, type: 'person', title: 'Abdul Rafay', body: '' });
    expect(titles((await getNote('T-1', 1, { title: 'Abdul Rafay' }))!.backlinks)).toEqual(['TMC Employee Directory · Abdul Rafay']);
    expect(await adoptAsNote('missing')).toBeNull();
  });

  it('refuses a note with no title', async () => {
    await expect(writeNote({ ...base, type: 'topic', title: '   ', body: '' })).rejects.toThrow(/title/);
  });
});
