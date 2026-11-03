/**
 * DEF-381 — his answer to Brain's own question is an act turn, decided where
 * the decision is made (Codex it-84 directive #1: "a bare-value answer to
 * Brain's own two-part question must emit the update for the provided slot
 * AND re-ask the missing one, never answer with only half and never fail to
 * emit" — DEF-333's open composer-side class, `pending-prompt-eats-command`).
 *
 * The executor path is closed (DEF-375/378/379). The residual, now-dominant
 * B04 failure is decision-level: the model chooses `answer` (with a
 * future-tense promise and action=null — "I'll mark it…", the it-84 live
 * sample) or `ask` (a deflection) when the turn requires `act`. Rule 1a lives
 * in CORE_CONVERSATIONAL_RULES and reaches the live prompt (DEF-366), and the
 * awaiting-answer block exists — but the DECISION CONTRACT, the text the
 * model reads while choosing the enum, said nothing about pending-answer
 * consumption. DEF-380 measured this same lesson one commit ago: the boundary
 * binds at the selection point. This places it there. Model-governed judgment
 * text only; no code guard, no authority moved.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const reasoning = src('src/services/knowledge/reasoningCompose.ts');
const composer = src('src/services/knowledge/brainComposer.ts');

describe('DEF-381 — the act decision owns answers to Brain\'s own question', () => {
  it('the act bullet binds the answer-turn at the decision point, before the JSON shape', () => {
    const rule = reasoning.indexOf('HIS ANSWER TO YOUR OWN QUESTION IS AN act TURN');
    const shape = reasoning.indexOf('Output strictly this JSON shape');
    expect(rule).toBeGreaterThan(-1);
    expect(shape).toBeGreaterThan(rule);
  });

  it('a half-answered two-part question is still an act turn: apply the slot, ask ONLY the missing part', () => {
    expect(reasoning).toContain('apply the answered slot now and let the question field ask ONLY for the missing part');
    expect(reasoning).toContain('replying without emitting the action, both leave his answer unapplied');
  });

  it('the answer bullet refuses the two measured escapes: wrong-enum, and promise-without-action', () => {
    expect(reasoning).toContain('Never choose answer (or ask) for a message that answers a question YOU asked');
    expect(reasoning).toContain('"I\'ll mark it" with action=null claims a write that will never happen');
  });

  it('one vocabulary, two placements: the bare-value examples match rule 1a\'s own words', () => {
    // Rule 1a (CORE_CONVERSATIONAL_RULES) and the contract must not drift
    // apart — if the rule\'s examples change, this fails loudly instead of the
    // two texts teaching different boundaries.
    const examples = '"high", "tomorrow", "the second one"';
    expect(reasoning).toContain(examples);
    expect(composer).toContain(examples);
  });

  it('the information chain is intact: the awaiting-answer block reaches the prompt and carries the binding', () => {
    expect(reasoning).toContain('if (input.dataBlocks.awaitingAnswer) parts.push(input.dataBlocks.awaitingAnswer);');
    expect(composer).toContain("state: 'awaiting_reply'");
    expect(composer).toContain('a candidate answer to it, carry what it settles, and chase only what is still missing');
  });
});
