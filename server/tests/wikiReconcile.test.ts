/**
 * Wiki reconcile — a missed landing recovers by itself, and the feed store
 * lets go of nothing the Wiki does not hold (docs/Wiki-Knowledge.md §0.1.2, §6b A1).
 *
 * Against an in-memory feed store and source store:
 *  - an item whose landing was interrupted is found and landed on the next run;
 *  - a run that finds nothing missing writes nothing;
 *  - a landing that fails again is counted, and lands on a later run;
 *  - several stored rows of one item are one source;
 *  - a source held without its text is completed;
 *  - an email's full text held only by an old email page is landed, once;
 *  - the pruner's question (`holdsFeedItem`) is no until the source is held,
 *    and a dry run writes nothing;
 *  - the pruner keeps a row the Wiki does not hold.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const t = vi.hoisted(() => ({
  feed: [] as any[],
  emailPages: [] as any[],
  store: new Map<string, { body: string; input: any }>(),
  saves: 0,
  failNext: 0,
  deleted: [] as string[],
  scribed: true,
}));

vi.mock('../src/db/prisma', () => {
  const p: any = {
    feedEvent: {
      findMany: async ({ where, take }: any) => {
        let rows = t.feed.filter((r) => r.clientNumber === where.clientNumber && r.userId === where.userId);
        if (where.id?.gt !== undefined) rows = rows.filter((r) => r.id > where.id.gt).sort((a, b) => (a.id < b.id ? -1 : 1));
        if (where.sourceType) rows = rows.filter((r) => r.sourceType === where.sourceType);
        return rows.slice(0, take ?? rows.length);
      },
      delete: async ({ where }: any) => { t.deleted.push(where.id); t.feed = t.feed.filter((r) => r.id !== where.id); },
    },
    decisionLog: { findMany: async () => [] },
    $queryRawUnsafe: async (sql: string, _c: string, _u: number, only?: string | null) => {
      if (/page_type = 'email_message'/.test(sql) && /LEFT JOIN wiki_sources/.test(sql)) {
        // The reconcile query: pages whose text the source does not hold. `have` is recomputed from the store.
        return t.emailPages
          .filter((pg) => !only || pg.metadata.gmailMessageId === only)
          .map((pg) => {
            const held = [...t.store.values()].find((s) => s.input.kind === 'email' && s.input.externalId === pg.metadata.gmailMessageId);
            return { body_markdown: pg.body_markdown, metadata: pg.metadata, last_updated_at: new Date('2026-11-01T00:00:00Z'), have: held ? [...held.body].length : null };
          });
      }
      if (/page_type = 'email_message'/.test(sql)) return t.scribed ? [{ id: 'page' }] : []; // the pruner's scribe check
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { __esModule: true, default: p, prisma: p };
});

vi.mock('../src/services/wiki/wikiSources', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    saveSource: async (input: any) => {
      if (t.failNext > 0) { t.failNext -= 1; throw new Error('database went away'); }
      t.saves += 1;
      const id = real.sourceId(input.clientNumber, input.userId, input.kind, String(input.externalId).trim());
      const had = t.store.get(id);
      const text = typeof input.body === 'string' ? input.body.trim() : '';
      const keep = had && had.body && (!text || input.preview);
      t.store.set(id, { body: keep ? had!.body : text, input: { ...had?.input, ...input } });
      return { id, created: !had };
    },
    sourcesHeld: async (clientNumber: string, userId: number, ids: string[]) =>
      new Map(ids
        .filter((id) => t.store.has(id) && t.store.get(id)!.input.clientNumber === clientNumber && t.store.get(id)!.input.userId === userId)
        .map((id) => [id, { hasText: t.store.get(id)!.body.length > 0 }])),
  };
});

import { reconcileSources, holdsFeedItem } from '../src/services/wiki/wikiBackfill';
import { landFeedItem } from '../src/services/wiki/wikiIntake';
import { sourceId } from '../src/services/wiki/wikiSources';
import { pruneUserFeedEvents } from '../src/services/maintenance/queueArchiveMaintenanceService';

const OLD = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
let seq = 0;
const feedRow = (sourceType: string, sourceIdValue: string, rawPayload: Record<string, any>, createdAt = OLD) => {
  const row = { id: `fe${String(++seq).padStart(3, '0')}`, clientNumber: 'T-1', userId: 2, sourceType, sourceId: sourceIdValue, rawPayload, eventAt: null, createdAt };
  t.feed.push(row);
  return row;
};
const asItem = (r: any) => ({ id: r.id, clientNumber: r.clientNumber, userId: r.userId, sourceType: r.sourceType, sourceId: r.sourceId, payload: r.rawPayload, at: r.createdAt });
const idFor = (kind: string, ext: string) => sourceId('T-1', 2, kind, ext);

beforeEach(() => {
  t.feed = []; t.emailPages = []; t.store = new Map(); t.saves = 0; t.failNext = 0; t.deleted = []; t.scribed = true; seq = 0;
});

describe('wiki reconcile', () => {
  it('an interrupted landing is found and landed on the next run; a clean run writes nothing', async () => {
    const a = feedRow('gchat', 'spaces/1/messages/1', { messageName: 'spaces/1/messages/1', text: 'one' });
    const b = feedRow('gchat', 'spaces/1/messages/2', { messageName: 'spaces/1/messages/2', text: 'two' });
    const c = feedRow('gmail', 'm3', { subject: 'Three', snippet: 'three…', threadId: 'th' });
    await landFeedItem(asItem(a));
    t.failNext = 1; // the server went away while b was landing
    await expect(landFeedItem(asItem(b))).rejects.toThrow();
    await landFeedItem(asItem(c));
    expect(t.store.has(idFor('chat', 'spaces/1/messages/2'))).toBe(false);

    const first = await reconcileSources('T-1', 2);
    expect(first).toMatchObject({ feedItems: 3, missing: 1, landed: 1, failed: 0 });
    expect(t.store.get(idFor('chat', 'spaces/1/messages/2'))!.body).toBe('two');

    const saves = t.saves;
    const second = await reconcileSources('T-1', 2);
    expect(second).toMatchObject({ feedItems: 3, missing: 0, landed: 0, failed: 0 });
    expect(t.saves).toBe(saves);
  });

  it('a landing that fails again is counted and named, and lands on a later run', async () => {
    feedRow('whatsapp', 'w1', { waMessageId: 'w1', body: 'hello' });
    t.failNext = 1;
    const first = await reconcileSources('T-1', 2);
    expect(first).toMatchObject({ missing: 1, landed: 0, failed: 1 });
    expect(first.errors[0]).toMatch(/database went away/);
    const second = await reconcileSources('T-1', 2);
    expect(second).toMatchObject({ missing: 1, landed: 1, failed: 0 });
  });

  it('several stored rows of one item are one source, and its text is not lost to a later blank row', async () => {
    feedRow('gcal', 'e1', { eventId: 'e1', start: '2026-11-14T10:00:00+05:00', title: 'Sync', description: 'Agenda' }, new Date('2026-11-01T00:00:00Z'));
    feedRow('gcal', 'e1', { eventId: 'e1', start: '2026-11-14T10:00:00+05:00', title: 'Sync (moved room)' }, new Date('2026-11-02T00:00:00Z'));
    const r = await reconcileSources('T-1', 2);
    expect(r).toMatchObject({ feedItems: 2, missing: 1, landed: 1 });
    expect(t.store.size).toBe(1);
    expect([...t.store.values()][0].body).toBe('Agenda');
  });

  it('a source held without its text is completed', async () => {
    const row = feedRow('gchat', 'spaces/1/messages/9', { messageName: 'spaces/1/messages/9', text: 'the text' });
    t.store.set(idFor('chat', 'spaces/1/messages/9'), { body: '', input: { clientNumber: 'T-1', userId: 2, kind: 'chat', externalId: 'spaces/1/messages/9' } });
    expect(await holdsFeedItem(asItem(row))).toBe(false);
    const r = await reconcileSources('T-1', 2);
    expect(r).toMatchObject({ missing: 1, landed: 1 });
    expect(t.store.get(idFor('chat', 'spaces/1/messages/9'))!.body).toBe('the text');
  });

  it('a feed type the Wiki does not know is not counted as missing', async () => {
    feedRow('fax', 'f1', { text: 'x' });
    expect(await reconcileSources('T-1', 2)).toMatchObject({ feedItems: 1, missing: 0, landed: 0, failed: 0 });
  });

  it('an email\'s full text held only by an old email page is landed, once, and a pruned email is recreated', async () => {
    const row = feedRow('gmail', 'm1', { subject: 'Pricing', snippet: 'Hi…', threadId: 'th1' });
    await landFeedItem(asItem(row)); // preview only
    t.emailPages.push({ body_markdown: '# Pricing\n\n## Body\nHi Ali, the full offer is attached. 🙂\n', metadata: { gmailMessageId: 'm1', threadId: 'th1', subject: 'Pricing' } });
    t.emailPages.push({ body_markdown: '# Old\n\n## Body\nAn email whose feed row is gone.', metadata: { gmailMessageId: 'm0', subject: 'Old' } });
    t.emailPages.push({ body_markdown: '# No body section', metadata: { gmailMessageId: 'm9' } });

    const first = await reconcileSources('T-1', 2);
    expect(first).toMatchObject({ emailTexts: 2, failed: 0 });
    expect(t.store.get(idFor('email', 'm1'))!.body).toBe('Hi Ali, the full offer is attached. 🙂');
    expect(t.store.get(idFor('email', 'm0'))!.body).toBe('An email whose feed row is gone.');
    expect(t.store.has(idFor('email', 'm9'))).toBe(false);

    const saves = t.saves;
    expect(await reconcileSources('T-1', 2)).toMatchObject({ missing: 0, emailTexts: 0 });
    expect(t.saves).toBe(saves);
  });

  it('holdsFeedItem: no until the Wiki holds the item; a dry check writes nothing; a repair lands it', async () => {
    const row = feedRow('gmail', 'm5', { subject: 'Offer', snippet: 'short…' });
    t.emailPages.push({ body_markdown: '## Head\n\n## Body\nThe whole email text.', metadata: { gmailMessageId: 'm5' } });
    expect(await holdsFeedItem(asItem(row))).toBe(false);
    expect(t.saves).toBe(0);

    await landFeedItem(asItem(row)); // the preview alone is not enough while a page holds more
    expect(await holdsFeedItem(asItem(row))).toBe(false);

    t.failNext = 5;
    t.store.clear();
    expect(await holdsFeedItem(asItem(row), { repair: true })).toBe(false); // cannot be repaired: still no
    t.failNext = 0;

    expect(await holdsFeedItem(asItem(row), { repair: true })).toBe(true);
    expect(t.store.get(idFor('email', 'm5'))!.body).toBe('The whole email text.');
    expect(await holdsFeedItem(asItem(row))).toBe(true);
  });

  it('the pruner keeps a row the Wiki does not hold, and deletes it once it does', async () => {
    feedRow('gmail', 'm7', { subject: 'Old mail', snippet: 'old…' });
    const dry = await pruneUserFeedEvents('T-1', 2, { apply: false });
    expect(dry).toMatchObject({ scanned: 1, blockedNoSource: 1, deleted: 0 });
    expect(t.saves).toBe(0);

    t.failNext = 5; // the Wiki cannot take it
    const blocked = await pruneUserFeedEvents('T-1', 2, { apply: true });
    expect(blocked).toMatchObject({ blockedNoSource: 1, deleted: 0 });
    expect(t.deleted).toEqual([]);
    expect(t.feed).toHaveLength(1);

    t.failNext = 0; // the Wiki is back: the pruner lands the item first, then lets the row go
    const done = await pruneUserFeedEvents('T-1', 2, { apply: true });
    expect(done).toMatchObject({ blockedNoSource: 0, deleted: 1 });
    expect(t.deleted).toEqual(['fe001']);
    expect(t.store.get(idFor('email', 'm7'))!.body).toBe('old…');
  });
});
