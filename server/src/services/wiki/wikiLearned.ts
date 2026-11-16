/**
 * What Nexeo and Suzi learned from the user, in the Wiki (owner, 16 Nov 2026:
 * "wiki should contain all information"; "if nexeo/suzi learn anything from me
 * should also be part of wiki"; docs/Wiki-Knowledge.md §0.23).
 *
 * Every learned thing is one `learned` note, private to the user it was learned
 * from, citing a `record` source that holds the stored row as it was:
 *  - a preference he stated or approved            → in use;
 *  - a preference Brain distilled, not yet approved → waiting for his approval;
 *  - a habit Brain observed (when he is active, what he reads, how he writes);
 *  - a pattern Brain noticed                        → a suggestion only;
 *  - Brain's weekly reviews of his decisions.
 * A learned thing never acts by itself (owner, 13 Nov: patterns suggest; rules,
 * delegations and standing instructions act): each note says so.
 * The stores stay where they are for now (their readers have not moved); the
 * notes are rebuilt from them every hour, so the Wiki is never behind.
 */
import prisma from '../../db/prisma';
import { saveSource, sourceId } from './wikiSources';
import { cleanTitle, titleKey } from './wikiLinks';
import { syncNotes, type BuiltNote, type SyncResult } from './wikiSync';

export const LEARNED_ACTOR = 'wiki_learned';

export interface LearnedRow {
  store: string; id: string; kind: 'preference' | 'habit' | 'pattern' | 'weekly review';
  title: string; text: string; state: 'in use' | 'waiting for his approval' | 'suggestion' | 'observed' | 'draft' | 'rejected';
  howLearned: string; confidence?: number | null; sensitive?: boolean; times?: number | null; at: Date | null;
}

const plain = (t: unknown) => String(t ?? '').replace(/\[\[|\]\]/g, '').trim();
const valueText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? '')).replace(/^"|"$/g, '');
const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Learned rows in, notes out. Pure. `sourceOf` gives each row's source id. */
export function buildLearnedNotes(rows: LearnedRow[], sourceOf: (r: LearnedRow) => string | null): BuiltNote[] {
  const notes: BuiltNote[] = [];
  const used = new Set<string>();
  for (const r of [...rows].sort((a, b) => (a.store + a.id < b.store + b.id ? -1 : 1))) {
    let title = cleanTitle(plain(r.title).slice(0, 150)) || `${r.kind} ${r.id}`;
    if (used.has(titleKey(title))) title = cleanTitle(`${title} (${r.kind}, ${day(r.at) ?? r.id.slice(-6)})`);
    for (let n = 2; used.has(titleKey(title)); n += 1) title = cleanTitle(`${title.replace(/ #\d+$/, '')} #${n}`);
    used.add(titleKey(title));
    const src = sourceOf(r);
    notes.push({
      type: 'learned', title,
      body: [
        `**Kind:** ${r.kind}`,
        `**State:** ${r.state}`,
        `**Acts by itself:** no${r.state === 'in use' ? ' (it is used when Nexeo and Suzi answer him; it sends or changes nothing)' : r.kind === 'pattern' ? ' (a suggestion only)' : ''}`,
        `**How it was learned:** ${r.howLearned}`,
        ...(r.times ? [`**Seen:** ${r.times} time${r.times === 1 ? '' : 's'}`] : []),
        ...(r.confidence != null ? [`**Confidence:** ${Math.round(Number(r.confidence) * 100)}%`] : []),
        ...(day(r.at) ? [`**Learned on:** ${day(r.at)}`] : []),
        '', plain(r.text).slice(0, 6000),
      ].join('\n'),
      properties: { kind: r.kind, state: r.state, store: r.store, sensitive: !!r.sensitive, confidence: r.confidence ?? null, times: r.times ?? null, learnedOn: day(r.at) },
      ids: [`learned:${r.store}:${r.id}`],
      sourceIds: src ? [src] : [],
    });
  }
  return notes;
}

/** Everything the stores hold that was learned from this user. */
export async function loadLearnedRows(clientNumber: string, userId: number): Promise<LearnedRow[]> {
  const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql, clientNumber, userId);
  const out: LearnedRow[] = [];
  for (const m of await q(`SELECT id, memory_type, title, content, source_type, confidence_score, sensitivity_level, status, created_by_brain, created_at
                             FROM governed_brain_memories WHERE client_number = $1 AND user_id = $2`)) {
    out.push({
      store: 'governed_brain_memories', id: String(m.id), kind: 'preference', title: m.title ?? 'A preference', text: m.content ?? '',
      state: m.status === 'active' ? 'in use' : m.status === 'pending_approval' ? 'waiting for his approval' : m.status === 'rejected' ? 'rejected' : 'draft',
      howLearned: m.created_by_brain === false ? 'he said it' : `Brain distilled it${m.source_type ? ` from ${String(m.source_type).replace(/_/g, ' ')}` : ''}`,
      confidence: m.confidence_score, sensitive: m.sensitivity_level === 'sensitive', at: m.created_at,
    });
  }
  for (const m of await q(`SELECT id, key, value, category, source, confidence, confirmed_at, created_at FROM user_memories WHERE client_number = $1 AND user_id = $2`)) {
    out.push({
      store: 'user_memories', id: String(m.id), kind: 'preference', title: String(m.key).replace(/[._]/g, ' '), text: `${m.key}: ${valueText(m.value)}`,
      state: m.source === 'explicit' || m.confirmed_at ? 'in use' : 'observed',
      howLearned: m.source === 'explicit' ? 'he said it' : 'Brain inferred it from how he works', confidence: m.confidence, at: m.created_at,
    });
  }
  for (const m of await q(`SELECT id, category, key, value, score, occurrences, last_seen_at, created_at FROM user_learning WHERE client_number = $1 AND user_id = $2`)) {
    out.push({
      store: 'user_learning', id: String(m.id), kind: 'habit', title: `${String(m.category).replace(/_/g, ' ')}: ${String(m.key).replace(/_/g, ' ')}`,
      text: `${String(m.category).replace(/_/g, ' ')} — ${m.key}: ${valueText(m.value)}`, state: 'observed',
      howLearned: 'Brain counted it from his activity', times: m.occurrences, at: m.last_seen_at ?? m.created_at,
    });
  }
  for (const m of await q(`SELECT id, description, evidence_count, status, created_at FROM pattern_insights WHERE client_number = $1 AND user_id = $2`)) {
    out.push({
      store: 'pattern_insights', id: String(m.id), kind: 'pattern', title: String(m.description ?? 'A pattern').slice(0, 120), text: m.description ?? '',
      state: 'suggestion', howLearned: 'Brain noticed it in what he did with his email', times: m.evidence_count, at: m.created_at,
    });
  }
  for (const m of await q(`SELECT id, type, title, content, status, created_at FROM thought_entries WHERE client_number = $1 AND user_id = $2`)) {
    out.push({
      store: 'thought_entries', id: String(m.id), kind: 'weekly review', title: m.title ?? 'Weekly review', text: m.content ?? '',
      state: m.status === 'published' ? 'in use' : 'draft', howLearned: 'Brain wrote it from the week\'s decisions', at: m.created_at,
    });
  }
  return out;
}

/** Land each learned row as a source and write the notes. */
export async function rebuildLearnedForUser(clientNumber: string, userId: number): Promise<SyncResult & { rows: number }> {
  const rows = await loadLearnedRows(clientNumber, userId);
  for (const r of rows) {
    await saveSource({
      clientNumber, userId, kind: 'record', externalId: `${r.store}:${r.id}`, title: plain(r.title).slice(0, 200), occurredAt: r.at,
      body: plain(r.text), encrypt: !!r.sensitive, asOf: r.at ?? new Date(0),
      details: { store: r.store, kind: r.kind, state: r.state, howLearned: r.howLearned },
    });
  }
  const notes = buildLearnedNotes(rows, (r) => sourceId(clientNumber, userId, 'record', `${r.store}:${r.id}`));
  return { ...(await syncNotes({ clientNumber, userId }, LEARNED_ACTOR, notes)), rows: rows.length };
}
