/**
 * Link T41 (both AGREE 18 Nov 2026): the computer operator's control, held in Nexeo.
 *
 * Founder, 18 Nov: one central operator system for every Suzi client, each client isolated, and totally free. So the
 * model and the hands run on the user's own computer (suzi/operator.py); screenshots, page text and file contents
 * never reach Nexeo. Nexeo holds what must be the same on every device and visible to an admin:
 *
 *   pack `operator`        consent, the two permissions, limits, blanked apps, what is used this month
 *   act  operator.report   one line per finished run: counts and outcome, never content
 *   act  operator.permission   his own yes to reading images and to system jobs
 *
 * Stores: the tenant's settings and the run ledger are the existing operator_settings / operator_runs (DEF-386).
 * His two permissions live in users.notification_preferences.suzi.operator, like calendar_touched_at: the Wiki-first
 * ledger allows no new store.
 */
import crypto from 'crypto';
import prisma from '../../db/prisma';
import { getOperatorSettings } from '../operator/operatorService';

export const OPERATOR_OPS = ['operator.report', 'operator.permission'] as const;

// `scheduled` (T41 round 9): a run started by a standing instruction's schedule, not by him at that moment.
export const OPERATOR_JOBS = ['files', 'images', 'system', 'web', 'form', 'ai_tool', 'screen', 'scheduled'] as const;
export const OPERATOR_STATUSES = ['done', 'unverified', 'needs_user', 'failed', 'step_limit', 'stopped', 'declined'] as const;
export const OPERATOR_PROOFS = ['file', 'page', 'screen', 'none'] as const;
export const GOAL_MAX = 200;
export const FOLDERS_MAX = 20;
const FOLDER_MAX_CHARS = 300;
const REPORT_KEYS = new Set(['run_id', 'job', 'status', 'proof', 'steps', 'actions', 'started', 'ended', 'goal']);

export interface OperatorPermissions { images: { allowed: boolean; folders: string[] }; system: { allowed: boolean } }
export interface PackOperator extends OperatorPermissions {
  enabled: boolean;
  consent_at: string | null;
  blank_apps: string[];
  max_steps: number;
  limits: { tasks_month: number; steps_month: number };
  used: { tasks: number; steps: number };
}

type Result = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
const fail = (error: string, detail?: string): Result => ({ ok: false, error, ...(detail ? { detail } : {}) });

const NO_PERMISSIONS: OperatorPermissions = { images: { allowed: false, folders: [] }, system: { allowed: false } };

/** What he has allowed. Nothing stored, or anything unreadable, means nothing is allowed. */
export function readPermissions(stored: unknown): OperatorPermissions {
  const s: any = stored && typeof stored === 'object' ? stored : {};
  const folders = Array.isArray(s.images?.folders) ? s.images.folders.filter((f: unknown) => typeof f === 'string').slice(0, FOLDERS_MAX) : [];
  return { images: { allowed: s.images?.allowed === true, folders }, system: { allowed: s.system?.allowed === true } };
}

export async function permissionsOf(clientNumber: string, userId: number): Promise<OperatorPermissions> {
  const rows = await prisma.$queryRawUnsafe<Array<{ p: unknown }>>(
    `SELECT notification_preferences->'suzi'->'operator' AS p FROM users WHERE client_number = $1 AND id = $2`, clientNumber, userId,
  );
  return rows.length ? readPermissions(rows[0].p) : { ...NO_PERMISSIONS };
}

function monthStart(now: Date): Date { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); }

/** This month's runs and steps for the customer: the limits are the customer's, so the count is too. Counts only. */
export async function usedThisMonth(clientNumber: string, now = new Date()): Promise<{ tasks: number; steps: number }> {
  const where = { clientNumber, startedAt: { gte: monthStart(now) } };
  const [tasks, agg] = await Promise.all([
    prisma.operatorRun.count({ where }),
    prisma.operatorRun.aggregate({ where, _sum: { steps: true } }),
  ]);
  return { tasks, steps: agg?._sum?.steps ?? 0 };
}

/** The pack's `operator`. No settings row, or no recorded consent, means `enabled: false`. */
export async function packOperator(clientNumber: string, userId: number, now = new Date()): Promise<PackOperator> {
  const [s, perms, used] = await Promise.all([getOperatorSettings(clientNumber), permissionsOf(clientNumber, userId), usedThisMonth(clientNumber, now)]);
  return {
    enabled: s.enabled && !!s.consentAt,
    consent_at: s.consentAt ? s.consentAt.toISOString() : null,
    ...perms,
    blank_apps: s.blankApps,
    max_steps: s.maxSteps,
    limits: { tasks_month: s.monthlyTaskLimit, steps_month: s.monthlyStepLimit },
    used,
  };
}

/** One customer's and one user's run ids never meet another's: the stored id is a hash of all three. */
export function runRowId(clientNumber: string, userId: number, runId: string): string {
  return `loc_${crypto.createHash('sha256').update(`${clientNumber}\u0000${userId}\u0000${runId}`).digest('hex').slice(0, 40)}`;
}

const count = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
const when = (v: unknown): Date | null => { const d = new Date(typeof v === 'string' ? v : NaN); return isNaN(d.getTime()) ? null : d; };

/**
 * operator.report: the desktop says a run ended. Counts and outcome only; an argument outside the agreed list is
 * refused, so a screenshot, file content or typed text has no field to arrive in. A `done` with no proof is kept as
 * `unverified`: the same rule the desktop applies before speaking, held here too.
 */
async function report(clientNumber: string, userId: number, args: Record<string, unknown>): Promise<Result> {
  const extra = Object.keys(args).filter((k) => !REPORT_KEYS.has(k));
  if (extra.length) return fail('bad_args', `not accepted: ${extra.slice(0, 5).join(', ')}`);
  const runId = typeof args.run_id === 'string' ? args.run_id.trim() : '';
  if (!/^[\w.:-]{1,100}$/.test(runId)) return fail('bad_run_id');
  const job = String(args.job ?? '');
  if (!(OPERATOR_JOBS as readonly string[]).includes(job)) return fail('bad_job');
  const said = String(args.status ?? '');
  if (!(OPERATOR_STATUSES as readonly string[]).includes(said)) return fail('bad_status');
  const proof = String(args.proof ?? '');
  if (!(OPERATOR_PROOFS as readonly string[]).includes(proof)) return fail('bad_proof');
  const steps = count(args.steps, 1000);
  const actions = count(args.actions, 10000);
  if (steps === null || actions === null) return fail('bad_count');
  const started = when(args.started);
  const ended = when(args.ended);
  if (!started || !ended || ended.getTime() < started.getTime()) return fail('bad_time');
  if (args.goal !== undefined && typeof args.goal !== 'string') return fail('bad_goal');
  const goal = String(args.goal ?? '').trim().slice(0, GOAL_MAX);

  const status = said === 'done' && proof === 'none' ? 'unverified' : said;
  const id = runRowId(clientNumber, userId, runId);
  const existing: any = await prisma.operatorRun.findUnique({ where: { id } });
  const row: any = existing ?? await prisma.operatorRun.create({
    data: {
      id, clientNumber, userId, goal, model: `local:${job}`, status, steps, actions,
      verified: status === 'done', summary: `proof:${proof}`, startedAt: started, endedAt: ended,
    },
  }).catch(async (e: any) => {
    // Two reports of the same run at once: the second reads what the first wrote.
    if (e?.code !== 'P2002') throw e;
    return prisma.operatorRun.findUnique({ where: { id } });
  });
  return { ok: true, item: { run_id: runId, status: row.status, verified: row.verified === true, ...(existing ? { already: true } : {}), used: await usedThisMonth(clientNumber) } };
}

/**
 * operator.permission: his own yes or no to reading images (in which folders) and to system jobs. Confirmed by him,
 * unsigned: nothing leaves his computer because of it. A part that is not sent keeps its value.
 */
async function permission(clientNumber: string, userId: number, args: Record<string, unknown>, confirmed: boolean): Promise<Result> {
  if (!confirmed) return fail('needs_confirmation');
  const images: any = args.images;
  const system: any = args.system;
  if (images === undefined && system === undefined) return fail('bad_args', 'images or system is required');
  const next = await permissionsOf(clientNumber, userId);
  if (images !== undefined) {
    if (!images || typeof images !== 'object' || typeof images.allowed !== 'boolean') return fail('bad_images');
    let folders = next.images.folders;
    if (images.folders !== undefined) {
      if (!Array.isArray(images.folders) || images.folders.length > FOLDERS_MAX) return fail('bad_folders');
      if (images.folders.some((f: unknown) => typeof f !== 'string' || !f.trim() || f.length > FOLDER_MAX_CHARS)) return fail('bad_folders');
      folders = [...new Set<string>(images.folders.map((f: string) => f.trim()))];
    }
    // A no forgets the folders: a later yes names them again.
    next.images = { allowed: images.allowed, folders: images.allowed ? folders : [] };
  }
  if (system !== undefined) {
    if (!system || typeof system !== 'object' || typeof system.allowed !== 'boolean') return fail('bad_system');
    next.system = { allowed: system.allowed };
  }
  const changed = await prisma.$executeRawUnsafe(
    `UPDATE users SET notification_preferences = jsonb_set(COALESCE(notification_preferences, '{}'::jsonb), '{suzi}',
        COALESCE(notification_preferences->'suzi', '{}'::jsonb) || jsonb_build_object('operator', $3::jsonb, 'operator_touched_at', now()::text))
      WHERE id = $2 AND client_number = $1`, clientNumber, userId, JSON.stringify(next),
  );
  if (!changed) return fail('not_found');
  return { ok: true, item: next };
}

export async function runOperatorOp(clientNumber: string, userId: number, op: string, args: Record<string, unknown>, confirmed: boolean): Promise<Result> {
  if (op === 'operator.report') return report(clientNumber, userId, args);
  if (op === 'operator.permission') return permission(clientNumber, userId, args, confirmed);
  return fail('unknown_op');
}
