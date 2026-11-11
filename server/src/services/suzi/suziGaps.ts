/**
 * Link T28 items 1-3 (both AGREE, 6 Nov 2026): build control, one of Nexeo's two functions (founder, 6 Nov:
 * "Brain of any user" and "Build control for all Suzi's running in different laptops").
 *
 *   gap.report   (act, signed, voiced, confirmed)  a gap he reported to any Suzi and approved; duplicates merge
 *   gap.approve  (act, signed, confirmed)          a gap reported without approval becomes approved
 *   GET …/gaps                                     his own list, with where each one stands
 *   POST …/gaps/state (Nexeo's builder only)       sorted / in_build / live / declined, owner, hand-over, version
 *
 * Only his verified voice opens one: a signature from his device and a voice score, never text from an email
 * or a screen. His words stay here. What leaves for another builder is a description Nexeo's builder writes,
 * without names or user data. Duplicates are merged without AI: the same normalised wording, or very close
 * spelling, within 14 days. No model is called anywhere in this file.
 */
import prisma from '../../db/prisma';

export const GAP_OPS = ['gap.report', 'gap.approve'] as const;
export const GAP_STATES = ['new', 'approved', 'sorted', 'in_build', 'live', 'declined'] as const;
export const GAP_OWNERS = ['nexeo', 'suzi', 'factory'] as const;
export const MERGE_DAYS = 14;
export const MERGE_SIMILARITY = 0.8;
const MAX_SAID = 2000; const MAX_WHAT = 500; const MAX_SEEN = 200; const KEEP_REPORTS = 10; const LIST_MAX = 100;

export type GapOpResult = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
export interface GapGate { signatureVerified: boolean; voiceScore: number | null; confirmed: boolean; deviceId?: string | null }

type Row = {
  gap_no: string | number; said: string; what: string; seen_on: string | null; source: string; count: number;
  state: string; owner: string | null; handover: string | null; built_version: string | null;
  first_at: Date; last_at: Date; approved_at: Date | null;
};

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
export const gapId = (n: string | number) => `G-${n}`;
/** "G-12", "g12" or "12" → 12. Anything else is no id. */
export function gapNo(id: unknown): number | null {
  const m = /^(?:g-?)?(\d{1,12})$/i.exec(String(id ?? '').trim());
  return m ? Number(m[1]) : null;
}
/** Lower case, letters and digits only, single spaces: "The board, again!" and "the board again" are one. */
export function normalise(s: string): string {
  return s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function toGap(r: Row) {
  return {
    id: gapId(r.gap_no), said: r.said, what: r.what, seen_on: r.seen_on, source: r.source, count: Number(r.count),
    state: r.state, owner: r.owner, built_version: r.built_version,
    first_at: new Date(r.first_at).toISOString(), last_at: new Date(r.last_at).toISOString(),
  };
}

const COLS = `gap_no, said, what, seen_on, source, count, state, owner, handover, built_version, first_at, last_at, approved_at`;

async function report(clientNumber: string, userId: number, a: Record<string, unknown>, g: GapGate): Promise<GapOpResult> {
  if (!g.signatureVerified) return { ok: false, error: 'needs_signature', detail: 'a gap is opened only from his own signed device' };
  if (typeof g.voiceScore !== 'number') return { ok: false, error: 'no_voice_score', detail: 'a gap is opened only by his verified voice' };
  if (!g.confirmed) return { ok: false, error: 'needs_confirmation' };
  const said = text(a.said, MAX_SAID); const what = text(a.what, MAX_WHAT);
  if (!said || !what) return { ok: false, error: 'bad_gap', detail: 'said and what are required' };
  const seen = text(a.seen_on, MAX_SEEN) || null;
  const source = a.source === 'live' ? 'live' : 'training';
  const approved = a.approved === true;
  const norm = normalise(what);
  const entry = { at: new Date().toISOString(), said, seen_on: seen, device_id: g.deviceId ?? null };

  // An open gap of his with the same wording, or very close spelling, in the last 14 days is the same gap.
  const merged = await prisma.$queryRawUnsafe<Row[]>(
    `WITH hit AS (
       SELECT gap_no FROM suzi_gaps
        WHERE client_number = $1 AND user_id = $2 AND state NOT IN ('live', 'declined')
          AND last_at > now() - make_interval(days => ${MERGE_DAYS})
          AND (norm = $3 OR similarity(norm, $3) >= ${MERGE_SIMILARITY})
        ORDER BY (norm = $3) DESC, similarity(norm, $3) DESC, last_at DESC
        LIMIT 1
        FOR UPDATE
     )
     UPDATE suzi_gaps s SET
       count = s.count + 1, said = $4, seen_on = COALESCE($5, s.seen_on), last_at = now(), updated_at = now(),
       reports = (SELECT COALESCE(jsonb_agg(y.x ORDER BY y.i), '[]'::jsonb) FROM (
                    SELECT t.x, t.i FROM jsonb_array_elements(s.reports || jsonb_build_array($6::jsonb)) WITH ORDINALITY t(x, i)
                     ORDER BY t.i DESC LIMIT ${KEEP_REPORTS}) y),
       state = CASE WHEN $7 AND s.state = 'new' THEN 'approved' ELSE s.state END,
       approved_at = CASE WHEN $7 AND s.state = 'new' THEN now() ELSE s.approved_at END,
       approved_by = CASE WHEN $7 AND s.state = 'new' THEN $8 ELSE s.approved_by END
      FROM hit WHERE s.gap_no = hit.gap_no
     RETURNING ${COLS.split(', ').map((c) => `s.${c}`).join(', ')}`,
    clientNumber, userId, norm, said, seen, JSON.stringify(entry), approved, `user:${userId}`,
  );
  if (merged[0]) return { ok: true, item: { ...toGap(merged[0]), merged: true } };

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `INSERT INTO suzi_gaps (client_number, user_id, said, what, seen_on, source, norm, reports, state, approved_at, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, jsonb_build_array($8::jsonb), CASE WHEN $9 THEN 'approved' ELSE 'new' END,
             CASE WHEN $9 THEN now() END, CASE WHEN $9 THEN $10 END)
     RETURNING ${COLS}`,
    clientNumber, userId, said, what, seen, source, norm, JSON.stringify(entry), approved, `user:${userId}`,
  );
  return { ok: true, item: { ...toGap(rows[0]), merged: false } };
}

async function approve(clientNumber: string, userId: number, a: Record<string, unknown>, g: GapGate): Promise<GapOpResult> {
  if (!g.signatureVerified) return { ok: false, error: 'needs_signature', detail: 'a gap is approved only from his own signed device' };
  if (!g.confirmed) return { ok: false, error: 'needs_confirmation' };
  const no = gapNo(a.id);
  if (no === null) return { ok: false, error: 'not_found', detail: 'no such gap' };
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `UPDATE suzi_gaps SET
       state = CASE WHEN state = 'new' THEN 'approved' ELSE state END,
       approved_at = CASE WHEN state = 'new' THEN now() ELSE approved_at END,
       approved_by = CASE WHEN state = 'new' THEN $4 ELSE approved_by END,
       updated_at = now()
      WHERE gap_no = $3 AND client_number = $1 AND user_id = $2
     RETURNING ${COLS}`,
    clientNumber, userId, no, `user:${userId}`,
  );
  if (!rows[0]) return { ok: false, error: 'not_found', detail: 'no such gap' };
  if (rows[0].state === 'declined') return { ok: false, error: 'bad_state', detail: 'it was declined' };
  return { ok: true, item: toGap(rows[0]) };
}

/**
 * SuziUpgrade Charter (Gaps), founder 11 Nov: business information is Nexeo's; bugs, gaps and builds go to Suzi
 * Master, which keeps the one gap list. Once its list is live (this switch, per tenant), Nexeo answers gap.* with
 * `moved` and keeps nothing: the client sends gaps to the master through /v1/master/*.
 */
export const GAPS_MOVED = 'feature_suzi_gaps_moved';

export async function runGapOp(clientNumber: string, userId: number, op: string, args: Record<string, unknown>, gate: GapGate): Promise<GapOpResult> {
  if (GAP_OPS.includes(op as any)) {
    const { isFeatureEnabled } = await import('../featureFlagService');
    if (await isFeatureEnabled(clientNumber, GAPS_MOVED, false)) return { ok: false, error: 'moved', detail: 'gaps go to Suzi Master now' };
  }
  if (op === 'gap.report') return report(clientNumber, userId, args ?? {}, gate);
  if (op === 'gap.approve') return approve(clientNumber, userId, args ?? {}, gate);
  return { ok: false, error: 'unknown_op' };
}

/** His own list, most recent first. */
export async function listGaps(clientNumber: string, userId: number, opts: { state?: string } = {}) {
  const state = (GAP_STATES as readonly string[]).includes(String(opts.state)) ? String(opts.state) : null;
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${COLS} FROM suzi_gaps WHERE client_number = $1 AND user_id = $2 AND ($3::text IS NULL OR state = $3)
      ORDER BY last_at DESC LIMIT ${LIST_MAX}`,
    clientNumber, userId, state,
  );
  return rows.map(toGap);
}

/**
 * Nexeo's builder only (loopback, shared secret; Suzi's server does not relay it): where a gap stands after
 * sorting. The hand-over is the link file the cleaned description went out in; the version is what the
 * other builder reported back.
 */
export async function setGapState(clientNumber: string, userId: number, b: Record<string, unknown>): Promise<GapOpResult> {
  const no = gapNo(b.id);
  if (no === null) return { ok: false, error: 'not_found', detail: 'no such gap' };
  const state = b.state === undefined ? null : String(b.state);
  const owner = b.owner === undefined ? null : String(b.owner);
  if (state !== null && !(GAP_STATES as readonly string[]).includes(state)) return { ok: false, error: 'bad_state', detail: `state is one of ${GAP_STATES.join(', ')}` };
  if (owner !== null && !(GAP_OWNERS as readonly string[]).includes(owner)) return { ok: false, error: 'bad_owner', detail: `owner is one of ${GAP_OWNERS.join(', ')}` };
  const handover = text(b.handover, 200) || null;
  const version = text(b.built_version, 60) || null;
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `UPDATE suzi_gaps SET state = COALESCE($4, state), owner = COALESCE($5, owner), handover = COALESCE($6, handover),
            built_version = COALESCE($7, built_version), updated_at = now()
      WHERE gap_no = $3 AND client_number = $1 AND user_id = $2
     RETURNING ${COLS}`,
    clientNumber, userId, no, state, owner, handover, version,
  );
  if (!rows[0]) return { ok: false, error: 'not_found', detail: 'no such gap' };
  return { ok: true, item: { ...toGap(rows[0]), handover: rows[0].handover } };
}
