/**
 * Rebuild the wiki for one user from what the feeds stored (docs/BRAIN_WIKI.md §6).
 *
 *   npx tsx src/scripts/wikiRebuild.ts --client TMC-0001 --user 2 --dry-run --out /path/to/vault
 *   npx tsx src/scripts/wikiRebuild.ts --client TMC-0001 --user 2 --write
 *
 * --dry-run writes nothing to the database. --out also saves the notes as
 * markdown files, one folder per note type, which opens as an Obsidian vault.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import prisma from '../db/prisma';
import { rebuildWikiForUser } from '../services/wiki/wikiBuilder';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const clientNumber = arg('client');
  const userId = Number(arg('user'));
  const write = process.argv.includes('--write');
  if (!clientNumber || !userId || write === process.argv.includes('--dry-run')) {
    console.error('usage: wikiRebuild --client <number> --user <id> (--dry-run [--out <dir>] | --write)');
    process.exit(2);
  }
  const r = await rebuildWikiForUser(clientNumber, userId, { dryRun: !write });
  const out = arg('out');
  if (out) {
    for (const n of r.notes) {
      const dir = path.join(out, n.type);
      fs.mkdirSync(dir, { recursive: true });
      const props = Object.entries(n.properties ?? {})
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
      const file = `${n.title.replace(/[\/\\:*?"<>]/g, ' ')}.md`;
      fs.writeFileSync(path.join(dir, file), `---\ntype: ${n.type}\n${props.join('\n')}\n---\n\n${n.body}\n`);
    }
  }
  console.log(
    JSON.stringify({ stored_items: r.items, notes: r.notes.length, by_type: r.byType, written: r.written, created: r.created, unchanged: r.unchanged, out: out ?? null }),
  );
  await prisma.$disconnect();
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
