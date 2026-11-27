/**
 * T47 assistant step (founder 25 Nov 2026: "think/act like real assistant"). Pinned:
 *  ALLOWED   only the four step kinds, only real task ids, only sent mail makes tasks or follow-ups.
 *  DATES     a due proposal needs a real date; a lead proposal needs a value; bad JSON is nothing.
 *  KEY       one task per commitment: same thread + same words (case/punctuation ignored).
 *  SAFE      the prompt never offers a send, an invite or a direct change: proposals only.
 */
import { describe, it, expect } from 'vitest';
import { parseSteps, taskKey, SYSTEM } from '../src/services/suzi/assistantReasoner';

const ids = new Set(['t1', 't2']);
const j = (steps: unknown[]) => JSON.stringify({ steps });

describe('T47 assistant step', () => {
  it('ALLOWED: real ids only; tasks and follow-ups only from sent mail', () => {
    const raw = j([
      { act: 'link', task_id: 't1', summary: 'Sofia sent the deck' },
      { act: 'link', task_id: 'nope', summary: 'x' },
      { act: 'followup', task_id: 't2', summary: 'you chased Ali' },
      { act: 'task', kind: 'mine', title: 'Send the proposal to Ali', due: '2026-11-28', person_email: null, person_name: null },
      { act: 'send', to: 'x@y.com' },
    ]);
    expect(parseSteps(raw, ids, true).map((s) => s.act)).toEqual(['link', 'followup', 'task']);
    expect(parseSteps(raw, ids, false).map((s) => s.act)).toEqual(['link']);
  });
  it('DATES: due needs a date, lead needs a value, done needs nothing; bad JSON is nothing', () => {
    const raw = j([
      { act: 'propose', task_id: 't1', change: 'due', value: 'next week', why: 'w' },
      { act: 'propose', task_id: 't1', change: 'due', value: '2026-12-01', why: 'Ali wrote on 24 Nov "Monday 1 Dec"' },
      { act: 'propose', task_id: 't2', change: 'lead', value: '', why: 'w' },
      { act: 'propose', task_id: 't2', change: 'done', value: 'x', why: 'Sofia wrote "done"' },
    ]);
    expect(parseSteps(raw, ids, false, '2026-11-25')).toEqual([
      { act: 'propose', task_id: 't1', change: 'due', value: '2026-12-01', why: 'Ali wrote on 24 Nov "Monday 1 Dec"' },
      { act: 'propose', task_id: 't2', change: 'done', value: null, why: 'Sofia wrote "done"' },
    ]);
    expect(parseSteps('not json', ids, true)).toEqual([]);
  });
  it('KEY: the same commitment twice is one key', () => {
    expect(taskKey('th', 'mine', 'Send the deck!')).toBe(taskKey('th', 'mine', 'send  the deck'));
    expect(taskKey('th', 'mine', 'Send the deck')).not.toBe(taskKey('other', 'mine', 'Send the deck'));
  });
  it('SAFE: the model is offered no way to send, invite or change a task directly', () => {
    expect(SYSTEM).not.toMatch(/"act":"(send|invite|update|close)"/);
    expect(SYSTEM).toMatch(/"act":"propose"/);
  });
});
