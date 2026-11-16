/**
 * "Are these two the same thing?" — the one place the Wiki decides it
 * (docs/Wiki-Knowledge.md §0.20, §0.21; chart tag `identity-from-words`).
 *
 * Shared words, numbers, senders, projects and conversations can only FIND two
 * readings that might be one thing. Whether they are is a judgement of meaning
 * ("approve the release" and "reject the release" share every word but one),
 * so no rule in code decides it. The builders merge two readings only when
 *   - they are identical (the same file, the same outside id), or
 *   - the model, shown what is listed for both sides, says they are the same
 *     and that it is sure, or
 *   - the user said so himself (an override, which always wins either way).
 * No answer, an unsure answer or a failed call means: separate.
 *
 * What this does and does not promise:
 *  - An answer belongs to exactly what the model was shown. The pair's key is a
 *    fingerprint of both sides' whole payload, the prompt and the model, so a
 *    corrected owner, date, state or piece of evidence asks again; the same
 *    inputs never ask twice.
 *  - Nothing is cut silently. A side that cannot be shown whole is marked
 *    incomplete by its builder, and an incomplete pair is never put to the
 *    model: it stays separate.
 *  - The model can be wrong. A merge is therefore reversible (it is recomputed
 *    from the kept answers on every build; nothing of either reading is lost),
 *    every answer is kept with what it was about, and its accuracy is measured
 *    on a labelled set (scripts/wikiSameEval.ts), not assumed.
 */
import crypto from 'crypto';
import prisma from '../../db/prisma';
import { markSource } from './wikiMarks';
import { stableJson } from '../../utils/stableJson';

export const SAME_MODEL = 'gemini-flash';
/** Added to the prompt for the second reading of a pair the first reading called the same. */
export const CHALLENGE = `A first reader called these two the same. Check that claim against the text: name the strongest difference between A and B (another action, a negation or a hold, another period, person, party, place, amount or number, a term that changes what is owed). If any such difference exists, or you cannot rule one out, answer same=false. Answer same=true, sure=true only if nothing of substance differs.`;
const CONCURRENCY = 6;
/** A field longer than this cannot be shown whole; its builder must say the pair is incomplete instead. */
export const FIELD_LIMIT = 12_000;

export interface PendingPair {
  key: string;
  /** The two things, by their own ids: for the user's own word on the pair, and for auditing an answer. */
  ids: [string, string];
  /** What the model is shown of each side: plain facts, as lines. The key is a fingerprint of exactly this. */
  a: Record<string, unknown>;
  b: Record<string, unknown>;
  /** A source of the pair the answer is kept on. Without one the pair cannot be kept, and stays separate. */
  anchor: string | null;
  /** False when a side could not be shown whole (text cut, a difference too long): never asked, stays separate. */
  complete?: boolean;
}

/** What a builder is given: the answers so far, and where it lists the pairs it still needs judged. */
export interface SameJudge {
  verdict: (key: string) => boolean | undefined;
  /** The user's own word on a pair of ids, which wins over any model answer. */
  override?: (fixKey: string) => boolean | undefined;
  pending: PendingPair[];
  /** Every key the build asked about, so answers no build asks about any more can be retired. */
  seen?: Set<string>;
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** One key per pair, whatever the order: a fingerprint of everything the model is shown, the prompt and the model. */
export function pairKey(prefix: string, idA: string, a: Record<string, unknown>, idB: string, b: Record<string, unknown>, promptVersion: string): string {
  const [x, y] = [`${idA}\u0001${stableJson(a)}`, `${idB}\u0001${stableJson(b)}`].sort();
  return prefix + sha(`${SAME_MODEL}\u0002${promptVersion}\u0002${x}\u0002${y}`).slice(0, 24);
}

/** The key of the user's own word on two ids: it does not change when what is known of them changes. */
export function fixKey(prefix: string, idA: string, idB: string): string {
  const [x, y] = [idA, idB].sort();
  return `${prefix}fix:${sha(`${x}\u0002${y}`).slice(0, 24)}`;
}

/** Build the pair a builder asks about. */
export function pairOf(prefix: string, idA: string, a: Record<string, unknown>, idB: string, b: Record<string, unknown>, promptVersion: string, anchor: string | null, complete = true): PendingPair {
  return { key: pairKey(prefix, idA, a, idB, b, promptVersion), ids: [idA, idB], a, b, anchor, complete };
}

/** Has this pair an answer (the user's or the model's)? */
export function answered(judge: SameJudge | undefined, pair: PendingPair): boolean {
  if (!judge) return false;
  return judge.override?.(fixKey(pair.key.split(':')[0] + ':', pair.ids[0], pair.ids[1])) !== undefined || judge.verdict(pair.key) !== undefined;
}

/** Ask for a pair's answer; an unknown pair is listed as pending and counts as not the same. */
export function isSame(judge: SameJudge | undefined, pair: PendingPair): boolean {
  if (!judge) return false;
  const own = judge.override?.(fixKey(pair.key.split(':')[0] + ':', pair.ids[0], pair.ids[1]));
  if (own !== undefined) return own;
  // A pair that cannot be shown whole is never judged on part of it, and no earlier answer is used for it.
  if (pair.complete === false) return false;
  judge.seen?.add(pair.key);
  const v = judge.verdict(pair.key);
  if (v === undefined && !judge.pending.some((p) => p.key === pair.key)) judge.pending.push(pair);
  return v === true;
}

/** What the model said, checked: the same only when it says so AND says it is sure. */
export function parseVerdict(text: string): { same: boolean; sure: boolean; why: string } | null {
  let j: any;
  try { j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { return null; }
  if (!j || typeof j.same !== 'boolean') return null;
  return { same: j.same === true, sure: j.sure === true, why: typeof j.why === 'string' ? j.why.slice(0, 300) : '' };
}

/** The answers kept so far for this user, by key (the model's by pair key, the user's by fix key). */
export async function loadVerdicts(clientNumber: string, userId: number, prefix: string): Promise<Map<string, boolean>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ mark_key: string; value: any }>>(
    `SELECT mark_key, value FROM wiki_source_marks
      WHERE client_number = $1 AND user_id = $2 AND kind = 'meaning' AND mark_key LIKE $3 AND superseded_at IS NULL`,
    clientNumber, userId, `${prefix}%`,
  );
  return new Map(rows.map((r) => [r.mark_key, r.value?.same === true && r.value?.sure === true]));
}

/** The judge a builder is given, from the kept answers. */
export function judgeFrom(prefix: string, verdicts: Map<string, boolean>): SameJudge {
  return {
    verdict: (k) => (k.startsWith(`${prefix}fix:`) ? undefined : verdicts.get(k)),
    override: (k) => verdicts.get(k),
    pending: [],
    seen: new Set<string>(),
  };
}

/** One side as the model reads it: every field whole, or the call is not made (see `showable`). */
export function show(o: Record<string, unknown>): string {
  return Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${String(v).replace(/[ \t]+/g, ' ').trim()}`).join('\n');
}
/** Can both sides be shown whole? */
export function showable(p: PendingPair): boolean {
  return p.complete !== false && [p.a, p.b].every((o) => Object.values(o).every((v) => String(v ?? '').length <= FIELD_LIMIT));
}

/**
 * Judge the pending pairs (at most `limit`), keep each answer with what it was about, and add it to `verdicts`.
 * A failed or malformed answer is not kept: the pair stays separate and is asked again next run.
 */
export async function judgePairs(
  clientNumber: string, userId: number, pending: PendingPair[], verdicts: Map<string, boolean>,
  opts: { system: string; promptVersion: string; purpose: string; limit: number; call?: (sys: string, msg: string) => Promise<string>; keep?: boolean; challenge?: string;
    /** The model for the second reading, when it should be a stronger one than the first (documents). */
    secondProvider?: string; secondReadings?: number; secondCall?: (sys: string, msg: string) => Promise<string> },
): Promise<{ asked: number; same: number; failed: number; left: number }> {
  const call = opts.call ?? (async (sys: string, msg: string) => {
    const { callLLM } = await import('../llmRouter');
    return (await callLLM(sys, msg, { providers: [SAME_MODEL as any], maxTokens: 200, timeoutMs: 45_000, userId, clientNumber, purpose: opts.purpose })).text;
  });
  const callSecond = opts.secondCall ?? (opts.call || !opts.secondProvider ? call : async (sys: string, msg: string) => {
    const { callLLM } = await import('../llmRouter');
    return (await callLLM(sys, msg, { providers: [opts.secondProvider as any], maxTokens: 400, timeoutMs: 60_000, userId, clientNumber, purpose: opts.purpose })).text;
  });
  const askable = pending.filter((p) => p.anchor && showable(p) && !verdicts.has(p.key));
  const todo = askable.slice(0, Math.max(0, opts.limit));
  let same = 0; let failed = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(todo.slice(i, i + CONCURRENCY).map(async (p) => {
      try {
        const msg = `A\n${show(p.a)}\n\nB\n${show(p.b)}`;
        const first = parseVerdict(await call(opts.system, msg));
        if (!first) { failed += 1; return; }
        // One confident answer is not enough to merge (measured: single answers gave false merges and changed
        // between runs). A "same" is asked a second time, as a challenge to find a difference; the pair is
        // one thing only when both answers say same and sure. A "different" stands at once.
        let v = first;
        if (first.same && first.sure) {
          for (let k = 0; k < (opts.secondReadings ?? 1) && v.same; k += 1) {
            const second = parseVerdict(await callSecond(`${opts.system}\n${opts.challenge ?? CHALLENGE}`, msg));
            if (!second) { failed += 1; return; }
            if (!(second.same && second.sure)) v = { same: false, sure: second.sure, why: `a later reading disagreed: ${second.why}`.slice(0, 300) };
          }
        }
        const small = msg.length <= 4000;
        if (opts.keep !== false) await markSource({ clientNumber, userId }, p.anchor!, {
          kind: 'meaning', key: p.key,
          // Kept with what it was about, so an answer can be audited: the two ids, a fingerprint of the exact
          // text the model read, and that text itself when it is short.
          value: { same: v.same, sure: v.sure, why: v.why, readings: first.same && first.sure ? 1 + (opts.secondReadings ?? 1) : 1, model: SAME_MODEL, ...(first.same && first.sure && opts.secondProvider ? { second: opts.secondProvider } : {}), prompt: opts.promptVersion, pair: p.ids, shown: sha(msg).slice(0, 32), ...(small ? { a: p.a, b: p.b } : {}) },
          by: `model:${SAME_MODEL}`,
        });
        verdicts.set(p.key, v.same && v.sure);
        if (v.same && v.sure) same += 1;
      } catch { failed += 1; }
    }));
  }
  return { asked: todo.length, same, failed, left: askable.length - todo.length + failed };
}

/**
 * Answers no build asks about any more (their pair changed, or is no longer a candidate) are retired:
 * kept in the mark history, no longer current. Call only after a complete build. The user's own word is never retired.
 */
export async function retireUnseen(clientNumber: string, userId: number, prefix: string, seen: Set<string>): Promise<number> {
  return Number(await prisma.$executeRawUnsafe(
    `UPDATE wiki_source_marks SET superseded_at = now()
      WHERE client_number = $1 AND user_id = $2 AND kind = 'meaning' AND superseded_at IS NULL
        AND mark_key LIKE $3 AND mark_key NOT LIKE $4 AND NOT (mark_key = ANY($5::text[]))`,
    clientNumber, userId, `${prefix}%`, `${prefix}fix:%`, [...seen],
  ));
}

/**
 * The user's own word on two things: they are one, or they are not. It wins over the model's answer and does
 * not expire when what is known of them changes. (No screen calls this yet; it is the way a wrong merge is undone.)
 */
export async function setSameOverride(
  writer: { clientNumber: string; userId: number }, prefix: string, idA: string, idB: string, same: boolean, anchor: string, why = '',
): Promise<void> {
  await markSource(writer, anchor, { kind: 'meaning', key: fixKey(prefix, idA, idB), value: { same, sure: true, why: why.slice(0, 300), pair: [idA, idB] }, by: 'user' });
}
