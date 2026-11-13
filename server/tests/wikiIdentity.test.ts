/**
 * Wiki identity and all-or-nothing writes (docs/Wiki-Knowledge.md §0.7 standards 2 and 5, §0.13 parts 6 and 7).
 *
 *  1. a note found by its outside identifier is renamed, keeps its id and its links, and answers to its old name;
 *  2. a link two notes answer to reaches neither and is recorded as ambiguous;
 *  3. a note titled with a name beats one that only has it as an alias; a record page gives way to any other note;
 *  4. a link reaches only a live note: not an old page, not a retired note;
 *  5. a waiting link connects through an alias, and only when the new note is the single answer;
 *  6. identifiers that belong to two notes are refused, and nothing is written;
 *  7. a title another note holds is not taken from it;
 *  8. a merge moves citations and backlinks, and an unmerge puts them back;
 *  9. a write that fails part-way leaves nothing behind;
 * 10. the revision guards a note against a second writer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/prisma', async () => {
  const { prismaFake } = await import('./helpers/wikiPrismaFake');
  return { __esModule: true, default: prismaFake, prisma: prismaFake };
});

import { t, resetWiki } from './helpers/wikiPrismaFake';
import {
  writeNote, getNote, retireNote, mergeNotes, unmergeNote, normalizeIds, resolveLink,
  WriteConflict, IdentityConflict, WIKILINK,
} from '../src/services/wiki/wikiStore';

const base = { clientNumber: 'T-1', userId: 1, actor: 'test' };
const me = { clientNumber: 'T-1', userId: 1 };
const note = (title: string) => t.pages.find((p) => p.title === title);
const linksTo = (id: string) => t.links.filter((l) => l.toPageId === id && l.linkType === WIKILINK).map((l) => l.fromPageId).sort();
const src = (id: string) => t.srcs.push({ id, client_number: 'T-1', user_id: 1, scope: 'user' });

beforeEach(() => resetWiki());

describe('wiki identity', () => {
  it('1. a note found by its identifier is renamed: same id, same links, and its old name still reaches it', async () => {
    const first = await writeNote({ ...base, type: 'person', title: 'Ovais Tariq', body: '', ids: ['Email:Ovais@X.com'] });
    const topic = await writeNote({ ...base, type: 'topic', title: 'Pricing', body: 'Ask [[Ovais Tariq]].' });
    expect(linksTo(first.id)).toEqual([topic.id]);

    const again = await writeNote({ ...base, type: 'person', title: 'Muhammad Ovais Tariq', body: 'Fuller name.', ids: ['email:ovais@x.com'] });
    expect(again).toMatchObject({ id: first.id, created: false, renamedFrom: 'Ovais Tariq', revision: 2 });
    expect(t.pages.filter((p) => p.pageType === 'person')).toHaveLength(1);
    expect(note('Muhammad Ovais Tariq').metadata).toMatchObject({ ids: ['email:ovais@x.com'], aliases: ['Ovais Tariq'], aliasKeys: ['ovais tariq'] });
    expect(linksTo(first.id)).toEqual([topic.id]);

    // The topic is rewritten with the old name in its text: the link still reaches the renamed note.
    const rewritten = await writeNote({ ...base, type: 'topic', title: 'Pricing', body: 'Still ask [[Ovais Tariq]].' });
    expect(rewritten).toMatchObject({ linked: 1, unresolved: [], ambiguous: [] });
    expect((await getNote('T-1', 1, { title: 'ovais tariq' }))!.id).toBe(first.id);
    // Writing under the old name updates the same note and does not take its new title away.
    const byOldName = await writeNote({ ...base, type: 'person', title: 'Ovais Tariq', body: 'Seen again.' });
    expect(byOldName).toMatchObject({ id: first.id, created: false });
    expect(page(first.id).title).toBe('Muhammad Ovais Tariq');
  });

  it('2. a link two notes answer to reaches neither, and is recorded as ambiguous', async () => {
    await writeNote({ ...base, type: 'person', title: 'Acme', body: '' });
    await writeNote({ ...base, type: 'company', title: 'Acme', body: '' });
    const w = await writeNote({ ...base, type: 'topic', title: 'Deal', body: 'With [[Acme]].' });
    expect(w).toMatchObject({ linked: 0, unresolved: ['acme'], ambiguous: ['acme'] });
    expect(t.links).toEqual([]);
    expect(note('Deal').metadata.ambiguousLinks).toEqual(['acme']);
  });

  it('3. a title beats an alias, and a record page gives way to any other note', async () => {
    const sam = await writeNote({ ...base, type: 'person', title: 'Sam', body: '' });
    await writeNote({ ...base, type: 'person', title: 'Samuel Green', body: '', aliases: ['Sam'] });
    expect((await writeNote({ ...base, type: 'topic', title: 'A', body: '[[Sam]]' })).linked).toBe(1);
    expect(linksTo(sam.id)).toHaveLength(1);

    const ali = await writeNote({ ...base, type: 'person', title: 'Ali Khan', body: '' });
    await writeNote({ ...base, type: 'org_doc', title: 'Ali Khan', body: 'A record.', scope: 'tenant' });
    expect(await writeNote({ ...base, type: 'topic', title: 'B', body: '[[Ali Khan]]' })).toMatchObject({ linked: 1, ambiguous: [] });
    expect(linksTo(ali.id)).toHaveLength(1);

    // Two notes that both only have the name as an alias: ambiguous.
    await writeNote({ ...base, type: 'person', title: 'Robert One', body: '', aliases: ['Bob'] });
    await writeNote({ ...base, type: 'person', title: 'Robert Two', body: '', aliases: ['Bob'] });
    expect(await writeNote({ ...base, type: 'topic', title: 'C', body: '[[Bob]]' })).toMatchObject({ linked: 0, ambiguous: ['bob'] });
    expect(resolveLink('x', [])).toEqual({ hit: null, ambiguous: false });
  });

  it('4. a link reaches only a live note: not an old page, not a retired note', async () => {
    t.pages.push({ id: 'old1', clientNumber: 'T-1', userId: 1, pageType: 'entity_person', scope: 'user', status: 'active', title: 'Budget Owner', bodyMarkdown: '', metadata: {} });
    expect(await writeNote({ ...base, type: 'topic', title: 'Plan', body: '[[Budget Owner]]' })).toMatchObject({ linked: 0, unresolved: ['budget owner'], ambiguous: [] });
    const gone = await writeNote({ ...base, type: 'person', title: 'Left Company', body: '' });
    await retireNote(gone.id, 'test');
    expect(await writeNote({ ...base, type: 'topic', title: 'Plan 2', body: '[[Left Company]]' })).toMatchObject({ linked: 0, unresolved: ['left company'] });
  });

  it('5. a waiting link connects through an alias, and only when the new note is the single answer', async () => {
    const meeting = await writeNote({ ...base, type: 'meeting', title: 'Kick-off', body: 'With [[Omar]] and [[Twin]].' });
    expect(meeting.unresolved).toEqual(['omar', 'twin']);
    const omar = await writeNote({ ...base, type: 'person', title: 'Muhammad Omar Farooq', body: '', aliases: ['Omar'] });
    expect(linksTo(omar.id)).toEqual([meeting.id]);
    expect(note('Kick-off').metadata.unresolvedLinks).toEqual(['twin']);
    // Two notes take the name "Twin" one after the other: the first connects, the second does not steal or double it.
    const one = await writeNote({ ...base, type: 'person', title: 'Twin', body: '' });
    const two = await writeNote({ ...base, type: 'company', title: 'Twin', body: '' });
    expect(linksTo(one.id)).toEqual([meeting.id]);
    expect(linksTo(two.id)).toEqual([]);
  });

  it('6. identifiers that belong to two notes are refused, and nothing is written', async () => {
    await writeNote({ ...base, type: 'person', title: 'Irfan Ahmed', body: 'one', ids: ['email:irfan.ahmed@x.com'] });
    await writeNote({ ...base, type: 'person', title: 'Malik Irfan', body: 'two', ids: ['email:malik.irfan@x.com'] });
    const before = structuredClone(t.pages);
    await expect(writeNote({ ...base, type: 'person', title: 'Malik Irfan Ahmed', body: 'both', ids: ['email:irfan.ahmed@x.com', 'email:malik.irfan@x.com'] }))
      .rejects.toBeInstanceOf(IdentityConflict);
    expect(t.pages).toEqual(before);
    // Another user's note with the same identifier is not this user's note.
    const other = await writeNote({ ...base, userId: 2, type: 'person', title: 'Irfan Ahmed', body: '', ids: ['email:irfan.ahmed@x.com'] });
    expect(other.created).toBe(true);
  });

  it('7. a title another note holds is not taken from it', async () => {
    const x = await writeNote({ ...base, type: 'person', title: 'A. Khan', body: '', ids: ['email:a@x.com'] });
    const y = await writeNote({ ...base, type: 'person', title: 'Ali Khan', body: '' });
    const w = await writeNote({ ...base, type: 'person', title: 'Ali Khan', body: 'named like the other', ids: ['email:a@x.com'] });
    expect(w).toMatchObject({ id: x.id, created: false });
    expect(page(x.id).title).toBe('A. Khan');
    expect(page(x.id).metadata.aliases).toEqual(['Ali Khan']);
    expect(page(y.id).bodyMarkdown).toBe('');
    // The name still reaches the note that is titled with it.
    await writeNote({ ...base, type: 'topic', title: 'T', body: '[[Ali Khan]]' });
    expect(linksTo(y.id)).toHaveLength(1);
    expect(linksTo(x.id)).toHaveLength(0);
  });

  it('8. a merge moves citations and backlinks and is recorded; an unmerge puts them back', async () => {
    ['s1', 's2', 's3'].forEach(src);
    const keep = await writeNote({ ...base, type: 'person', title: 'Malik Irfan Ahmed', body: '', ids: ['email:irfan.ahmed@x.com'], sourceIds: ['s1', 's2'] });
    const other = await writeNote({ ...base, type: 'person', title: 'Malik Irfan', body: 'See [[Malik Irfan Ahmed]].', ids: ['email:malik.irfan@x.com'], sourceIds: ['s2', 's3'] });
    const mention = await writeNote({ ...base, type: 'topic', title: 'Audit', body: '[[Malik Irfan]] and [[Malik Irfan Ahmed]]' });
    const solo = await writeNote({ ...base, type: 'topic', title: 'Visit', body: '[[Malik Irfan]]' });

    expect(await mergeNotes(me, keep.id, other.id, 'user:1', 'he said they are one person')).toEqual({ citations: 1, backlinks: 1 });
    expect(t.cites.filter((c) => c.note_id === keep.id).map((c) => c.source_id).sort()).toEqual(['s1', 's2', 's3']);
    expect(t.cites.filter((c) => c.note_id === other.id)).toEqual([]);
    expect(linksTo(keep.id)).toEqual([mention.id, solo.id].sort());
    expect(linksTo(other.id)).toEqual([]);
    expect(page(keep.id).metadata).toMatchObject({ ids: ['email:irfan.ahmed@x.com', 'email:malik.irfan@x.com'], aliases: ['Malik Irfan'] });
    expect(page(keep.id).metadata.confirmedSame).toEqual([['email:irfan.ahmed@x.com', 'email:malik.irfan@x.com']]);
    expect(page(other.id)).toMatchObject({ status: 'superseded' });
    expect(page(other.id).metadata.mergeRecord).toMatchObject({ into: keep.id, by: 'user:1', movedCitations: ['s3'], movedBacklinks: [solo.id] });
    // A later write carrying the folded-in address reaches the survivor, and the old name links to it.
    expect((await writeNote({ ...base, type: 'person', title: 'Malik Irfan Ahmed', body: 'again', ids: ['email:malik.irfan@x.com'] })).id).toBe(keep.id);
    expect((await writeNote({ ...base, type: 'topic', title: 'Visit', body: '[[Malik Irfan]] again' })).linked).toBe(1);

    await unmergeNote(me, other.id, 'user:1');
    expect(page(other.id)).toMatchObject({ status: 'active' });
    expect(page(other.id).metadata.ids).toEqual(['email:malik.irfan@x.com']);
    expect(page(other.id).metadata.mergeRecord).toBeUndefined();
    expect(page(keep.id).metadata).toMatchObject({ ids: ['email:irfan.ahmed@x.com'], aliases: [], confirmedSame: [] });
    expect(t.cites.filter((c) => c.note_id === keep.id).map((c) => c.source_id).sort()).toEqual(['s1', 's2']);
    expect(t.cites.filter((c) => c.note_id === other.id).map((c) => c.source_id).sort()).toEqual(['s2', 's3']);
    expect(linksTo(other.id)).toEqual([solo.id]);
    expect(linksTo(keep.id)).toEqual([mention.id, other.id].sort());
  });

  it('8b. only two notes of the same kind and owner can be merged, and never across users', async () => {
    const a = await writeNote({ ...base, type: 'person', title: 'A', body: '' });
    const c = await writeNote({ ...base, type: 'company', title: 'C', body: '' });
    const theirs = await writeNote({ ...base, userId: 2, type: 'person', title: 'B', body: '' });
    await expect(mergeNotes(me, a.id, c.id, 'test')).rejects.toThrow(/same kind/);
    await expect(mergeNotes(me, a.id, theirs.id, 'test')).rejects.toThrow(/both notes must exist/);
    await expect(mergeNotes(me, a.id, a.id, 'test')).rejects.toThrow(/itself/);
  });

  it('9. a write that fails part-way leaves nothing behind', async () => {
    ['s1', 's2'].forEach(src);
    const ali = await writeNote({ ...base, type: 'person', title: 'Ali Khan', body: '' });
    const first = await writeNote({ ...base, type: 'topic', title: 'Pricing', body: 'v1 [[Ali Khan]]', properties: { stage: 'draft' }, sourceIds: ['s1'] });
    const before = structuredClone({ pages: t.pages, links: t.links, cites: t.cites });

    for (const op of ['wikiPageLink.createMany', 'citeSources', 'wikiPage.update']) {
      t.failOn = op;
      await expect(writeNote({ ...base, type: 'topic', title: 'Pricing', body: 'v2 [[Ali Khan]] rewritten', properties: { stage: 'final' }, sourceIds: ['s2'] }))
        .rejects.toThrow(/injected failure/);
      expect({ pages: t.pages, links: t.links, cites: t.cites }, `after a failure at ${op}`).toEqual(before);
    }
    // A new note whose citations fail is not created at all.
    t.failOn = 'citeSources';
    await expect(writeNote({ ...base, type: 'topic', title: 'Brand new', body: '[[Ali Khan]]', sourceIds: ['s1'] })).rejects.toThrow(/injected failure/);
    expect(note('Brand new')).toBeUndefined();
    expect(linksTo(ali.id)).toEqual([first.id]);
  });

  it('10. the revision guards a note against a second writer', async () => {
    const w1 = await writeNote({ ...base, type: 'topic', title: 'Plan', body: 'one' });
    expect(w1.revision).toBe(1);
    const w2 = await writeNote({ ...base, type: 'topic', title: 'Plan', body: 'two', ifRevision: 1 });
    expect(w2.revision).toBe(2);
    // He edits what he read at revision 1, but the note has moved on: refused, nothing changed.
    await expect(writeNote({ ...base, type: 'topic', title: 'Plan', body: 'stale edit', ifRevision: 1 })).rejects.toBeInstanceOf(WriteConflict);
    expect(note('Plan').bodyMarkdown).toBe('two');

    // A second writer slips in between this write's read and its claim.
    const bump = () => { const p = note('Plan'); p.metadata = { ...p.metadata, rev: p.metadata.rev + 1 }; p.bodyMarkdown = 'theirs'; };
    t.beforeClaim = bump;
    await expect(writeNote({ ...base, type: 'topic', title: 'Plan', body: 'mine, pinned', ifRevision: 2 })).rejects.toBeInstanceOf(WriteConflict);
    expect(note('Plan').bodyMarkdown).toBe('theirs');
    // A writer that did not pin a revision (a job) looks again once and writes on top of what is there.
    t.beforeClaim = bump;
    const w = await writeNote({ ...base, type: 'topic', title: 'Plan', body: 'the job' });
    expect(note('Plan').bodyMarkdown).toBe('the job');
    expect(w.revision).toBe(note('Plan').metadata.rev);
  });

  it('a builder\'s write states the whole note: its identifiers and its trail are exactly the ones given', async () => {
    ['s1', 's2', 's3'].forEach(src);
    const w = await writeNote({ ...base, type: 'person', title: 'Hina Shah', body: 'v1', ids: ['email:hina@one.com', 'email:h.shah@one.com'], sourceIds: ['s1', 's2'], exact: true });
    // The second address turned out to be someone else: the build now gives one address and other sources.
    await writeNote({ ...base, type: 'person', title: 'Hina Shah', body: 'v2', ids: ['email:hina@one.com'], sourceIds: ['s2', 's3'], exact: true });
    expect(page(w.id).metadata.ids).toEqual(['email:hina@one.com']);
    expect(t.cites.filter((c) => c.note_id === w.id).map((c) => c.source_id).sort()).toEqual(['s2', 's3']);
    // The released address now starts a note of its own instead of landing on the old one.
    const other = await writeNote({ ...base, type: 'person', title: 'H. Shah', body: '', ids: ['email:h.shah@one.com'], exact: true });
    expect(other).toMatchObject({ created: true });
    // A writer that does not state the whole note only adds.
    await writeNote({ ...base, type: 'person', title: 'Hina Shah', body: 'v3', ids: ['phone:+92300'], sourceIds: ['s1'] });
    expect(page(w.id).metadata.ids).toEqual(['email:hina@one.com', 'phone:+92300']);
    expect(t.cites.filter((c) => c.note_id === w.id).map((c) => c.source_id).sort()).toEqual(['s1', 's2', 's3']);
  });

  it('identifiers are stored one way', () => {
    expect(normalizeIds([' Email:A@X.com ', 'email:a@x.com', 'no-kind', '', 'domain:x.com'])).toEqual(['domain:x.com', 'email:a@x.com']);
    expect(normalizeIds(undefined)).toEqual([]);
  });
});

function page(id: string) { return t.pages.find((p) => p.id === id); }
