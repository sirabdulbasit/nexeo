/**
 * DEF-380 — one clarifying question, asked once (the iteration-85 regression
 * guard: B02 C3 100→80, "Brain asks the same question twice in quick
 * succession — 'Are you referring to Hamna Latif?' and then 'Which Hamna are
 * you referring to?'").
 *
 * Mechanism, named to code: for decision=ask the final reply is
 * `answerThenAsk(result.answerText, q?.text)` (reasoningCompose.applyDispatch,
 * DEF-211 — the answer and the question are not alternatives). Both fields are
 * JOINED, so a question phrased in answer_text and re-phrased in the question
 * field reaches the owner as the same question twice. The ask contract not
 * only failed to forbid that — its own worked example EMBEDDED the question
 * inside answer_text, teaching the defect (the DEF-213/DEF-223 lesson: the
 * vocabulary the prompt supplies is the vocabulary that comes back).
 *
 * Fix is model-governed judgment text at the decision point: the question is
 * written EXACTLY ONCE, in the question field; answer_text carries statements;
 * and the example now demonstrates the split instead of the defect. No code
 * guard — a code-side question-dedup would be a judging detector
 * (`detector-is-a-list-of-sentences`), and wording belongs to the model.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const reasoning = src('src/services/knowledge/reasoningCompose.ts');
const dispatch = src('src/services/knowledge/reasoningCompose.applyDispatch.ts');

describe('DEF-380 — the ask contract says the question is written once', () => {
  it('states the once-only rule at the decision point, before the JSON shape', () => {
    const rule = reasoning.indexOf('THE QUESTION IS WRITTEN EXACTLY ONCE, in the question field, never also in answer_text');
    const shape = reasoning.indexOf('Output strictly this JSON shape');
    expect(rule).toBeGreaterThan(-1);
    expect(shape).toBeGreaterThan(rule);
  });

  it('names the measured failure it forbids (a rule that cannot say the thing it forbids is weaker — DEF-213)', () => {
    expect(reasoning).toContain('"Are you referring to Hamna Latif?" immediately followed by "Which Hamna are you referring to?"');
  });

  it('the worked example demonstrates the SPLIT, not the defect', () => {
    // The old example put the question inside answer_text's own quoted string:
    //   "… due Friday and unassigned. Did you want the detail, …?"
    // That exact embedded form must be gone.
    expect(reasoning).not.toContain('unassigned. Did you want the detail');
    // The split form is present: answer_text is a statement, the question is
    // its own field.
    expect(reasoning).toContain('answer_text = "He\'s still waiting on the Q3 headcount plan — it\'s due Friday and unassigned."');
    expect(reasoning).toContain('with question = "Did you want the detail, or should I do something about it?"');
  });

  it('answer-then-ask survives: answering what you know BEFORE asking is still the contract', () => {
    expect(reasoning).toContain('ANSWER WHAT YOU ALREADY KNOW BEFORE YOU ASK');
    expect(reasoning).toContain('Leave answer_text null only when you genuinely know nothing yet');
  });

  it('the boundary also lives at the SELECTION POINT — the JSON shape field descriptions (the DEF-149 lesson)', () => {
    // A first live run with only the bullet text still doubled the question;
    // models bind hardest to the field description they are writing into.
    expect(reasoning).toContain('THE ONLY PLACE A QUESTION APPEARS');
    expect(reasoning).toContain('NEVER a question — question.text is appended right after it');
  });

  it('the join this rule exists for is still the mechanism (DEF-211 pin)', () => {
    // If the renderer ever stops joining answer_text with the question, this
    // rule's premise changes and this file should fail loudly rather than pin
    // a dead contract.
    expect(dispatch).toContain('answerThenAsk(result.answerText, q?.text)');
  });
});
