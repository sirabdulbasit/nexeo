/**
 * Functional Charter row 3; link T12, P3. The user's own people for Suzi, with no model:
 *   - in the pack: the 100 most recently in contact;
 *   - GET …/people?q=: anyone else, at most 5, matched on spelling as well as exact words, because the
 *     name often arrives through speech-to-text ("rafy" for "Rafay").
 *
 * Every read is limited to this user's own people. Names, addresses and numbers are never logged.
 */
import prisma from '../../db/prisma';
import { queryTerms } from './suziKnowledge';

export const PACK_PEOPLE = 100;
export const MAX_RESULTS = 5;
const MIN_SIMILARITY = 0.3;
/** One word of the question against one word of the name: "rafy" finds Raffaq, "raza" alone at 0.4 is noise. */
const MIN_WORD_SIMILARITY = 0.5;

export interface SuziPerson { id: string; name: string; email?: string; phone?: string }
type Row = { id: string; name: string; email: string | null; phone: string | null };

/** 60 of the founder's people are named by their address. "numair.mazhar@x" reads, and is heard, as Numair Mazhar. */
export function displayName(name: string): string {
  if (!name.includes('@')) return name;
  return name.split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || name;
}

const toPerson = (r: Row): SuziPerson => ({
  id: r.id, name: displayName(r.name),
  ...(r.email ? { email: r.email } : {}),
  ...(r.phone ? { phone: r.phone } : {}),
});

const PICK_FACETS = `
  (array_agg(f.facet_value ORDER BY f.verified DESC, f.last_seen_at DESC NULLS LAST) FILTER (WHERE f.facet_type = 'email'))[1] AS email,
  (array_agg(f.facet_value ORDER BY f.verified DESC, f.last_seen_at DESC NULLS LAST) FILTER (WHERE f.facet_type = 'phone'))[1] AS phone`;

/** Automated senders aren't people she'd be asked about. */
const NOT_A_PERSON = `(no-?reply|do-?not-?reply|notifications?@|mailer-daemon)`;

/**
 * D-335 (founder 27 Nov 13:05, on three "Salman Sohail" in the Delegate search: "why are names being repeated?"): one
 * person is shown once. The Wiki holds a record per address, and a colleague often has several (the same name before
 * the @ at tmcltd.com, tmcltd.ai and tmcloud.net). Two records are the same person here when the names match and
 * the part before the @ matches, or when one of them has no address at all. Kept: the record whose address is at the
 * user's own domain, else the first (the best match). Two people who really share a name keep different addresses, so
 * both stay, each with its address.
 */
export function onePerPerson(people: SuziPerson[], ownDomain: string): SuziPerson[] {
  const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const local = (e?: string) => String(e ?? '').toLowerCase().split('@')[0];
  const domain = (e?: string) => String(e ?? '').toLowerCase().split('@')[1] ?? '';
  const out: SuziPerson[] = [];
  for (const p of people) {
    const i = out.findIndex((o) => norm(o.name) === norm(p.name) && (!o.email || !p.email || local(o.email) === local(p.email)));
    if (i < 0) { out.push(p); continue; }
    const kept = out[i];
    const better = (!kept.email && !!p.email) || (!!p.email && !!ownDomain && domain(p.email) === ownDomain && domain(kept.email) !== ownDomain);
    if (better) out[i] = { ...p, ...(p.phone || !kept.phone ? {} : { phone: kept.phone }) };
    else if (!kept.phone && p.phone) out[i] = { ...kept, phone: p.phone };
  }
  return out;
}

async function ownDomainOf(userId: number): Promise<string> {
  const r = await prisma.$queryRawUnsafe<Array<{ email: string | null }>>(`SELECT lower(email) AS email FROM users WHERE id = $1`, userId).catch(() => []);
  return String(r[0]?.email ?? '').split('@')[1] ?? '';
}

export async function recentPeople(clientNumber: string, userId: number, limit = PACK_PEOPLE): Promise<SuziPerson[]> {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `WITH recent AS (
       SELECT lower(sender_email) AS email, max(created_at) AS at FROM feed_events
        WHERE client_number = $1 AND user_id = $2 AND sender_email IS NOT NULL AND created_at > now() - interval '90 days'
        GROUP BY 1
     )
     SELECT p.id, p.display_name AS name, ${PICK_FACETS}
       FROM persons p
       JOIN person_facets f ON f.person_id = p.id AND f.facet_type IN ('email', 'phone')
       LEFT JOIN recent r ON f.facet_type = 'email' AND lower(f.facet_value) = r.email
      WHERE p.client_number = $1 AND p.user_id = $2
        AND f.facet_value !~* '${NOT_A_PERSON}'
        AND lower(f.facet_value) IS DISTINCT FROM (SELECT lower(email) FROM users WHERE id = $2)
      GROUP BY p.id, p.display_name, p.updated_at
      ORDER BY max(r.at) DESC NULLS LAST, p.updated_at DESC
      LIMIT $3`,
    clientNumber, userId, limit + 40,
  );
  return onePerPerson(rows.map(toPerson), await ownDomainOf(userId)).slice(0, limit);
}

export async function searchPeople(clientNumber: string, userId: number, rawQuery: string): Promise<SuziPerson[]> {
  const q = rawQuery.trim().slice(0, 200);
  if (!q) return [];
  const terms = queryTerms(q);
  const patterns = terms.map((t) => `%${t}%`);
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT p.id, p.display_name AS name, ${PICK_FACETS}
       FROM persons p
       LEFT JOIN person_facets f ON f.person_id = p.id AND f.facet_type IN ('email', 'phone')
      WHERE p.client_number = $1 AND p.user_id = $2
        AND (similarity(p.display_name, $3) >= ${MIN_SIMILARITY}
             OR EXISTS (SELECT 1 FROM unnest($5::text[]) t WHERE word_similarity(t, p.display_name) >= ${MIN_WORD_SIMILARITY})
             OR p.display_name ILIKE ANY($4::text[])
             OR EXISTS (SELECT 1 FROM person_facets e WHERE e.person_id = p.id AND e.facet_type IN ('email', 'phone') AND e.facet_value ILIKE ANY($4::text[])))
      GROUP BY p.id, p.display_name
      ORDER BY GREATEST(similarity(p.display_name, $3), (SELECT max(word_similarity(t, p.display_name)) FROM unnest($5::text[]) t)) DESC NULLS LAST, p.display_name
      LIMIT ${MAX_RESULTS * 4}`,
    clientNumber, userId, q, patterns, terms,
  );
  return onePerPerson(rows.map(toPerson), await ownDomainOf(userId)).slice(0, MAX_RESULTS);
}

/** One of the user's own people by id (link T21, D1). Anyone else's id is not found. */
export async function personById(clientNumber: string, userId: number, id: string): Promise<SuziPerson | null> {
  if (!id || id.length > 100) return null;
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT p.id, p.display_name AS name, ${PICK_FACETS}
       FROM persons p
       LEFT JOIN person_facets f ON f.person_id = p.id AND f.facet_type IN ('email', 'phone')
      WHERE p.id = $3 AND p.client_number = $1 AND p.user_id = $2
      GROUP BY p.id, p.display_name`,
    clientNumber, userId, id,
  );
  return rows[0] ? toPerson(rows[0]) : null;
}
