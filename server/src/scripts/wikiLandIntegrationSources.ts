/**
 * One-off, then safe to repeat: land every integration row the engine holds as a Wiki source (Wiki-Knowledge
 * §0.31). New rows land by themselves (contextWriter.landAsSource); this covers rows written before 25 Nov.
 *
 *   npx tsx src/scripts/wikiLandIntegrationSources.ts            (every client)
 *   npx tsx src/scripts/wikiLandIntegrationSources.ts --dry-run
 *
 * A second run changes nothing (saveSource keeps a source whose text and details are unchanged).
 */
import 'dotenv/config';
import prisma from '../db/prisma';
import { landAsSource } from '../services/integrations/engine/contextWriter';

(async () => {
  const dry = process.argv.includes('--dry-run');
  const pages = await (prisma as any).wikiPage.findMany({
    where: { pageType: 'org_doc', metadata: { path: ['source'], equals: 'integration' } },
    select: { id: true, clientNumber: true, metadata: true },
  });
  const integrations = await (prisma as any).integrationSync.findMany({ select: { id: true, name: true } });
  const nameOf = new Map<string, string>(integrations.map((i: any) => [i.id, i.name]));
  let landed = 0;
  let skipped = 0;
  for (const p of pages) {
    const integrationId = (p.metadata as any)?.integrationId;
    if (!integrationId || !nameOf.has(integrationId)) { skipped += 1; continue; }
    if (!dry) await landAsSource(p.id, p.clientNumber, { id: integrationId, name: nameOf.get(integrationId)! });
    landed += 1;
  }
  console.log(JSON.stringify({ pages: pages.length, landed, skipped, dryRun: dry }));
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
