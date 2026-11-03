/**
 * nexeoLearnSweep — the LEARN pass, as a one-shot command.
 *
 * Owner, 2026-09-07: "since learning and improvement is already part of brain's
 * capability that's why i am expecting to make it part of brain's capability (nightly
 * cron) and also update score of brain's capability."
 *
 * The pass itself lives in services/learning/learnSweep.ts and runs daily inside the
 * server (owner, 2026-11-03: stop the nightly build, keep learning). This command runs
 * the same pass by hand. It exits 0 even when it activates nothing — an empty sweep is
 * the healthy steady state, not a failure.
 *
 *   npx ts-node src/scripts/nexeoLearnSweep.ts [--dry-run]
 */
import prisma from '../db/prisma';
import { runLearnSweep } from '../services/learning/learnSweep';

async function main(): Promise<number> {
  const lines = await runLearnSweep({ dryRun: process.argv.includes('--dry-run') });
  for (const l of lines) process.stdout.write(l + '\n');
  return 0;
}

main()
  .then(async (code) => { await prisma.$disconnect(); process.exit(code); })
  .catch(async (err) => {
    process.stderr.write(`nexeoLearnSweep failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
