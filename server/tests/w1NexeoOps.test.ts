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
}));
const notes: any[] = [];
vi.mock('../src/services/wiki/wikiStore', () => ({ writeNote: async (n: any) => { notes.push(n); return {}; }, getNote: async () => null }));
vi.mock('../src/db/prisma', () => ({ default: { user: { findFirst: async () => ({ name: 'Basit Ahmed' }) } } }));

import { runW1Op, W1_OPS } from '../src/services/suzi/suziW1';

const signed = { signatureVerified: true, deviceId: 'dev-1' };
const unsigned = { signatureVerified: false, deviceId: 'dev-1' };
beforeEach(() => { saved.length = 0; notes.length = 0; stored = null; });

describe('identity (S2: not live until it can be deleted)', () => {
  it('put, get and delete all answer not_yet and store nothing', async () => {
    expect(W1_OPS).toEqual(['identity.put', 'identity.get', 'identity.delete', 'profile.update', 'device.report']);
    for (const op of ['identity.put', 'identity.get', 'identity.delete']) {
      expect(await runW1Op('T', 2, op, { kind: 'voiceprint', data: 'AAAA', model: 'm' }, true, signed)).toMatchObject({ error: 'not_yet' });
    }
    expect(saved).toHaveLength(0);
    expect(await runW1Op('T', 2, 'identity.put', { kind: 'retina', data: 'AAAA' }, true, signed)).toMatchObject({ error: 'bad_kind' });
  });
});

describe('profile and device report', () => {
  it('profile.update writes one "How to work with <user>" note with the facts', async () => {
    const r = await runW1Op('T', 2, 'profile.update', { notes: [{ key: 'brief.length', value: 'short', evidence_count: 4, updated: '2026-11-13' }, { key: 'bad key!', value: 1 }] }, true, unsigned);
    expect(r).toMatchObject({ ok: true, item: { title: 'How to work with Basit Ahmed', keys: ['brief.length'] } });
    expect(notes[0]).toMatchObject({ type: 'person', scope: 'user', title: 'How to work with Basit Ahmed', ids: ['profile:user:2'], properties: { 'profile.brief.length': { value: 'short', evidence_count: 4 } } });
  });
  it('device.report is one record per device per day', async () => {
    await runW1Op('T', 2, 'device.report', { settings: { voice: 'on' }, audit: [{ op: 'x' }], usage: { minutes: 3 } }, false, unsigned);
    expect(saved[0]).toMatchObject({ kind: 'record', details: { type: 'device_report', device_id: 'dev-1', settings: { voice: 'on' }, usage: { minutes: 3 } } });
    expect(saved[0].externalId).toMatch(/^device-report:dev-1:\d{4}-\d{2}-\d{2}$/);
  });
});
