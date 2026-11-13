/**
 * DEF-462 (owner 13 Nov, Wiki-Knowledge §0.12): every judged email carries its attention mark on its Wiki source,
 * through markSource only. Pinned: the agreed value shape; not judged = no mark; only emails; the source id is the
 * Gmail message id's; a refusal is reported (not swallowed) and never throws.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let feRows: any[] = [{ source_id: '1a1d41f3c401d958' }];
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: async () => feRows } }));
const mark = vi.fn(async () => ({ changed: true }));
vi.mock('../src/services/wiki/wikiStore', () => ({ markSource: (...a: any[]) => (mark as any)(...a) }));

import { attentionMarkOf, writeAttentionMark, TRIAGE_MARK_BY } from '../src/services/triage/triageMarks';
import { sourceId } from '../src/services/wiki/wikiSources';

const row = { id: 'fe1', clientNumber: 'TMC-0001', userId: 2, sourceType: 'gmail' };
beforeEach(() => { feRows = [{ source_id: '1a1d41f3c401d958' }]; mark.mockReset(); mark.mockResolvedValue({ changed: true }); });

describe('the attention mark', () => {
  it('has the agreed shape', () => {
    expect(attentionMarkOf({ needsYou: true, forYourKnowledge: null })).toEqual({ class: 'needs_you' });
    expect(attentionMarkOf({ needsYou: false, forYourKnowledge: { kind: 'escalation', why: 'HR is chasing Nabeel' } }))
      .toEqual({ class: 'for_your_knowledge', reason: 'escalation', why: 'HR is chasing Nabeel' });
    expect(attentionMarkOf({ needsYou: false, forYourKnowledge: null })).toEqual({ class: 'brief' });
    expect(attentionMarkOf({ needsYou: undefined, forYourKnowledge: null })).toBeNull();
  });
  it('is written on the email\'s Wiki source, by triage:v2', async () => {
    expect(await writeAttentionMark(row, { needsYou: false, forYourKnowledge: { kind: 'escalation', why: 'w' } })).toBe('marked');
    expect(mark).toHaveBeenCalledWith({ clientNumber: 'TMC-0001', userId: 2 }, sourceId('TMC-0001', 2, 'email', '1a1d41f3c401d958'),
      { kind: 'attention', value: { class: 'for_your_knowledge', reason: 'escalation', why: 'w' }, by: TRIAGE_MARK_BY });
    expect(TRIAGE_MARK_BY).toBe('triage:v2');
  });
  it('not judged, or not an email: nothing written', async () => {
    expect(await writeAttentionMark(row, { needsYou: undefined, forYourKnowledge: null })).toBe('not_judged');
    expect(await writeAttentionMark({ ...row, sourceType: 'whatsapp' }, { needsYou: true, forYourKnowledge: null })).toBe('not_email');
    expect(mark).not.toHaveBeenCalled();
  });
  it('a refusal (not landed yet) is reported, never thrown; same value again is "unchanged"', async () => {
    mark.mockRejectedValueOnce(Object.assign(new Error('wikiMarks: no such source'), { name: 'MarkRefused' }));
    expect(await writeAttentionMark(row, { needsYou: true, forYourKnowledge: null })).toBe('refused');
    mark.mockResolvedValueOnce({ changed: false });
    expect(await writeAttentionMark(row, { needsYou: true, forYourKnowledge: null })).toBe('unchanged');
  });
});
