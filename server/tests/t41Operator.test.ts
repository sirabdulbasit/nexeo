/**
 * Link T41 (both AGREE 18 Nov 2026): the computer operator's control in Nexeo.
 * Founder, 18 Nov: one central operator system for every Suzi client, each client isolated, totally free.
 *
 * Pinned:
 *  1. pack `operator`: no settings row, or no consent → enabled false and nothing allowed; with consent → limits,
 *     blanked apps, his permissions and this month's use;
 *  2. operator.report keeps counts and outcome only: an argument outside the agreed list (a screenshot) is refused and
 *     nothing is written; a `done` with no proof is kept `unverified`; a repeat of the same run writes nothing more;
 *  3. isolation: the same run id from another customer or another user is a different row;
 *  4. operator.permission is his alone: unconfirmed is refused and nothing is written; a part not sent keeps its
 *     value; a no forgets the folders;
 *  5. totally free: the central paid loop answers `local` unless the server itself is switched on;
 *  6. both ops are act ops, and `/changes` can say "operator".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  settings: null as any,
  runs: new Map<string, any>(),
  prefs: new Map<string, any>(),   // `${client}:${user}` → notification_preferences.suzi.operator
  writes: [] as string[],
  changeRow: {} as Record<string, boolean>,
}));

vi.mock('../src/db/prisma', () => ({
  default: {
    operatorSettings: { findUnique: async () => db.settings },
    operatorRun: {
      findUnique: async (a: any) => db.runs.get(a.where.id) ?? null,
      create: async (a: any) => {
        if (db.runs.has(a.data.id)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        db.runs.set(a.data.id, a.data); return a.data;
      },
      count: async (a: any) => [...db.runs.values()].filter((r) => r.clientNumber === a.where.clientNumber).length,
      aggregate: async (a: any) => ({ _sum: { steps: [...db.runs.values()].filter((r) => r.clientNumber === a.where.clientNumber).reduce((n, r) => n + r.steps, 0) } }),
    },
    $queryRawUnsafe: async (sql: string, client: string, user: number) => {
      if (/AS operator/.test(sql)) return [db.changeRow];
      const key = `${client}:${user}`;
      return db.prefs.has(key) ? [{ p: db.prefs.get(key) }] : [{ p: null }];
    },
    $executeRawUnsafe: async (sql: string, client: string, user: number, json: string) => {
      db.writes.push(sql);
      db.prefs.set(`${client}:${user}`, JSON.parse(json));
      return 1;
    },
  },
}));
vi.mock('../src/services/suzi/suziRules', () => ({ rulesDocument: async () => null }));

import { packOperator, runOperatorOp, runRowId, GOAL_MAX, OPERATOR_OPS } from '../src/services/suzi/suziOperator';
import { startRun } from '../src/services/operator/operatorService';
import { changesSince } from '../src/services/suzi/suziChanges';

const consented = {
  enabled: true, model: 'claude', claudeModel: 'claude-opus-5-5', uitarsBaseUrl: null, uitarsModel: 'ui-tars-1.5-7b',
  consentAt: new Date('2026-11-18T10:00:00Z'), consentBy: 1, privateMode: false, blankApps: ['Keychain Access'],
  monthlyTaskLimit: 100, monthlyStepLimit: 3000, maxSteps: 30,
};
const good = {
  run_id: 'r-1', job: 'files', status: 'done', proof: 'file', steps: 4, actions: 6,
  started: '2026-11-18T11:00:00Z', ended: '2026-11-18T11:01:00Z', goal: 'find the purchase order',
};
const report = (client: string, user: number, args: Record<string, unknown>) => runOperatorOp(client, user, 'operator.report', args, true);

beforeEach(() => { db.settings = null; db.runs.clear(); db.prefs.clear(); db.writes = []; db.changeRow = {}; });

describe('T41 pack operator', () => {
  it('no settings row → off, nothing allowed, nothing used', async () => {
    expect(await packOperator('A', 2)).toEqual({
      enabled: false, consent_at: null, images: { allowed: false, folders: [] }, system: { allowed: false },
      blank_apps: [], max_steps: 30, limits: { tasks_month: 100, steps_month: 3000 }, used: { tasks: 0, steps: 0 },
    });
  });
  it('switched on without recorded consent is still off', async () => {
    db.settings = { ...consented, consentAt: null };
    expect((await packOperator('A', 2)).enabled).toBe(false);
  });
  it('with consent → on, with the customer\'s limits, blanked apps, his permissions and this month\'s use', async () => {
    db.settings = consented;
    db.prefs.set('A:2', { images: { allowed: true, folders: ['~/Documents/Scans'] }, system: { allowed: false } });
    await report('A', 2, good);
    expect(await packOperator('A', 2)).toMatchObject({
      enabled: true, consent_at: '2026-11-18T10:00:00.000Z', blank_apps: ['Keychain Access'],
      images: { allowed: true, folders: ['~/Documents/Scans'] }, system: { allowed: false }, used: { tasks: 1, steps: 4 },
    });
  });
});

describe('T41 operator.report', () => {
  it('keeps counts and outcome; the goal is cut at 200 characters', async () => {
    const r: any = await report('A', 2, { ...good, goal: 'x'.repeat(500) });
    expect(r).toMatchObject({ ok: true, item: { run_id: 'r-1', status: 'done', verified: true, used: { tasks: 1, steps: 4 } } });
    const row = db.runs.get(runRowId('A', 2, 'r-1'));
    expect(row).toMatchObject({ clientNumber: 'A', userId: 2, model: 'local:files', status: 'done', steps: 4, actions: 6, summary: 'proof:file' });
    expect(row.goal).toHaveLength(GOAL_MAX);
  });
  it('an argument outside the agreed list is refused and nothing is written', async () => {
    for (const extra of [{ screenshot: 'iVBOR…' }, { image_b64: 'x' }, { typed: 'secret' }, { content: 'file text' }]) {
      expect(await report('A', 2, { ...good, ...extra })).toMatchObject({ ok: false, error: 'bad_args' });
    }
    expect(db.runs.size).toBe(0);
  });
  it('a done with no proof is kept unverified, never done', async () => {
    const r: any = await report('A', 2, { ...good, proof: 'none' });
    expect(r.item).toMatchObject({ status: 'unverified', verified: false });
    expect(db.runs.get(runRowId('A', 2, 'r-1')).status).toBe('unverified');
  });
  it('the same run reported twice writes one row and answers the first outcome', async () => {
    await report('A', 2, good);
    const again: any = await report('A', 2, { ...good, status: 'failed', steps: 99 });
    expect(again.item).toMatchObject({ status: 'done', already: true, used: { tasks: 1, steps: 4 } });
    expect(db.runs.size).toBe(1);
  });
  it('isolation: the same run id from another customer or another user is its own row', async () => {
    await report('A', 2, good);
    await report('B', 2, good);
    await report('A', 3, good);
    expect(db.runs.size).toBe(3);
    expect(new Set([runRowId('A', 2, 'r-1'), runRowId('B', 2, 'r-1'), runRowId('A', 3, 'r-1')]).size).toBe(3);
    expect((await packOperator('B', 2)).used).toEqual({ tasks: 1, steps: 4 });
  });
  it('refuses what it cannot read', async () => {
    expect(await report('A', 2, { ...good, run_id: 'has space' })).toMatchObject({ error: 'bad_run_id' });
    expect(await report('A', 2, { ...good, job: 'hack' })).toMatchObject({ error: 'bad_job' });
    expect(await report('A', 2, { ...good, status: 'great' })).toMatchObject({ error: 'bad_status' });
    expect(await report('A', 2, { ...good, proof: 'trust me' })).toMatchObject({ error: 'bad_proof' });
    expect(await report('A', 2, { ...good, steps: -1 })).toMatchObject({ error: 'bad_count' });
    expect(await report('A', 2, { ...good, ended: '2026-11-18T10:00:00Z' })).toMatchObject({ error: 'bad_time' });
    expect(db.runs.size).toBe(0);
  });
});

describe('T41 operator.permission', () => {
  const set = (args: Record<string, unknown>, confirmed = true) => runOperatorOp('A', 2, 'operator.permission', args, confirmed);
  it('unconfirmed is refused and nothing is written', async () => {
    expect(await set({ images: { allowed: true } }, false)).toEqual({ ok: false, error: 'needs_confirmation' });
    expect(db.writes).toHaveLength(0);
  });
  it('his yes to images in named folders is kept, and stamps the changes feed', async () => {
    expect(await set({ images: { allowed: true, folders: ['~/Documents', '~/Documents', ' ~/Desktop '] } })).toEqual({
      ok: true, item: { images: { allowed: true, folders: ['~/Documents', '~/Desktop'] }, system: { allowed: false } },
    });
    expect(db.writes[0]).toMatch(/operator_touched_at/);
  });
  it('a part that is not sent keeps its value; a no forgets the folders', async () => {
    await set({ images: { allowed: true, folders: ['~/Documents'] } });
    expect(((await set({ system: { allowed: true } })) as any).item).toEqual({ images: { allowed: true, folders: ['~/Documents'] }, system: { allowed: true } });
    expect(((await set({ images: { allowed: false } })) as any).item).toEqual({ images: { allowed: false, folders: [] }, system: { allowed: true } });
  });
  it('another user\'s permission is not his', async () => {
    await set({ system: { allowed: true } });
    expect((await packOperator('A', 3)).system).toEqual({ allowed: false });
    expect((await packOperator('B', 2)).system).toEqual({ allowed: false });
  });
  it('refuses what it cannot read', async () => {
    expect(await set({})).toMatchObject({ error: 'bad_args' });
    expect(await set({ images: { allowed: 'yes' } })).toMatchObject({ error: 'bad_images' });
    expect(await set({ images: { allowed: true, folders: [''] } })).toMatchObject({ error: 'bad_folders' });
    expect(await set({ images: { allowed: true, folders: Array(21).fill('~/x') } })).toMatchObject({ error: 'bad_folders' });
    expect(await set({ system: { allowed: 1 } })).toMatchObject({ error: 'bad_system' });
    expect(db.writes).toHaveLength(0);
  });
});

describe('T41 totally free, and wired', () => {
  it('the central paid loop answers local unless the server itself is switched on', async () => {
    delete process.env.OPERATOR_CENTRAL;
    db.settings = consented;
    const made = vi.fn();
    const r = await startRun({ clientNumber: 'A', userId: 2, goal: 'download it' } as any, { makeModel: made, verify: vi.fn(), now: () => Date.now() } as any);
    expect(r).toEqual({ status: 'local', reason: 'central_off' });
    expect(made).not.toHaveBeenCalled();
    expect(db.runs.size).toBe(0);
  });
  it('both ops are named, and /changes can say "operator"', async () => {
    expect([...OPERATOR_OPS]).toEqual(['operator.report', 'operator.permission']);
    db.changeRow = { operator: true };
    const a: any = await changesSince('A', 2, new Date(Date.now() - 60_000).toISOString());
    expect(a.changed).toEqual(['operator']);
  });
});
