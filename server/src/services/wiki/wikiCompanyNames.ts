/**
 * A company's real name (docs/Wiki-Knowledge.md §0.13, after part 11): a
 * company note is titled by the organisation's name, not by its address
 * domain. The name is read once per company by the model, from what its
 * people's emails say (signatures, the way they name their company), and kept
 * as a `meaning` mark (key `company:<domain>`) on that company's newest email,
 * so it is never paid for twice. The model may say it is not sure: the note
 * then keeps its domain as its title. The domain stays the note's identity
 * (`domain:` ids) and an alias, so a rename keeps the note and every link.
 */
import prisma from '../../db/prisma';
import { markSource } from './wikiMarks';
import { WIKI_GENERATION } from './wikiStore';

const MODEL = 'gemini-flash';
const PROMPT_VERSION = 'company-name-v2';
const SAMPLE_EMAILS = 4;
const SAMPLE_CHARS = 900;

const SYSTEM = `You are given a company's email domain and the ends of a few emails written by people at that company.
Say what the organisation is called, as its own people write it (signature, letterhead, "on behalf of").
Answer with JSON only: {"name":"","sure":true}
- name: the organisation's usual name, short, without "Pvt", "Ltd", "LLC" only when the people themselves leave them out. Never a person's name, never a product, never the domain itself.
- Only the writer's own words and signature count. A product, system or mailbox the writer mentions (a tool they use, a supplier's name) is not their company.
- sure: false when the emails do not show it clearly. Never guess.`;

/** The writer's own part of an email: everything quoted from earlier messages is cut. */
export function ownPart(body: string): string {
  const cut = body.search(/(\bOn [^\n]{0,120}wrote:|-----\s*Original Message|\nFrom: [^\n]+\n(Sent|Date):|\n>)/i);
  return (cut > 0 ? body.slice(0, cut) : body).trim();
}

/** What the model said, checked. Null when it is not a name worth titling a note with. */
export function parseCompanyName(text: string, domain: string): string | null {
  let j: any;
  try { j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { return null; }
  if (!j || j.sure !== true || typeof j.name !== 'string') return null;
  const name = j.name.replace(/\s+/g, ' ').replace(/[[\]|#]/g, '').trim();
  if (name.length < 2 || name.length > 80) return null;
  const d = domain.toLowerCase();
  if (name.toLowerCase() === d || name.toLowerCase() === d.split('.')[0]) return null;
  if (/@|https?:|www\./i.test(name)) return null;
  return name;
}

/** The names already read, by domain. */
export async function loadCompanyNames(clientNumber: string, userId: number): Promise<Map<string, string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ mark_key: string; value: any }>>(
    `SELECT mark_key, value FROM wiki_source_marks
      WHERE client_number = $1 AND user_id = $2 AND kind = 'meaning' AND mark_key LIKE 'company:%' AND superseded_at IS NULL`,
    clientNumber, userId,
  ).catch(() => []);
  const out = new Map<string, string>();
  for (const r of rows) if (r.value?.name && r.value?.prompt === PROMPT_VERSION) out.set(r.mark_key.slice('company:'.length), String(r.value.name));
  return out;
}

/** Read the name of every company note that has not been read yet (at most `limit` per run). */
export async function nameCompanies(
  clientNumber: string, userId: number,
  opts: { limit?: number; call?: (sys: string, msg: string) => Promise<string> } = {},
): Promise<{ companies: number; read: number; named: number; failed: number }> {
  const companies = await prisma.wikiPage.findMany({
    where: { clientNumber, userId, pageType: 'company', status: 'active', metadata: { path: ['wiki'], equals: WIKI_GENERATION } },
    select: { metadata: true },
  });
  const done = await prisma.$queryRawUnsafe<Array<{ mark_key: string }>>(
    `SELECT mark_key FROM wiki_source_marks WHERE client_number = $1 AND user_id = $2 AND kind = 'meaning' AND mark_key LIKE 'company:%' AND superseded_at IS NULL
        AND value->>'prompt' = $3`,
    clientNumber, userId, PROMPT_VERSION,
  ).catch(() => []);
  // Read by an earlier prompt counts as not read: it is asked again with the present one.
  const asked = new Set(done.map((d) => d.mark_key));
  const call = opts.call ?? (async (sys: string, msg: string) => {
    const { callLLM } = await import('../llmRouter');
    return (await callLLM(sys, msg, { providers: [MODEL as any], maxTokens: 200, timeoutMs: 30_000, userId, clientNumber, purpose: 'wiki_company_name' })).text;
  });
  let read = 0; let named = 0; let failed = 0;
  for (const c of companies as any[]) {
    if (opts.limit !== undefined && read >= opts.limit) break;
    const domains: string[] = Array.isArray(c.metadata?.properties?.domains) ? c.metadata.properties.domains : [];
    const domain = domains[0];
    if (!domain || asked.has(`company:${domain}`)) continue;
    const emails = await prisma.$queryRawUnsafe<Array<{ id: string; from_addr: string | null; body_text: string | null }>>(
      `SELECT id, details->>'from' AS from_addr, body_text FROM wiki_sources
        WHERE client_number = $1 AND user_id = $2 AND kind = 'email' AND body_text IS NOT NULL
          AND lower(details->>'from') LIKE $3
        ORDER BY occurred_at DESC NULLS LAST LIMIT ${SAMPLE_EMAILS}`,
      clientNumber, userId, `%@${domain.toLowerCase()}%`,
    );
    if (emails.length === 0) continue;
    const msg = [`Domain: ${domain}`, ...emails.map((e) => `---\nFrom: ${e.from_addr ?? ''}\n…${ownPart(String(e.body_text ?? '')).slice(-SAMPLE_CHARS)}`)].join('\n');
    try {
      const name = parseCompanyName(await call(SYSTEM, msg), domain);
      read += 1;
      await markSource({ clientNumber, userId }, emails[0].id, {
        kind: 'meaning', key: `company:${domain}`, value: { name, domain, model: MODEL, prompt: PROMPT_VERSION }, by: `model:${MODEL}`,
      });
      if (name) named += 1;
    } catch {
      failed += 1;
    }
  }
  return { companies: companies.length, read, named, failed };
}
