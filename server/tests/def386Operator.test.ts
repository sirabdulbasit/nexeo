/**
 * DEF-386 — owner on Suzi, 2026-11-03 (CL-062): Mixamo. "I've downloaded the first
 * animation" → "You didn't download anything", then six turns of "I clicked Download".
 * Suzi's turn loop clicked a guessed pixel and never looked again.
 *
 * Pinned:
 *  1. the Mixamo shape (click, then finish "done" with no screenshot since) is REFUSED
 *     back to the model, never reported done;
 *  2. a done the independent screen check disagrees with is retried once, then ends
 *     `unverified`, never `done`; only check=true gives `done`;
 *  3. no run without consent; private mode hands the task to Suzi's local operator;
 *     monthly limits refuse; stop ends the run at once, even mid-model-call;
 *  4. a failed action makes every later action in the batch "Not executed";
 *  5. screenshots never reach the ledger;
 *  6. the Claude request uses computer_toolset_20260801 with no name, switches off the
 *     members Suzi has no hands for, and echoes toolset_name on every member result;
 *  7. coordinates: image px → screen points with Suzi's scale/origin; UI-TARS's resized
 *     space → image px.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const db = {
  settings: null as any,
  runsThisMonth: 0,
  stepsThisMonth: 0,
  created: [] as any[],
  updated: [] as any[],
};
vi.mock('../src/db/prisma', () => ({
  default: {
    operatorSettings: { findUnique: async () => db.settings },
    operatorRun: {
      count: async () => db.runsThisMonth,
      aggregate: async () => ({ _sum: { steps: db.stepsThisMonth } }),
      create: async (a: any) => { db.created.push(a.data); return a.data; },
      update: async (a: any) => { db.updated.push(a.data); return a.data; },
    },
    user: { findUnique: async () => ({ clientNumber: 'TMC-0001', isActive: true }) },
  },
}));
vi.mock('../src/services/suzi/gatewayAdminClient', () => ({ verifyGatewaySecret: async (t: any) => t === 'right-secret' }));

import { toScreen, toImage, normaliseKeys, toGatewayAction } from '../src/services/operator/actions';
import { ClaudeOperator, memberToAction, parseUiTars, smartResize, NOT_EXECUTED, type ModelTurn, type OperatorModel, type CallResult } from '../src/services/operator/models';
import { startRun, stepRun, stopRun, _resetRuns, _runCount, costUsd, type OperatorDeps } from '../src/services/operator/operatorService';
import router from '../src/routes/suziGatewayRoutes';

const U = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAABQAAAAMgCAYAAAA'; // IHDR 1280 x 800

/** A model that plays a fixed script and records what it was told. */
class Scripted implements OperatorModel {
  readonly label = 'scripted';
  seen: CallResult[][] = [];
  constructor(private turns: Array<ModelTurn | (() => Promise<ModelTurn>)>) {}
  async next(results: CallResult[]): Promise<ModelTurn> {
    this.seen.push(results);
    const t = this.turns.shift();
    if (!t) throw new Error('script exhausted');
    return typeof t === 'function' ? t() : t;
  }
}

function deps(model: OperatorModel, check: boolean | null = true): OperatorDeps & { checks: number } {
  const d: any = {
    checks: 0,
    makeModel: () => model,
    checker: () => ({
      model: 'claude-opus-5-5',
      client: { messages: { create: async () => { d.checks++; return { content: [{ type: 'text', text: JSON.stringify({ achieved: check, evidence: check ? 'Walking.fbx is in the downloads list' : 'no download is shown' }) }], usage: U }; } } },
    }),
    now: () => Date.now(),
  };
  return d;
}

const consented = { enabled: true, model: 'claude', claudeModel: 'claude-opus-5-5', uitarsBaseUrl: null, uitarsModel: 'x', consentAt: new Date(), consentBy: 2, privateMode: false, blankApps: [], retention: 'none', monthlyTaskLimit: 100, monthlyStepLimit: 3000, maxSteps: 30 };
const who = { clientNumber: 'TMC-0001', userId: 2 };
const shot = (id: string) => ({ call_id: id, ok: true, image_b64: PNG, meta: { scale: 0.5, origin_x: 0, origin_y: 0 } });

beforeEach(() => {
  _resetRuns();
  db.settings = { ...consented };
  db.runsThisMonth = 0; db.stepsThisMonth = 0; db.created = []; db.updated = [];
});

describe('DEF-386 a run cannot end "done" without seeing it', () => {
  it('the Mixamo shape — click, then finish done with no screenshot since — is refused back to the model', async () => {
    const m = new Scripted([
      { calls: [{ id: 'c1', action: { kind: 'click', x: 909, y: 282 } }], usage: U },
      { calls: [], finish: { id: 'f1', outcome: 'done', summary: 'I clicked Download.' }, usage: U },
      { calls: [{ id: 's2', action: { kind: 'screenshot' } }], usage: U },
      { calls: [], finish: { id: 'f2', outcome: 'done', summary: 'Walking.fbx is in Downloads.' }, usage: U },
    ]);
    const d = deps(m, true);
    const s = await startRun({ ...who, goal: 'download Walking from Mixamo' }, d);
    expect(s.status).toBe('act');
    const runId = (s as any).run_id;
    const a1: any = await stepRun({ runId, ...who, results: [shot('open')] }, d);
    expect(a1.actions[0]).toMatchObject({ tool: 'mouse_click' });
    const a2: any = await stepRun({ runId, ...who, results: [{ call_id: 'c1', ok: true, output: 'clicked' }] }, d);
    // The "done" after the click was NOT accepted: the model was told to look, and asked for a screenshot.
    expect(a2.status).toBe('act');
    expect(a2.actions[0]).toMatchObject({ tool: 'screen_capture' });
    expect(m.seen[2][0]).toMatchObject({ id: 'f1', ok: false });
    expect(m.seen[2][0].text).toMatch(/no screenshot since your last action/);
    expect(d.checks).toBe(0);
    const end: any = await stepRun({ runId, ...who, results: [shot('s2')] }, d);
    expect(end).toMatchObject({ status: 'done', verified: true });
    expect(d.checks).toBe(1);
  });

  it('a done the screen check disagrees with is retried once, then ends unverified — never done', async () => {
    const m = new Scripted([
      { calls: [], finish: { id: 'f1', outcome: 'done', summary: 'Downloaded.' }, usage: U },
      { calls: [], finish: { id: 'f2', outcome: 'done', summary: 'Downloaded, really.' }, usage: U },
    ]);
    const d = deps(m, false);
    const s: any = await startRun({ ...who, goal: 'g' }, d);
    const end: any = await stepRun({ runId: s.run_id, ...who, results: [shot('open')] }, d);
    expect(end.status).toBe('unverified');
    expect(end.verified).toBe(false);
    expect(end.evidence).toBe('no download is shown');
    expect(m.seen[1][0].text).toMatch(/check of the screen says the goal is not shown/);
    expect(d.checks).toBe(2);
  });

  it('no checker available → unverified, not done', async () => {
    const m = new Scripted([{ calls: [], finish: { id: 'f1', outcome: 'done', summary: 'ok' }, usage: U }]);
    const d: any = { ...deps(m), checker: () => null };
    const s: any = await startRun({ ...who, goal: 'g' }, d);
    const end: any = await stepRun({ runId: s.run_id, ...who, results: [shot('open')] }, d);
    expect(end).toMatchObject({ status: 'unverified', verified: null });
  });

  it('finishing in the same turn as acting is not accepted; the model hears so with the actions\' results', async () => {
    const m = new Scripted([
      { calls: [{ id: 't1', action: { kind: 'type', text: 'Walking' } }], finish: { id: 'f1', outcome: 'done', summary: 'typed' }, usage: U },
      { calls: [], finish: { id: 'f2', outcome: 'cannot_do', summary: 'search did not open' }, usage: U },
    ]);
    const d = deps(m);
    const s: any = await startRun({ ...who, goal: 'g' }, d);
    await stepRun({ runId: s.run_id, ...who, results: [shot('open')] }, d);
    const end: any = await stepRun({ runId: s.run_id, ...who, results: [{ call_id: 't1', ok: true }] }, d);
    expect(m.seen[1].map((r) => r.id)).toEqual(['t1', 'f1']);
    expect(m.seen[1][1].text).toMatch(/Not accepted yet/);
    expect(end).toMatchObject({ status: 'failed', summary: 'search did not open' });
  });
});

describe('DEF-386 consent, private mode, limits, stop', () => {
  it('refuses without consent, when off, over the limit; private mode → Suzi\'s local operator', async () => {
    const m = new Scripted([]);
    db.settings = { ...consented, consentAt: null };
    expect(await startRun({ ...who, goal: 'g' }, deps(m))).toEqual({ status: 'refused', reason: 'no_consent' });
    db.settings = null; // no row = defaults = off
    expect(await startRun({ ...who, goal: 'g' }, deps(m))).toEqual({ status: 'refused', reason: 'disabled' });
    db.settings = { ...consented, privateMode: true };
    expect(await startRun({ ...who, goal: 'g' }, deps(m))).toEqual({ status: 'local', reason: 'private_mode' });
    db.settings = { ...consented }; db.runsThisMonth = 100;
    expect(await startRun({ ...who, goal: 'g' }, deps(m))).toEqual({ status: 'refused', reason: 'limit_reached' });
    expect(db.created).toHaveLength(0);
  });

  it('stop mid-model-call ends the run at once; later steps answer stopped', async () => {
    let release!: () => void;
    const m = new Scripted([() => new Promise<ModelTurn>((r) => { release = () => r({ calls: [{ id: 'c', action: { kind: 'click', x: 1, y: 1 } }], usage: U }); })]);
    const d = deps(m);
    const s: any = await startRun({ ...who, goal: 'g' }, d);
    const pending = stepRun({ runId: s.run_id, ...who, results: [shot('open')] }, d);
    await new Promise((r) => setTimeout(r, 5));
    const stopped: any = await stopRun({ runId: s.run_id, ...who });
    expect(stopped.status).toBe('stopped');
    release();
    expect((await pending as any).status).toBe('stopped');
    expect(_runCount()).toBe(0);
  });

  it('the step limit ends the run', async () => {
    db.settings = { ...consented, maxSteps: 2 };
    const m = new Scripted([
      { calls: [{ id: 'a', action: { kind: 'screenshot' } }], usage: U },
      { calls: [{ id: 'b', action: { kind: 'screenshot' } }], usage: U },
    ]);
    const d = deps(m);
    const s: any = await startRun({ ...who, goal: 'g' }, d);
    await stepRun({ runId: s.run_id, ...who, results: [shot('open')] }, d);
    await stepRun({ runId: s.run_id, ...who, results: [shot('a')] }, d);
    const end: any = await stepRun({ runId: s.run_id, ...who, results: [shot('b')] }, d);
    expect(end.status).toBe('step_limit');
  });

  it('a failed action makes the rest of the batch "Not executed"; the ledger never holds a screenshot', async () => {
    const m = new Scripted([
      { calls: [{ id: 'k1', action: { kind: 'click_text', text: 'Download' } }, { id: 'k2', action: { kind: 'type', text: 'x' } }], usage: U },
      { calls: [], finish: { id: 'f', outcome: 'needs_user', summary: 'Mixamo asks for a login', question: 'Please log in to Mixamo', reason: 'login' }, usage: U },
    ]);
    const d = deps(m);
    const s: any = await startRun({ ...who, goal: 'g' }, d);
    await stepRun({ runId: s.run_id, ...who, results: [shot('open')] }, d);
    const end: any = await stepRun({ runId: s.run_id, ...who, results: [{ call_id: 'k1', ok: false, error: 'no such label' }] }, d);
    expect(m.seen[1]).toEqual([{ id: 'k1', ok: false, text: 'no such label' }, { id: 'k2', ok: false, text: NOT_EXECUTED }]);
    expect(end).toMatchObject({ status: 'needs_user', question: 'Please log in to Mixamo', reason: 'login' });
    expect(JSON.stringify(db.updated)).not.toContain(PNG);
    expect(db.updated[0]).toMatchObject({ status: 'needs_user', steps: 2, actions: 2 });
  });
});

describe('DEF-386 the Claude request and Suzi mapping', () => {
  it('toolset with no name, unsupported members off, toolset_name echoed, history append-only', async () => {
    const bodies: any[] = [];
    const replies = [
      { stop_reason: 'tool_use', usage: U, content: [{ type: 'thinking', thinking: 'Searching for Walking.', signature: 's' }, { type: 'tool_use', id: 'tu1', name: 'left_click', toolset_name: 'computer', input: { coordinate: [100, 50] } }, { type: 'tool_use', id: 'tu2', name: 'click_text', input: { text: 'Download' } }] },
      { stop_reason: 'tool_use', usage: U, content: [{ type: 'tool_use', id: 'tu3', name: 'finish', input: { outcome: 'cannot_do', summary: 'x' } }] },
    ];
    const client = { messages: { create: async (b: any) => { bodies.push(JSON.parse(JSON.stringify(b))); return replies.shift(); } } };
    const op = new ClaudeOperator('goal', 'macOS', 'claude-opus-5-5', client);
    const t1 = await op.next([{ id: 'open', ok: true, image: PNG }]);
    expect(t1.calls.map((c) => c.action)).toEqual([{ kind: 'click', x: 100, y: 50 }, { kind: 'click_text', text: 'Download', app: undefined, nth: undefined }]);
    expect(t1.note).toBe('Searching for Walking.');
    const ts = bodies[0].tools[0];
    expect(ts.type).toBe('computer_toolset_20260801');
    expect(ts.name).toBeUndefined();
    expect(ts.configs.zoom).toEqual({ enabled: false });
    expect(ts.configs.double_click).toEqual({ enabled: false });
    await op.next([{ id: 'tu1', ok: true }]);
    const results = bodies[1].messages[2].content;
    expect(results[0]).toMatchObject({ tool_use_id: 'tu1', toolset_name: 'computer' });
    expect(results[1]).toMatchObject({ tool_use_id: 'tu2', is_error: true, content: [{ type: 'text', text: NOT_EXECUTED }] });
    expect(results[1].toolset_name).toBeUndefined();
    expect(bodies[1].messages[1].content[0]).toMatchObject({ type: 'thinking', signature: 's' });
  });

  it('members Suzi cannot do are answered, not guessed', () => {
    expect(memberToAction('left_click', { coordinate: [1, 2], text: 'shift' }).kind).toBe('unsupported');
    expect(memberToAction('key', { text: 'Return', repeat: 3 }).kind).toBe('unsupported');
    expect(memberToAction('scroll', { scroll_direction: 'down', scroll_amount: 3 })).toEqual({ kind: 'scroll', direction: 'down', amount: 3 });
  });

  it('image px → screen points with scale/origin, and back; keys normalised; wait capped; blank apps passed', () => {
    const meta = { scale: 1280 / 1512, origin_x: -1512, origin_y: 0 };
    expect(toScreen(640, 400, meta)).toEqual({ x: -756, y: 473 });
    expect(toImage(-756, 473, meta)).toEqual({ x: 640, y: 400 });
    expect(toScreen(10, 20, null)).toEqual({ x: 10, y: 20 });
    expect(normaliseKeys('cmd+Shift+Return')).toBe('cmd+shift+enter');
    expect(normaliseKeys('ctrl c')).toBe('ctrl+c');
    expect(toGatewayAction({ id: 'w', action: { kind: 'wait', seconds: 90 } }, null, [])).toEqual({ call_id: 'w', wait_ms: 10000 });
    expect(toGatewayAction({ id: 's', action: { kind: 'screenshot' } }, null, ['1Password'])).toEqual({ call_id: 's', tool: 'screen_capture', args: { blank_apps: ['1Password'] } });
    expect(toGatewayAction({ id: 'p', action: { kind: 'scroll', direction: 'down', amount: 3 } }, null, [])).toMatchObject({ tool: 'hotkey', args: { keys: 'pagedown' } });
  });

  it('UI-TARS: coordinates come back from its resized space; finished/call_user end the task', () => {
    const r = smartResize(800, 1280);
    expect(r).toEqual({ height: 812, width: 1288 });
    const s = parseUiTars("Thought: click search\nAction: click(start_box='<|box_start|>(1288,812)<|box_end|>')", { width: 1280, height: 800 });
    expect(s.action).toEqual({ kind: 'click', x: 1280, y: 800 });
    expect(parseUiTars("Thought: t\nAction: type(content='Walking\\n')", null).action).toEqual({ kind: 'type', text: 'Walking\n' });
    expect(parseUiTars("Thought: t\nAction: hotkey(key='cmd s')", null).action).toEqual({ kind: 'key', keys: 'cmd s' });
    expect(parseUiTars("Thought: done\nAction: finished(content='Walking.fbx downloaded')", null).action).toEqual({ kind: 'finished', content: 'Walking.fbx downloaded' });
    expect(parseUiTars('Thought: login\nAction: call_user()', null).action).toEqual({ kind: 'call_user' });
  });

  it('cost is priced per model; self-hosted is free per token', () => {
    expect(costUsd('claude-opus-5-5', { inputTokens: 1e6, outputTokens: 1e5, cacheReadTokens: 1e6, cacheWriteTokens: 0 })).toBeCloseTo(4 + 2 + 0.2);
    expect(costUsd('uitars', { inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0);
  });
});

describe('DEF-386 the operator routes trust only the gateway', () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/suzi/gateway', router);
  it('Apache-forwarded or secretless calls never reach the operator', async () => {
    expect((await request(app).post('/suzi/gateway/operator/start').set('Authorization', 'Bearer right-secret').set('X-Forwarded-For', '1.2.3.4').send({ user_id: 2, tenant_id: 'TMC-0001', goal: 'g' })).status).toBe(403);
    expect((await request(app).post('/suzi/gateway/operator/start').send({ user_id: 2, tenant_id: 'TMC-0001', goal: 'g' })).status).toBe(401);
    expect(db.created).toHaveLength(0);
  });
  it('an unknown run is 404', async () => {
    const r = await request(app).post('/suzi/gateway/operator/step').set('Authorization', 'Bearer right-secret').send({ user_id: 2, tenant_id: 'TMC-0001', run_id: 'nope', results: [] });
    expect(r.status).toBe(404);
  });
});
