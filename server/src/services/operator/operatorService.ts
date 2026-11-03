/**
 * DEF-386 — the central screen operator. Nexeo decides, Suzi does the clicking.
 *
 * Owner request 2026-11-03 (CL-062): Suzi claimed "I clicked Download" eight times on
 * Mixamo and downloaded nothing. Its turn loop clicked a guessed pixel and never looked
 * again. Here a model trained for computer use runs a loop that cannot end in "done"
 * without seeing it:
 *
 *   start → Suzi takes a screenshot → step: the model decides one or more actions →
 *   Suzi runs them → step … until finish, needs-the-user, stop, or the step limit.
 *
 * The rules that make the outcome honest:
 *  1. A `done` with no screenshot since the last screen-changing action is refused back
 *     to the model ("look first"), never accepted.
 *  2. A `done` after a screenshot is checked by a separate model call that sees only the
 *     goal and the final screenshot. If it disagrees, the model hears why, once; a second
 *     disagreement ends the run `unverified`, never `done`.
 *  3. "stop" aborts the in-flight model call; the run ends `stopped` at once.
 *
 * Privacy: no run starts without a tenant admin's recorded consent; private mode hands the
 * task to Suzi's local operator (operate_computer) so no screenshot leaves the machine;
 * screenshots live in this process's memory for the run only and are dropped at its end.
 * Usage (steps, tokens, cost) is written per run; monthly limits are checked at start.
 *
 * Facts only: every response carries statuses and the model's own summary, never a spoken
 * line. Suzi's model says "I'll do that on screen" and the progress lines.
 */
import { randomUUID } from 'crypto';
import prisma from '../../db/prisma';
import createLogger from '../../utils/logger';
import { CaptureMeta, GatewayAction, ModelCall, isMutating, toGatewayAction, toImage } from './actions';
import {
  CallResult, ClaudeOperator, DEFAULT_CLAUDE_MODEL, Finish, NOT_EXECUTED, OperatorModel, UiTarsOperator, Usage, ZERO_USAGE,
  anthropicClient, verifyOutcome,
} from './models';

const log = createLogger('operator');

export interface OperatorSettingsView {
  enabled: boolean; model: 'claude' | 'uitars'; claudeModel: string; uitarsBaseUrl: string | null; uitarsModel: string;
  consentAt: Date | null; consentBy: number | null; privateMode: boolean; blankApps: string[]; retention: 'none';
  monthlyTaskLimit: number; monthlyStepLimit: number; maxSteps: number;
}

export const DEFAULT_SETTINGS: OperatorSettingsView = {
  enabled: false, model: 'claude', claudeModel: DEFAULT_CLAUDE_MODEL, uitarsBaseUrl: null, uitarsModel: 'ui-tars-1.5-7b',
  consentAt: null, consentBy: null, privateMode: false, blankApps: [], retention: 'none',
  monthlyTaskLimit: 100, monthlyStepLimit: 3000, maxSteps: 30,
};

export async function getOperatorSettings(clientNumber: string): Promise<OperatorSettingsView> {
  const row: any = await prisma.operatorSettings.findUnique({ where: { clientNumber } });
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    enabled: row.enabled, model: row.model === 'uitars' ? 'uitars' : 'claude', claudeModel: row.claudeModel,
    uitarsBaseUrl: row.uitarsBaseUrl, uitarsModel: row.uitarsModel, consentAt: row.consentAt, consentBy: row.consentBy,
    privateMode: row.privateMode, blankApps: row.blankApps ?? [], retention: 'none',
    monthlyTaskLimit: row.monthlyTaskLimit, monthlyStepLimit: row.monthlyStepLimit, maxSteps: row.maxSteps,
  };
}

// ── pricing (USD per million tokens), for the usage ledger ─────────────────────────────
const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export function costUsd(model: string, u: Usage): number {
  if (!model.startsWith('claude')) return 0; // self-hosted: no per-token bill
  const p = PRICES[model] ?? PRICES[DEFAULT_CLAUDE_MODEL];
  return (u.inputTokens * p.in + u.outputTokens * p.out + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1e6;
}

function addUsage(a: Usage, b: Usage): Usage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens, cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens };
}

// ── runs ───────────────────────────────────────────────────────────────────────────────

export type TerminalStatus = 'done' | 'unverified' | 'needs_user' | 'failed' | 'step_limit' | 'stopped';

export type StartResult =
  | { status: 'act'; run_id: string; actions: GatewayAction[]; max_steps: number }
  | { status: 'local'; reason: 'private_mode' }
  | { status: 'refused'; reason: 'disabled' | 'no_consent' | 'no_model' | 'limit_reached' | 'bad_goal' };

export type StepResult =
  | { status: 'act'; run_id: string; actions: GatewayAction[]; step: number; max_steps: number; progress?: { step: number; max_steps: number; note: string } }
  | { status: TerminalStatus; run_id: string; summary: string; question?: string; reason?: string; evidence?: string; verified: boolean | null; step: number };

export interface GatewayResult { call_id: string; ok: boolean; output?: string; image_b64?: string; meta?: CaptureMeta; error?: string }

interface Run {
  id: string; clientNumber: string; userId: number; goal: string;
  model: OperatorModel; modelName: string; settings: OperatorSettingsView;
  rounds: number; actions: number; usage: Usage;
  meta: CaptureMeta | null; lastImage: string | null; mutatedSinceLook: boolean;
  outstanding: ModelCall[]; local: CallResult[];
  checkRejections: number; busy: boolean; ended: StepResult | null;
  ac: AbortController; touched: number;
}

export interface OperatorDeps {
  makeModel(goal: string, os: string, s: OperatorSettingsView): OperatorModel | null;
  checker(): { client: any; model: string } | null;
  now(): number;
}

export const defaultDeps: OperatorDeps = {
  makeModel(goal, os, s) {
    if (s.model === 'uitars') return s.uitarsBaseUrl ? new UiTarsOperator(goal, s.uitarsBaseUrl, s.uitarsModel, process.env.UITARS_API_KEY) : null;
    const client = anthropicClient();
    return client ? new ClaudeOperator(goal, os, s.claudeModel, client as any) : null;
  },
  checker() {
    const client = anthropicClient();
    return client ? { client, model: DEFAULT_CLAUDE_MODEL } : null;
  },
  now: () => Date.now(),
};

const runs = new Map<string, Run>();
export const IDLE_EXPIRY_MS = 15 * 60_000;
const PROGRESS_EVERY = 3;

/** Tests only. */
export function _resetRuns(): void { runs.clear(); }
export function _runCount(): number { return runs.size; }

function monthStart(now: number): Date { const d = new Date(now); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }

export async function startRun(
  p: { clientNumber: string; userId: number; goal: string; os?: string }, deps: OperatorDeps = defaultDeps,
): Promise<StartResult> {
  sweep(deps);
  const goal = (p.goal ?? '').trim();
  if (!goal || goal.length > 1000) return { status: 'refused', reason: 'bad_goal' };
  const s = await getOperatorSettings(p.clientNumber);
  if (s.privateMode) return { status: 'local', reason: 'private_mode' };
  if (!s.enabled) return { status: 'refused', reason: 'disabled' };
  if (!s.consentAt) return { status: 'refused', reason: 'no_consent' };

  const since = monthStart(deps.now());
  const [count, agg]: any = await Promise.all([
    prisma.operatorRun.count({ where: { clientNumber: p.clientNumber, startedAt: { gte: since } } }),
    prisma.operatorRun.aggregate({ where: { clientNumber: p.clientNumber, startedAt: { gte: since } }, _sum: { steps: true } }),
  ]);
  if (count >= s.monthlyTaskLimit || (agg?._sum?.steps ?? 0) >= s.monthlyStepLimit) return { status: 'refused', reason: 'limit_reached' };

  const model = deps.makeModel(goal, p.os ?? 'macOS', s);
  if (!model) return { status: 'refused', reason: 'no_model' };

  // A new goal supersedes the user's running one.
  for (const r of runs.values()) if (r.clientNumber === p.clientNumber && r.userId === p.userId && !r.ended) await end(r, 'stopped', 'Replaced by a new task.', null);

  const id = randomUUID();
  const run: Run = {
    id, clientNumber: p.clientNumber, userId: p.userId, goal, model, modelName: model.label, settings: s,
    rounds: 0, actions: 0, usage: { ...ZERO_USAGE }, meta: null, lastImage: null, mutatedSinceLook: false,
    outstanding: [{ id: 'open', action: { kind: 'screenshot' } }], local: [],
    checkRejections: 0, busy: false, ended: null, ac: new AbortController(), touched: deps.now(),
  };
  runs.set(id, run);
  await prisma.operatorRun.create({ data: { id, clientNumber: p.clientNumber, userId: p.userId, goal, model: model.label } });
  log.info('operator run started', { runId: id, clientNumber: p.clientNumber, userId: p.userId, model: model.label });
  return { status: 'act', run_id: id, actions: [toGatewayAction(run.outstanding[0], null, s.blankApps)!], max_steps: s.maxSteps };
}

function lookup(runId: string, clientNumber: string, userId: number): Run | null {
  const r = runs.get(runId);
  return r && r.clientNumber === clientNumber && r.userId === userId ? r : null;
}

export class RunBusyError extends Error {}

export async function stepRun(
  p: { runId: string; clientNumber: string; userId: number; results: GatewayResult[] }, deps: OperatorDeps = defaultDeps,
): Promise<StepResult | null> {
  const run = lookup(p.runId, p.clientNumber, p.userId);
  if (!run) return null;
  if (run.ended) return run.ended;
  if (run.busy) throw new RunBusyError('a step is already running for this run');
  run.busy = true;
  run.touched = deps.now();
  try {
    let results = collect(run, p.results ?? []);
    for (;;) {
      if (run.ended) return run.ended; // stopped while the model was thinking
      if (run.rounds >= run.settings.maxSteps) {
        return await end(run, 'step_limit', `Stopped after ${run.rounds} steps without finishing.`, null);
      }
      let turn;
      try {
        turn = await run.model.next(results, run.ac.signal);
      } catch (e: any) {
        if (run.ended) return run.ended;
        log.warn('operator model failed', { runId: run.id, error: e?.message });
        return await end(run, 'failed', `The operator model could not be reached (${String(e?.message ?? 'error').slice(0, 200)}).`, null);
      }
      if (run.ended) return run.ended;
      run.rounds++;
      run.usage = addUsage(run.usage, turn.usage);
      if (turn.refused) return await end(run, 'failed', `The operator model declined this task (${turn.refused}).`, null);

      results = [];
      const f = turn.finish;
      if (f && turn.calls.length && f.id) {
        // Finishing in the same breath as acting: the actions' results are not seen yet.
        run.local.push({ id: f.id, ok: false, text: 'Not accepted yet: check what these actions did first, then call finish again.' });
      } else if (f) {
        const verdict = await judgeFinish(run, f, deps);
        if (verdict.kind === 'end') return verdict.result;
        results.push(verdict.feedback);
        continue;
      }

      const gateway: GatewayAction[] = [];
      const outstanding: ModelCall[] = [];
      for (const c of turn.calls) {
        if (c.action.kind === 'cursor') {
          const pt = run.meta && typeof run.meta.pointer_x === 'number' && typeof run.meta.pointer_y === 'number'
            ? toImage(run.meta.pointer_x, run.meta.pointer_y!, run.meta) : null;
          run.local.push({ id: c.id, ok: !!pt, text: pt ? `X=${pt.x},Y=${pt.y}` : 'The pointer position is not known; take a screenshot.' });
          continue;
        }
        if (c.action.kind === 'unsupported') { run.local.push({ id: c.id, ok: false, text: `Not available: ${c.action.why}.` }); continue; }
        const g = toGatewayAction(c, run.meta, run.settings.blankApps);
        if (g) { gateway.push(g); outstanding.push(c); }
      }
      if (!gateway.length) { results = run.local; run.local = []; continue; }
      // Results already known locally (run.local) ride along with the gateway's on the next step.
      run.outstanding = outstanding;
      run.actions += gateway.length;
      const out: StepResult = { status: 'act', run_id: run.id, actions: gateway, step: run.rounds, max_steps: run.settings.maxSteps };
      if (run.rounds % PROGRESS_EVERY === 0 && turn.note) out.progress = { step: run.rounds, max_steps: run.settings.maxSteps, note: turn.note.slice(0, 300) };
      return out;
    }
  } finally {
    run.busy = false;
    run.touched = deps.now();
  }
}

/** Gateway results → model results, in the order the model asked, with the screen state updated. */
function collect(run: Run, given: GatewayResult[]): CallResult[] {
  const byId = new Map(given.map((g) => [g.call_id, g]));
  const out: CallResult[] = [];
  let failed = false;
  for (const c of run.outstanding) {
    const g = byId.get(c.id);
    if (!g || failed) { out.push({ id: c.id, ok: false, text: NOT_EXECUTED }); failed = true; continue; }
    if (!g.ok) failed = true;
    if (isMutating(c.action)) run.mutatedSinceLook = true; // tried counts: a failed click can still change the screen
    if (c.action.kind === 'screenshot' && g.ok && g.image_b64) {
      run.lastImage = g.image_b64;
      run.meta = g.meta ?? null;
      run.mutatedSinceLook = false;
      out.push({ id: c.id, ok: true, image: g.image_b64 });
    } else {
      out.push({ id: c.id, ok: g.ok, text: g.ok ? (g.output || 'OK') : (g.error || g.output || 'failed') });
    }
  }
  run.outstanding = [];
  out.push(...run.local);
  run.local = [];
  return out;
}

type Judged = { kind: 'end'; result: StepResult } | { kind: 'feedback'; feedback: CallResult };

async function judgeFinish(run: Run, f: Finish, deps: OperatorDeps): Promise<Judged> {
  if (f.outcome === 'needs_user') {
    return { kind: 'end', result: await end(run, 'needs_user', f.summary, null, { question: f.question || f.summary, reason: f.reason }) };
  }
  if (f.outcome === 'cannot_do') return { kind: 'end', result: await end(run, 'failed', f.summary, null) };

  // Rule 1: done must follow a screenshot of the result.
  if (run.mutatedSinceLook || !run.lastImage) {
    return { kind: 'feedback', feedback: { id: f.id, ok: false, text: 'Not accepted: there is no screenshot since your last action, so its result is unseen. Take a screenshot, check it, then call finish.' } };
  }
  // Rule 2: an independent check of the final screen.
  const checker = deps.checker();
  const v = await verifyOutcome(checker?.client ?? null, checker?.model ?? DEFAULT_CLAUDE_MODEL, run.goal, run.lastImage, run.ac.signal);
  run.usage = addUsage(run.usage, v.usage);
  if (v.achieved === true) return { kind: 'end', result: await end(run, 'done', f.summary, true, { evidence: v.evidence }) };
  if (v.achieved === false && run.checkRejections < 1 && f.id) {
    run.checkRejections++;
    return { kind: 'feedback', feedback: { id: f.id, ok: false, text: `Not accepted: a check of the screen says the goal is not shown as reached (${v.evidence}). Continue, or call finish with cannot_do.` } };
  }
  return { kind: 'end', result: await end(run, 'unverified', f.summary, v.achieved === false ? false : null, { evidence: v.evidence }) };
}

async function end(run: Run, status: TerminalStatus, summary: string, verified: boolean | null, extra: { question?: string; reason?: string; evidence?: string } = {}): Promise<StepResult> {
  if (run.ended) return run.ended;
  const result: StepResult = { status, run_id: run.id, summary: summary.slice(0, 2000), verified, step: run.rounds, ...extra };
  run.ended = result;
  run.lastImage = null; // screenshots are never kept past the run
  run.outstanding = []; run.local = [];
  runs.delete(run.id);
  if (status === 'stopped') run.ac.abort();
  try {
    await prisma.operatorRun.update({
      where: { id: run.id },
      data: {
        status, steps: run.rounds, actions: run.actions, verified, summary: result.summary, endedAt: new Date(),
        inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens,
        cacheReadTokens: run.usage.cacheReadTokens, cacheWriteTokens: run.usage.cacheWriteTokens,
        costUsd: costUsd(run.settings.model === 'claude' ? run.settings.claudeModel : 'uitars', run.usage),
      },
    });
  } catch (e: any) {
    log.warn('operator run ledger write failed', { runId: run.id, error: e?.message });
  }
  log.info('operator run ended', { runId: run.id, status, steps: run.rounds, actions: run.actions, verified });
  return result;
}

export async function stopRun(p: { runId: string; clientNumber: string; userId: number }): Promise<StepResult | null> {
  const run = lookup(p.runId, p.clientNumber, p.userId);
  if (!run) return null;
  return end(run, 'stopped', 'Stopped by the user.', null);
}

function sweep(deps: OperatorDeps): void {
  const now = deps.now();
  for (const r of [...runs.values()]) {
    if (!r.busy && now - r.touched > IDLE_EXPIRY_MS) void end(r, 'failed', 'The run expired: no step for 15 minutes.', null);
  }
}

// ── usage, for the admin page ──────────────────────────────────────────────────────────

export async function monthUsage(clientNumber: string, now = Date.now()) {
  const since = monthStart(now);
  const rows: any[] = await prisma.operatorRun.groupBy({
    by: ['status'], where: { clientNumber, startedAt: { gte: since } },
    _count: { _all: true }, _sum: { steps: true, costUsd: true },
  } as any) as any;
  const byStatus: Record<string, number> = {};
  let runsCount = 0; let steps = 0; let cost = 0;
  for (const r of rows) {
    byStatus[r.status] = r._count._all; runsCount += r._count._all;
    steps += r._sum.steps ?? 0; cost += Number(r._sum.costUsd ?? 0);
  }
  return { since: since.toISOString(), runs: runsCount, steps, costUsd: Math.round(cost * 10000) / 10000, byStatus };
}
