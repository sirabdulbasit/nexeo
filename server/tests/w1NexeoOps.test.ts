/**
 * W-1, Nexeo's side (founder 13 Nov 16:25:47 PKT; Functional Charter "Wiki first"). Pinned:
 *  IDENTITY  put is signed + confirmed and stored encrypted as a 'record' source per kind; get reads it back; an unknown
 *            kind is refused; delete is not_yet (no removal door) and changes nothing;
 *  PROFILE   profile.update writes ONE note "How to work with <user>" (type person, user scope, stable id), facts merged;
 *  DEVICE    device.report is one 'record' source per device per day, capped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const saved: any[] = [];
let stored: string | null = null;
vi.mock('../src/services/wiki/wikiSources', () => ({
  sourceId: (_c: string, _u: number, k: string, e: string) => `src:${k}:${e}`,
  saveSource: async (i: any) => { saved.push(i); stored = i.body; return { id: 'src_1', created: true }; },
  readSource: async () => (stored ? { body: stored } : null),
  sourcesHeld: async (_c: string, _u: number, ids: string[]) => new Map(ids.filter((id) => saved.some((x) => `src:${x.kind}:${x.externalId}` === id) && !removed.includes(id)).map((id) => [id, {}])),
}));
const notes: any[] = [];
const removed: string[] = [];
const have: { props: Record<string, any> | null } = { props: null };
vi.mock('../src/services/wiki/wikiStore', () => ({ writeNote: async (n: any) => { notes.push(n); return {}; }, getNote: async () => (have.props ? { properties: have.props } : null), removeSource: async (_w: any, id: string) => { removed.push(id); return { removed: true, marks: 0, citations: 0 }; } }));
vi.mock('../src/db/prisma', () => ({ default: { user: { findFirst: async () => ({ name: 'Basit Ahmed' }) } } }));

import { runW1Op, W1_OPS } from '../src/services/suzi/suziW1';

const signed = { signatureVerified: true, deviceId: 'dev-1' };
const unsigned = { signatureVerified: false, deviceId: 'dev-1' };
beforeEach(() => { saved.length = 0; notes.length = 0; stored = null; removed.length = 0; });

describe('identity (S2: put, get and delete live together)', () => {
  it('put: signed and confirmed, stored encrypted per kind; get reads it back; delete removes it through the Wiki door', async () => {
    expect(await runW1Op('T', 2, 'identity.put', { kind: 'voiceprint', data: 'AAAA', model: 'ecapa-v2' }, true, unsigned)).toMatchObject({ error: 'needs_signature' });
    expect(await runW1Op('T', 2, 'identity.put', { kind: 'voiceprint', data: 'AAAA' }, false, signed)).toMatchObject({ error: 'needs_confirmation' });
    expect(await runW1Op('T', 2, 'identity.put', { kind: 'retina', data: 'AAAA' }, true, signed)).toMatchObject({ error: 'bad_kind' });
    expect(await runW1Op('T', 2, 'identity.put', { kind: 'voiceprint', data: 'AAAA', model: 'ecapa-v2' }, true, signed)).toMatchObject({ ok: true, item: { kind: 'voiceprint', stored: true } });
    expect(saved[0]).toMatchObject({ kind: 'record', externalId: 'identity:voiceprint', encrypt: true, details: { type: 'identity', kind: 'voiceprint', device_id: 'dev-1' } });
    expect(await runW1Op('T', 2, 'identity.get', { kind: 'voiceprint' }, false, unsigned)).toMatchObject({ ok: true, item: { kind: 'voiceprint', data: 'AAAA', model: 'ecapa-v2' } });
    expect(await runW1Op('T', 2, 'identity.delete', { kind: 'voiceprint' }, true, unsigned)).toMatchObject({ error: 'needs_signature' });
    expect(await runW1Op('T', 2, 'identity.delete', { kind: 'voiceprint' }, true, signed)).toEqual({ ok: true, item: { kind: 'voiceprint', deleted: true } });
    expect(removed).toEqual(['src:record:identity:voiceprint']);
  });
});

describe('profile and device report', () => {
  it('profile.update writes one "How to work with <user>" note with the facts', async () => {
    const r = await runW1Op('T', 2, 'profile.update', { notes: [{ key: 'brief.length', value: 'short', evidence_count: 4, updated: '2026-11-13' }, { key: 'bad key!', value: 1 }] }, true, unsigned);
    expect(r).toMatchObject({ ok: true, item: { title: 'How to work with Basit Ahmed', keys: ['brief.length'] } });
    expect(notes[0]).toMatchObject({ type: 'person', scope: 'user', title: 'How to work with Basit Ahmed', ids: ['profile:user:2'], properties: { 'profile.brief.length': { value: 'short', evidence_count: 4 } } });
  });
  it('each line of the profile note has its source, and the note cites it (16 Nov)', async () => {
    await runW1Op('T', 2, 'profile.update', { notes: [{ key: 'memory.tea', value: 'no sugar', evidence_count: 1, updated: '2026-11-16T10:00:00Z' }] }, true, signed);
    expect(saved[0]).toMatchObject({ kind: 'record', externalId: 'profile:memory.tea', body: 'no sugar', details: { type: 'profile', key: 'memory.tea' } });
    expect(notes[0].sourceIds).toEqual(['src:record:profile:memory.tea']);
    expect(notes[0].body).toContain('- **memory.tea**: no sugar');
  });
  it('W-1: an empty value means forgotten: the line leaves the note and its source is removed', async () => {
    have.props = { 'profile.memory.tea': { value: 'no sugar', evidence_count: 1 }, 'profile.brief.length': { value: 'short', evidence_count: 4 } };
    const r = await runW1Op('T', 2, 'profile.update', { notes: [{ key: 'memory.tea', value: '' }] }, true, signed);
    have.props = null;
    expect(r.ok).toBe(true);
    expect(removed).toEqual(['src:record:profile:memory.tea']);
    expect(saved).toHaveLength(0);
    expect(notes[0].properties).toEqual({ 'profile.memory.tea': null });
    expect(notes[0].body).not.toContain('memory.tea');
    expect(notes[0].body).toContain('- **brief.length**: short');
  });
  it('T36: brief.history and speech.counts are stored and returned as sent, never printed as note lines', async () => {
    const hist = { summary: ['details', 'skipped'], meetings: ['acted'], actions: [], emails: ['stopped'] };
    const counts = { utterances: 12, english_words: 80, urdu_words: 20, english: { meeting: 4 } };
    const r = await runW1Op('T', 2, 'profile.update', { notes: [
      { key: 'brief.history', value: hist, evidence_count: 4 }, { key: 'speech.counts', value: counts, evidence_count: 12 },
      { key: 'brief.summary', value: 'keep it to two lines', evidence_count: 3 }] }, true, signed);
    expect(r).toMatchObject({ ok: true, item: { keys: ['brief.history', 'speech.counts', 'brief.summary'] } });
    expect(notes[0].properties['profile.brief.history'].value).toEqual(hist);
    expect(notes[0].properties['profile.speech.counts'].value).toEqual(counts);
    expect(notes[0].body).toContain('- **brief.summary**: keep it to two lines');
    expect(notes[0].body).not.toContain('brief.history');
    expect(notes[0].body).not.toContain('speech.counts');
    have.props = notes[0].properties;
    const { profileOf } = await import('../src/services/suzi/suziW1');
    expect(await profileOf('T', 2)).toMatchObject({ 'brief.history': hist, 'speech.counts': counts });
    have.props = null;
  });
  it('T36 item 4: an unknown or bad key does not refuse the call; only a call with no good key is refused', async () => {
    const r = await runW1Op('T', 2, 'profile.update', { notes: [{ key: 'some.new_key', value: { a: 1 } }, { key: 'bad key!', value: 1 }] }, true, signed);
    expect(r).toMatchObject({ ok: true, item: { keys: ['some.new_key'] } });
    expect(await runW1Op('T', 2, 'profile.update', { notes: [{ key: 'bad key!', value: 1 }] }, true, signed)).toMatchObject({ error: 'bad_notes' });
  });
  it('T36 learning curve: counted, never removes a part, skips half before 19 Nov; learned.* is Nexeo\'s only', async () => {
    const { learnCurve } = await import('../src/services/suzi/suziW1');
    const hist = { summary: ['details', 'details', 'acted'], meetings: ['skipped', 'skipped', 'skipped', 'skipped'], actions: ['stopped', 'stopped', 'details'], emails: [] };
    const before = learnCurve({ 'profile.brief.history': { value: hist } }, new Date('2026-11-18T12:00:00Z'));
    expect(before['learned.brief.summary']).toBe('more detail');
    expect(before['learned.brief.meetings']).toBe('shorter'); // 4 skips at half weight = -0.5 per answer
    expect(before['learned.brief.actions']).toBe('shorter');
    expect(before['learned.brief_order']).toEqual(['summary', 'emails', 'actions', 'meetings']); // scores 1, 0, -0.33, -0.5; every part kept
    const after = learnCurve({ 'profile.brief.history': { value: { meetings: ['skipped', 'details', 'details'] } } }, new Date('2026-11-20T12:00:00Z'));
    expect(after['learned.brief.meetings']).toBe('more detail'); // from 19 Nov a skip counts whole: (-1 + 1 + 1) / 3 = 0.33
    expect(learnCurve({ 'profile.brief.history': { value: { meetings: ['skipped', 'skipped', 'details'] } } }, new Date('2026-11-20T12:00:00Z'))['learned.brief.meetings']).toBe('shorter');
    const w1 = learnCurve({ 'profile.speech.counts': { value: { english_words: 80, urdu_words: 20 } } }, new Date('2026-11-18T12:00:00Z'));
    const w2 = learnCurve({ 'profile.speech.counts': { value: { english_words: 110, urdu_words: 90 } }, 'profile.learned.speech_weeks': { value: w1['learned.speech_weeks'] } }, new Date('2026-11-25T12:00:00Z'));
    expect(w2['learned.english_share_by_week']).toEqual({ '2026-11-16': 0.8, '2026-11-23': 0.3 });
    const r = await runW1Op('T', 2, 'profile.update', { notes: [{ key: 'learned.brief_order', value: ['x'] }, { key: 'brief.history', value: hist, evidence_count: 4 }] }, true, signed);
    expect((r as any).item.keys).toEqual(['brief.history']);
    expect(notes[0].properties['profile.learned.brief_order'].value).toEqual(['summary', 'emails', 'actions', 'meetings']);
    expect(notes[0].body).toContain('- **learned.brief.meetings**: shorter');
    expect(notes[0].body).not.toContain('learned.speech_weeks');
  });
  it('device.report is one record per device per day', async () => {
    await runW1Op('T', 2, 'device.report', { settings: { voice: 'on' }, audit: [{ op: 'x' }], usage: { minutes: 3 } }, false, unsigned);
    expect(saved[0]).toMatchObject({ kind: 'record', details: { type: 'device_report', device_id: 'dev-1', settings: { voice: 'on' }, usage: { minutes: 3 } } });
    expect(saved[0].externalId).toMatch(/^device-report:dev-1:\d{4}-\d{2}-\d{2}$/);
  });
});
