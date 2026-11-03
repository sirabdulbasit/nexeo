/**
 * The LEARN pass: distill → activate → surface. It runs as a server daily job
 * (server.ts, 02:30 UTC = 07:30 PKT), and `scripts/nexeoLearnSweep.ts` runs it
 * by hand.
 *
 * It used to run only inside the nightly self-improvement build
 * (scripts/orchestrator/nexeo-loop.sh). Owner, 2026-11-03: stop the nightly
 * build but keep learning. So the pass moved here first, and the cron line
 * goes only after this ships (docs/SIMPLIFICATION_PLAN.md).
 *
 * Each half fails alone. A distillation failure leaves its per-tenant cursor
 * unadvanced and the sweep still runs; a digest failure never undoes the
 * sweep. An empty pass is the healthy steady state, not an error.
 */
import { sweepQualifyingMemories } from './learningService';
import { distillInteractions } from './interactionDistiller';

export async function runLearnSweep(opts: { dryRun?: boolean } = {}): Promise<string[]> {
  const dryRun = !!opts.dryRun;
  const lines: string[] = [];
  // DEF-348 — the GENERATION half runs first: distill undistilled interaction
  // history into governed-memory PROPOSALS (pending_approval, human-gated),
  // then the sweep below drains whatever the self-activating class qualifies.
  if (!dryRun) {
    try {
      const d = await distillInteractions();
      lines.push(
        `learn-distill: ${d.scanned} interactions over ${d.groups} user-group(s) in ${d.tenants} tenant(s)`
        + ` · proposed ${d.proposed} · dup-skipped ${d.skippedDuplicate} · below-floor ${d.belowFloor}`
        + (d.tenantsFailed ? ` · TENANTS FAILED ${d.tenantsFailed} (cursor held, retries next run)` : ''),
      );
    } catch (err) {
      lines.push(`learn-distill: FAILED (${err instanceof Error ? err.message.slice(0, 160) : String(err)}) — sweep continues`);
    }
  }
  const r = await sweepQualifyingMemories({ dryRun });
  // DEF-349 — the SURFACING half: tell the owner what awaits HIS gate. One
  // digest per user per day through the normal dispatcher.
  if (!dryRun) {
    try {
      const { runProposalDigest } = await import('./proposalDigest');
      const g = await runProposalDigest();
      lines.push(
        `learn-digest: ${g.usersNotified} user(s) notified · ${g.duplicates} already-today`
        + ` · ${g.skippedAllCovered} tenant(s) all-covered · ${g.skippedDisabled} disabled`
        + (g.tenantScopeSkipped ? ` · ${g.tenantScopeSkipped} tenant-scope skipped` : '')
        + (g.unshowable ? ` · ${g.unshowable} unshowable (blank title)` : '')
        + (g.tenantsFailed ? ` · TENANTS FAILED ${g.tenantsFailed} (coverage unchanged, retries)` : ''),
      );
    } catch (err) {
      lines.push(`learn-digest: FAILED (${err instanceof Error ? err.message.slice(0, 160) : String(err)}) — sweep already ran`);
    }
  }
  const verb = dryRun ? 'would activate' : 'activated';
  lines.push(
    `learn-sweep: scanned ${r.scanned} pending · ${verb} ${r.activated} · held ${r.held}`
    + (r.titles.length ? ` · ${r.titles.map((t) => JSON.stringify(t)).join(', ')}` : ''),
  );
  return lines;
}

/** UTC hour/minute of the daily pass: 02:30 UTC = 07:30 PKT, the nightly build's old slot. */
export const LEARN_SWEEP_UTC = { hour: 2, minute: 30 } as const;

/** True once per UTC day, inside a 10-minute window from LEARN_SWEEP_UTC. */
export function learnSweepDue(now: Date, lastRunUtcDay: string | null): boolean {
  const day = now.toISOString().slice(0, 10);
  if (lastRunUtcDay === day) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const start = LEARN_SWEEP_UTC.hour * 60 + LEARN_SWEEP_UTC.minute;
  return mins >= start && mins < start + 10;
}
