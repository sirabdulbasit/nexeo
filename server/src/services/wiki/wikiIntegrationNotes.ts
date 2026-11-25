/**
 * Integration rows become notes of the kind the integration wizard says they are (founder, 25 Nov 2026:
 * "every kind of integration ... should goes it data into relevant part of wiki ... so using this i can
 * configure N numbers of integrations and fetch data from 3rd party and make it part of wiki").
 * Wiki-Knowledge §0.32; contract agreed with the Integration session the same day.
 *
 * People and companies are built with the user's own contacts (wikiBuilder: by email, by domain). This step
 * builds the other kinds, one note per row:
 *   - identity is the row, never its name: `record:<integrationId>:<recordKey>`;
 *   - titled by the row's name; when another note already holds that title, the integration's name is added;
 *   - facts are properties, a field naming an existing note is a [[link]], personal fields stay out;
 *   - the note cites the row's source; a stale or removed row retires the note at the next build;
 *   - a repeat build writes 0.
 */
import prisma from '../../db/prisma';
import { writeNote, retireNote, WIKI_GENERATION } from './wikiStore';
import { unchangedNote, citationsOf } from './wikiSync';
import { cleanTitle, titleKey, wikiLink } from './wikiLinks';
import { recordFacts, entityOf, noteTitle, type PersonRecord, type RecordEntity } from './wikiBuilder';
import { isNoteType } from './wikiStructure';
import { skipsWikiWork } from './knowledgeModel';

export const INTEGRATION_NOTES_ACTOR = 'wiki_integration';

/** The kinds this step builds. Person and company are built with the user's contacts; 'none' stays a source. */
export const STEP_ENTITIES: ReadonlyArray<RecordEntity> = ['project', 'commitment', 'decision', 'document', 'topic', 'meeting'];

export interface RowSource {
  id: string;
  externalId: string;
  title: string;
  details: any;
}

export interface BuiltRowNote {
  type: string;
  title: string;
  body: string;
  properties: Record<string, unknown>;
  ids: string[];
  sourceIds: string[];
}

/** The row's name: the wizard's title field, else the source's title. */
function rowName(src: RowSource, fields: Record<string, string>): string {
  const tf = src.details?.titleField;
  return noteTitle((typeof tf === 'string' && fields[tf]) || src.title || '');
}

/**
 * The notes for these rows. Pure: `taken` maps a title key to the note holding it (with its ids), so a row
 * whose name is taken by another note is titled with its integration's name.
 */
export function buildRowNotes(rows: RowSource[], linkable: Map<string, string>, taken: Map<string, string[]>): BuiltRowNote[] {
  const out: BuiltRowNote[] = [];
  const used = new Set<string>();
  for (const src of [...rows].sort((a, b) => (a.externalId < b.externalId ? -1 : 1))) {
    const d = src.details ?? {};
    if (d.stale === true || !d.fields || typeof d.fields !== 'object') continue;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.fields)) if (typeof v === 'string') fields[k] = v;
    const entity = entityOf(d, fields);
    if (!STEP_ENTITIES.includes(entity) || !isNoteType(entity)) continue;
    const name = rowName(src, fields);
    if (!name) continue;
    const integration = String(d.integration ?? 'Integration');
    const id = `record:${String(d.integrationId ?? 'integration')}:${src.externalId.replace(/^integration:/, '')}`.toLowerCase();
    const holder = taken.get(`${entity}|${titleKey(name)}`);
    const clash = (holder && !holder.includes(id)) || used.has(`${entity}|${titleKey(name)}`);
    const title = cleanTitle(clash ? `${name} (${integration})` : name);
    used.add(`${entity}|${titleKey(title)}`);
    const rec: PersonRecord = { integration, title: src.title, fields, sourceId: src.id };
    const facts = recordFacts(rec).filter(([k]) => k !== d.titleField);
    const link = (v: string) => {
      const t = linkable.get(v.trim().toLowerCase());
      return t && titleKey(t) !== titleKey(title) ? wikiLink(t) : v;
    };
    out.push({
      type: entity,
      title,
      body: [`From ${integration}.`, '', ...facts.map(([k, v]) => `- **${k}:** ${link(v)}`)].join('\n'),
      properties: { integration, ...Object.fromEntries(facts) },
      ids: [id],
      sourceIds: [src.id],
    });
  }
  return out;
}

/** Build, write and retire this user's integration-row notes. */
export async function rebuildIntegrationNotesForUser(clientNumber: string, userId: number): Promise<{ rows: number; notes: number; written: number; unchanged: number; retired: number; external?: true }> {
  if (await skipsWikiWork(clientNumber, userId)) return { rows: 0, notes: 0, written: 0, unchanged: 0, retired: 0, external: true };
  const rows: RowSource[] = (await (prisma as any).$queryRawUnsafe(
    `SELECT id, external_id AS "externalId", COALESCE(title, '') AS title, details FROM wiki_sources
      WHERE client_number = $1 AND kind = 'record' AND details->>'store' = 'integration'
        AND details->>'entity' = ANY($2::text[])`, clientNumber, [...STEP_ENTITIES]));
  const live = await (prisma as any).wikiPage.findMany({
    where: { clientNumber, userId, status: 'active', metadata: { path: ['wiki'], equals: WIKI_GENERATION } },
    select: { title: true, pageType: true, metadata: true, lastUpdatedBy: true },
  });
  // Links reach only notes that exist; a title held by another note is taken.
  const linkable = new Map<string, string>();
  const taken = new Map<string, string[]>();
  for (const n of live) {
    linkable.set(String(n.title).toLowerCase(), n.title);
    taken.set(`${n.pageType}|${titleKey(n.title)}`, ((n.metadata as any)?.ids ?? []) as string[]);
  }
  const notes = buildRowNotes(rows, linkable, taken);

  const existing = await (prisma as any).wikiPage.findMany({
    where: { clientNumber, userId, lastUpdatedBy: INTEGRATION_NOTES_ACTOR },
    select: { id: true, pageType: true, title: true, bodyMarkdown: true, metadata: true, status: true, scope: true },
  });
  const stored = new Map<string, any>(existing.map((e: any) => [`${e.pageType}|${e.title}`, e]));
  const cited = await citationsOf(existing.map((e: any) => e.id));
  const kept = new Set<string>();
  let written = 0;
  let unchanged = 0;
  for (const n of notes) {
    const have = stored.get(`${n.type}|${cleanTitle(n.title)}`);
    if (have && unchangedNote(have, n as any, cited.get(have.id))) { unchanged += 1; kept.add(have.id); continue; }
    const r = await writeNote({ ...n, clientNumber, userId, actor: INTEGRATION_NOTES_ACTOR, exact: true });
    kept.add(r.id);
    written += 1;
  }
  let retired = 0;
  for (const have of existing) {
    if (kept.has(have.id) || have.status === 'superseded') continue;
    await retireNote(have.id, INTEGRATION_NOTES_ACTOR);
    retired += 1;
  }
  return { rows: rows.length, notes: notes.length, written, unchanged, retired };
}

/** Every Nexeo Owned Data user of the client (called after a real integration run, and hourly by the build). */
export async function rebuildIntegrationNotesForClient(clientNumber: string): Promise<Array<{ userId: number; written?: number; error?: string }>> {
  const users: Array<{ id: number }> = await (prisma as any).$queryRawUnsafe(
    `SELECT id FROM users WHERE client_number = $1 AND knowledge_model = 'nexeo'`, clientNumber);
  const out: Array<{ userId: number; written?: number; error?: string }> = [];
  for (const u of users) {
    try {
      const r = await rebuildIntegrationNotesForUser(clientNumber, u.id);
      out.push({ userId: u.id, written: r.written });
    } catch (err: any) {
      out.push({ userId: u.id, error: String(err?.message ?? err).slice(0, 200) });
    }
  }
  return out;
}
