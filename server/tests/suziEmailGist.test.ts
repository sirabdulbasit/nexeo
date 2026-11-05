/**
 * Founder, 5 Nov: "it should tell what inside this email and whats the point". Pinned: triage's own reading is passed
 * on, its fallbacks about itself are not, the length holds, and with nothing to say the fields are simply absent.
 */
import { describe, it, expect } from 'vitest';
import { emailGist } from '../src/services/suzi/emailGist';

describe('an email\'s gist', () => {
  it('takes what triage wrote, first line only, and what it wants', () => {
    expect(emailGist({ rationale: 'Timesheets for October need approval today.\n3 messages on this thread from a@x', suggestedAction: 'add_open_item' }))
      .toEqual({ summary: 'Timesheets for October need approval today.', point: 'It needs action, not a reply.' });
    expect(emailGist({ rationale: 'She asks for a code.', suggestedAction: 'draft_reply' }).point).toBe('It needs your reply.');
    expect(emailGist({ rationale: 'A chase.', suggestedAction: 'delegate', suggestedDelegateeName: 'Nabeel' }).point).toBe('Nabeel could handle it.');
    expect(emailGist({ rationale: 'A chase.', suggestedAction: 'delegate' }).point).toBe('Someone else could handle it.');
    expect(emailGist({ rationale: 'A note.', suggestedAction: 'ignore' })).toEqual({ summary: 'A note.' });
  });
  it('triage\'s notes about itself aren\'t a summary', () => {
    for (const r of ['No prior pattern — applying default for fyi', 'MD chose this 5 times before (80% consistent)', 'Gate rule "x" (user) matched — ignore.', 'Automated / departmental mailer pattern', 'Self-authored message — not surfaced.', '', null, undefined]) {
      expect(emailGist({ rationale: r, suggestedAction: 'draft_reply' })).toEqual({});
    }
  });
  it('keeps to 200 characters, at a sentence where it can', () => {
    const long = `${'First sentence goes on. '.repeat(6)}${'more words '.repeat(30)}`;
    const s = emailGist({ rationale: long }).summary!;
    expect(s.length).toBeLessThanOrEqual(201);
    expect(s.endsWith('.')).toBe(true);
    const noStop = emailGist({ rationale: 'word '.repeat(80) }).summary!;
    expect(noStop.length).toBeLessThanOrEqual(202);
    expect(noStop.endsWith('…')).toBe(true);
  });
});
