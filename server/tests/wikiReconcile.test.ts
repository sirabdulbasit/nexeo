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
  store: new Map<string, { body: string; input: any; asOf?: Date | null; isPreview?: boolean }>(),
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
        // The reconcile query: email pages whose source is missing, has no text, or holds only a preview.
        return t.emailPages
          .filter((pg) => !only || pg.metadata.gmailMessageId === only)
          .filter((pg) => {
            const held = [...t.store.values()].find((s) => s.input.kind === 'email' && s.input.externalId === pg.metadata.gmailMessageId);
            return !held || !held.body || held.isPreview === true;
          })
          .map((pg) => {
            const held = [...t.store.values()].find((s) => s.input.kind === 'email' && s.input.externalId === pg.metadata.gmailMessageId);
            return { body_markdown: pg.body_markdown, metadata: pg.metadata, last_updated_at: new Date('2026-11-01T00:00:00Z'), held_hash: held?.body ? sourceTextHash(held.body) : null };
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
    // The same decision the real store makes (`keepsHeldText`), on an in-memory row.
    saveSource: async (input: any) => {
      if (t.failNext > 0) { t.failNext -= 1; throw new Error('database went away'); }
      t.saves += 1;
      const id = real.sourceId(input.clientNumber, input.userId, input.kind, String(input.externalId).trim());
      const had = t.store.get(id);
      const text = real.textOf(input.body);
      const hash = text ? real.textHash(text) : null;
      const asOf = input.asOf ?? new Date();
      const held = had ? { hasText: had.body.length > 0, hash: had.body ? real.textHash(had.body) : null, asOf: had.asOf ?? null, isPreview: had.isPreview === true } : null;
      const keep = real.keepsHeldText(held, { hash, asOf, isPreview: !!text && input.preview === true });
      t.store.set(id, {
        body: keep ? had?.body ?? '' : text,
        asOf: keep ? had?.asOf ?? null : asOf,
        isPreview: keep ? had?.isPreview === true : !!text && input.preview === true,
        input: { ...had?.input, ...input },
      });
      return { id, created: !had, textReplaced: !keep && !!had?.body };
    },
    sourcesHeld: async (clientNumber: string, userId: number, ids: string[]) =>
      new Map(ids
        .filter((id) => t.store.has(id) && t.store.get(id)!.input.clientNumber === clientNumber && t.store.get(id)!.input.userId === userId)
        .map((id) => {
          const row = t.store.get(id)!;
          return [id, { hasText: row.body.length > 0, hash: row.body ? real.textHash(row.body) : null, asOf: row.asOf ?? null, isPreview: row.isPreview === true }];
        })),
  };
});

import { reconcileSources, holdsFeedItem, needsLanding } from '../src/services/wiki/wikiBackfill';
import { landFeedItem, landEmailText } from '../src/services/wiki/wikiIntake';
import { sourceId, textHash as sourceTextHash } from '../src/services/wiki/wikiSources';
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
    feedRow('gchat', 'spaces/1/messages/7', { messageName: 'spaces/1/messages/7', text: 'hello' });
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

  it('a feed type the Wiki does not take (WhatsApp, or one it does not know) is not counted as missing and not landed', async () => {
    feedRow('fax', 'f1', { text: 'x' });
    feedRow('whatsapp', 'w1', { waMessageId: 'w1', body: 'hello' });
    expect(await reconcileSources('T-1', 2)).toMatchObject({ feedItems: 2, missing: 0, landed: 0, failed: 0 });
    expect(t.store.size).toBe(0);
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

  it('an email landed with no feed item (his sent mail) keeps its text, its people and its SENT label', async () => {
    await landEmailText({
      clientNumber: 'T-1', userId: 2, gmailMessageId: 'sent-1', threadId: 'th9', subject: 'Re: Quote',
      from: 'me@x.com', to: 'ali@y.com', cc: null, receivedAt: new Date('2026-11-13T05:00:00Z'), bodyText: 'Approved.', labels: ['SENT'],
    });
    const held = t.store.get(idFor('email', 'sent-1'))!;
    expect(held.body).toBe('Approved.');
    expect(held.input).toMatchObject({ kind: 'email', threadKey: 'th9', feedEventId: null });
    expect(held.input.details).toMatchObject({ from: 'me@x.com', to: 'ali@y.com', labels: ['SENT'] });
    // Without labels the field is absent, so a later landing never blanks the labels a feed item brought.
    await landEmailText({ clientNumber: 'T-1', userId: 2, gmailMessageId: 'in-1', receivedAt: new Date(), bodyText: 'x' });
    expect(t.store.get(idFor('email', 'in-1'))!.input.details).not.toHaveProperty('labels');
  });

  // Structure part 8: a source knows which version of its text it holds.
  it('a correction whose live landing failed is recovered, even at the same length', async () => {
    const first = feedRow('gcal', 'e9', { eventId: 'e9', start: '2026-11-20T10:00:00+05:00', title: 'Review', description: 'Room A' }, new Date('2026-11-10T00:00:00Z'));
    await landFeedItem({ ...asItem(first), fetchedAt: first.createdAt });
    // The organiser changes the room; the feed stores the new row, but its landing is lost.
    feedRow('gcal', 'e9', { eventId: 'e9', start: '2026-11-20T10:00:00+05:00', title: 'Review', description: 'Room B' }, new Date('2026-11-11T00:00:00Z'));
    const id = idFor('calendar', 'e9@2026-11-20T10:00:00+05:00');
    expect(t.store.get(id)!.body).toBe('Room A');
    expect(await reconcileSources('T-1', 2)).toMatchObject({ missing: 1, landed: 1 });
    expect(t.store.get(id)!.body).toBe('Room B');
    const saves = t.saves;
    expect(await reconcileSources('T-1', 2)).toMatchObject({ missing: 0, landed: 0 });
    expect(t.saves).toBe(saves);
  });

  it('a newer, shorter text replaces a longer one; an older text arriving late does not put the source back', async () => {
    const long = feedRow('gchat', 'spaces/1/messages/5', { messageName: 'spaces/1/messages/5', text: 'The meeting is on Thursday at ten, in the big room.' }, new Date('2026-11-10T00:00:00Z'));
    const short = feedRow('gchat', 'spaces/1/messages/5', { messageName: 'spaces/1/messages/5', text: 'Cancelled.' }, new Date('2026-11-12T00:00:00Z'));
    const id = idFor('chat', 'spaces/1/messages/5');
    // Out of order: the newer row lands first, then the older one.
    await landFeedItem({ ...asItem(short), fetchedAt: short.createdAt });
    await landFeedItem({ ...asItem(long), fetchedAt: long.createdAt });
    expect(t.store.get(id)!.body).toBe('Cancelled.');
    // A replay of everything changes nothing.
    await landFeedItem({ ...asItem(long), fetchedAt: long.createdAt });
    await landFeedItem({ ...asItem(short), fetchedAt: short.createdAt });
    expect(t.store.get(id)!.body).toBe('Cancelled.');
    expect(await reconcileSources('T-1', 2)).toMatchObject({ missing: 0 });
  });

  it('an old email page that holds only the same preview adds nothing: not landed, not counted as missing, run after run', async () => {
    const row = feedRow('gmail', 'm8', { subject: 'Short', snippet: 'Only this much was ever fetched' });
    await landFeedItem(asItem(row));
    t.emailPages.push({ body_markdown: '# Short\n\n## Body\nOnly this much was ever fetched\n', metadata: { gmailMessageId: 'm8' } });
    const saves = t.saves;
    expect(await reconcileSources('T-1', 2)).toMatchObject({ missing: 0, emailTexts: 0, failed: 0 });
    expect(await reconcileSources('T-1', 2)).toMatchObject({ missing: 0, emailTexts: 0 });
    expect(t.saves).toBe(saves);
    expect(t.store.get(idFor('email', 'm8'))!.isPreview).toBe(true); // it still says what it holds: a preview
    expect(await holdsFeedItem(asItem(row))).toBe(true); // and the pruner is not blocked by it
  });

  it('needsLanding: missing, without text, or holding an older different text; never for a preview or the same text', () => {
    const item = (body: string | null, asOf: string, preview = false) =>
      ({ clientNumber: 'T-1', userId: 2, kind: 'chat' as const, externalId: 'x', body, asOf: new Date(asOf), preview });
    const held = (body: string, asOf: string, isPreview = false) =>
      ({ hasText: body.length > 0, hash: body ? sourceTextHash(body) : null, asOf: new Date(asOf), isPreview });
    expect(needsLanding(undefined, item('a', '2026-11-02'))).toBe(true);
    expect(needsLanding(held('', '2026-11-01'), item('a', '2026-11-02'))).toBe(true);
    expect(needsLanding(held('a', '2026-11-01'), item(null, '2026-11-02'))).toBe(false);
    expect(needsLanding(held('same', '2026-11-01'), item('same', '2026-11-02'))).toBe(false);
    expect(needsLanding(held('abcd', '2026-11-01'), item('abce', '2026-11-02'))).toBe(true); // same length, newer
    expect(needsLanding(held('abcd', '2026-11-03'), item('abce', '2026-11-02'))).toBe(false); // the held text is the newer one
    expect(needsLanding(held('full text', '2026-11-01'), item('full…', '2026-11-05', true))).toBe(false); // a preview is never newer text
    expect(needsLanding(held('full…', '2026-11-05', true), item('full text', '2026-11-01'))).toBe(true); // any full text beats a preview
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
