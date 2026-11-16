/**
 * "Are these two the same thing?" — the one place the Wiki decides it
 * (docs/Wiki-Knowledge.md §0.20; chart tag `identity-from-words`, 7th).
 *
 * Shared words, numbers, senders, projects and conversations can only FIND two
 * readings that might be one thing. Whether they are is a judgement of meaning
 * ("approve the release" and "reject the release" share every word but one),
 * so no rule in code decides it. The builders merge two readings only when
 *   - they are identical (the same file content, the same outside id), or
 *   - the model, shown both in full, says they are the same and that it is sure.
 * No answer, an unsure answer or a failed call means: separate. Every answer is
 * kept as a `meaning` mark (key `<prefix><pair>`) on a source of the pair, so a
 * pair is judged once and a rebuild gives the same Wiki every time.
 */
import crypto from 'crypto';
import prisma from '../../db/prisma';
import { markSource } from './wikiMarks';

const MODEL = 'gemini-flash';
const CONCURRENCY = 6;

export interface PendingPair {
  key: string;
  /** What the model is shown of each side: plain facts, as lines. */
  a: Record<string, unknown>;
  b: Record<string, unknown>;
  /** A source of the pair the answer is kept on. Without one the pair cannot be kept, and stays separate. */
  anchor: string | null;
}

/** What a builder is given: the answers so far, and where it lists the pairs it still needs judged. */
export interface SameJudge {
  verdict: (key: string) => boolean | undefined;
  pending: PendingPair[];
}

/** One key per pair, whatever the order, changing when either side's text or the prompt changes. */
export function pairKey(prefix: string, idA: string, textA: string, idB: string, textB: string, promptVersion: string): string {
  const [x, y] = [`${idA}\u0001${textA}`, `${idB}\u0001${textB}`].sort();
  return prefix + crypto.createHash('sha256').update(`${promptVersion}\u0002${x}\u0002${y}`).digest('hex').slice(0, 24);
}

/** Ask for a pair's answer; an unknown pair is listed as pending and counts as not the same. */
export function isSame(judge: SameJudge | undefined, pair: PendingPair): boolean {
  if (!judge) return false;
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

/** The answers kept so far for this user, by pair key. */
export async function loadVerdicts(clientNumber: string, userId: number, prefix: string): Promise<Map<string, boolean>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ mark_key: string; value: any }>>(
    `SELECT mark_key, value FROM wiki_source_marks
      WHERE client_number = $1 AND user_id = $2 AND kind = 'meaning' AND mark_key LIKE $3 AND superseded_at IS NULL`,
    clientNumber, userId, `${prefix}%`,
  );
  return new Map(rows.map((r) => [r.mark_key, r.value?.same === true && r.value?.sure === true]));
}

const show = (o: Record<string, unknown>) => Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${String(v).replace(/\s+/g, ' ').slice(0, 1600)}`).join('\n');

/**
 * Judge the pending pairs (at most `limit`), keep each answer, and add it to `verdicts`.
 * A failed or malformed answer is not kept: the pair stays separate and is asked again next run.
 */
export async function judgePairs(
  clientNumber: string, userId: number, pending: PendingPair[], verdicts: Map<string, boolean>,
  opts: { system: string; promptVersion: string; purpose: string; limit: number; call?: (sys: string, msg: string) => Promise<string> },
): Promise<{ asked: number; same: number; failed: number; left: number }> {
  const call = opts.call ?? (async (sys: string, msg: string) => {
    const { callLLM } = await import('../llmRouter');
    return (await callLLM(sys, msg, { providers: [MODEL as any], maxTokens: 200, timeoutMs: 30_000, userId, clientNumber, purpose: opts.purpose })).text;
  });
  const todo = pending.filter((p) => p.anchor && !verdicts.has(p.key)).slice(0, Math.max(0, opts.limit));
  let same = 0; let failed = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(todo.slice(i, i + CONCURRENCY).map(async (p) => {
      try {
        const v = parseVerdict(await call(opts.system, `A\n${show(p.a)}\n\nB\n${show(p.b)}`));
        if (!v) { failed += 1; return; }
        await markSource({ clientNumber, userId }, p.anchor!, {
          kind: 'meaning', key: p.key, value: { same: v.same, sure: v.sure, why: v.why, model: MODEL, prompt: opts.promptVersion }, by: `model:${MODEL}`,
        });
        verdicts.set(p.key, v.same && v.sure);
        if (v.same && v.sure) same += 1;
      } catch { failed += 1; }
    }));
  }
  return { asked: todo.length, same, failed, left: pending.filter((p) => !verdicts.has(p.key)).length };
}
