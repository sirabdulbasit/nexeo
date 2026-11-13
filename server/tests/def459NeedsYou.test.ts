/**
 * DEF-459 (CL-089, owner 13 Nov 2026: "Nexeo should filter all those emails where my response is not required … but as
 * per situation (risk radar) this should be in my knowledge"). Pinned:
 *  PROMPT    the model is given To, Cc and where he stands ("only in Cc"), and is asked needsYou / forYourKnowledge;
 *  READ      a missing or malformed answer is "not judged" (kept in view), never "not for you"; forYourKnowledge only
 *            with needsYou false, one of the four kinds, and a reason;
 *  PLACE     ONE rule: needs him or not judged = My Attention; else with a reason = For your knowledge; else copied.
 *            Non-email always My Attention. (The band/stars Cc rule is gone: a Medium Cc email asking someone else
 *            no longer lands in My Attention, and a "please approve" in a Cc does.)
 *  BRIEF     the morning brief has "For your knowledge" lines only when there are any.
 */
import { describe, it, expect } from 'vitest';
import { readNeedsYou, buildUserPrompt } from '../src/services/triage/triageReasoner';
import { placeItem, addressingOf } from '../src/services/triage/triageSuggester';
import { renderForYourKnowledge } from '../src/services/views/dayBrief';

const ctx: any = {
  userId: 2, clientNumber: 'T', itemType: 'email', sourceType: 'gmail', from: 'Kashif Mustafa', fromEmail: 'kashif@x.com', senderDomain: 'x.com',
  subject: 'Re: Correction of Objectives - Delivery', preview: '@Mirza Nabeel Hassan Kindly resolve this pending issue today',
  addressing: { to: 'Fawad Ahmed <fawad@x.com>', cc: 'mirza.nabeel@x.com, Basit Ahmed <basit@x.com>', userIs: 'cc' },
  sender: { isKnown: true, interactionCount: 3, firstContact: false, recentDecisionCounts: {}, dominantDelegationCount: 0, relatedOpenItems: [], threadContext: [] },
  org: { senderOnActiveAccount: false, senderOnActiveProject: false, faclDocTitles: [], faclRelevantDocs: [] },
};

describe('the model sees the addressing', () => {
  it('To, Cc and "only in Cc" are in the prompt', () => {
    const p = buildUserPrompt(ctx);
    expect(p).toContain('To: Fawad Ahmed <fawad@x.com>');
    expect(p).toContain('Cc: mirza.nabeel@x.com, Basit Ahmed <basit@x.com>');
    expect(p).toContain('You (the user) are: only in Cc');
  });
  it('addressingOf finds where he stands', () => {
    const me = new Set(['basit@x.com']);
    expect(addressingOf({ to: 'a@x.com', cc: 'Basit <basit@x.com>' }, me)).toEqual({ to: 'a@x.com', cc: 'Basit <basit@x.com>', userIs: 'cc' });
    expect(addressingOf({ to: 'basit@x.com' }, me).userIs).toBe('to');
    expect(addressingOf({ to: 'list@x.com' }, me).userIs).toBe('none');
  });
});

describe('reading the answer', () => {
  it('not judged is never "not for you"; a reason needs needsYou false and a known kind', () => {
    expect(readNeedsYou({})).toEqual({ needsYou: undefined, forYourKnowledge: null });
    expect(readNeedsYou({ needsYou: 'no' })).toEqual({ needsYou: undefined, forYourKnowledge: null });
    expect(readNeedsYou({ needsYou: false, forYourKnowledge: { kind: 'escalation', why: 'HR asked Nabeel to fix it today' } }))
      .toEqual({ needsYou: false, forYourKnowledge: { kind: 'escalation', why: 'HR asked Nabeel to fix it today' } });
    expect(readNeedsYou({ needsYou: true, forYourKnowledge: { kind: 'risk', why: 'x' } }).forYourKnowledge).toBeNull();
    expect(readNeedsYou({ needsYou: false, forYourKnowledge: { kind: 'gossip', why: 'x' } }).forYourKnowledge).toBeNull();
    expect(readNeedsYou({ needsYou: false, forYourKnowledge: { kind: 'team', why: '' } }).forYourKnowledge).toBeNull();
  });
});

describe('one rule places every item', () => {
  const fyi = { kind: 'escalation' as const, why: 'HR is chasing Nabeel' };
  it('needs him, or not judged: My Attention; non-email always', () => {
    expect(placeItem({ itemType: 'email', needsYou: true, forYourKnowledge: null })).toBe('attention');
    expect(placeItem({ itemType: 'email', needsYou: undefined, forYourKnowledge: null })).toBe('attention');
    expect(placeItem({ itemType: 'whatsapp', needsYou: false, forYourKnowledge: null })).toBe('attention');
  });
  it('needs nothing: For your knowledge with a reason, else copied', () => {
    expect(placeItem({ itemType: 'email', needsYou: false, forYourKnowledge: fyi })).toBe('fyi');
    expect(placeItem({ itemType: 'email', needsYou: false, forYourKnowledge: null })).toBe('copied');
  });
});

describe('the morning brief', () => {
  it('lists things to know only when there are any', () => {
    expect(renderForYourKnowledge(undefined)).toEqual([]);
    expect(renderForYourKnowledge([])).toEqual([]);
    const out = renderForYourKnowledge([{ from: 'Kashif Mustafa', subject: 'Re: Correction of Objectives - Delivery', why: 'HR asked Nabeel to fix Fawad\'s objectives today.', kind: 'escalation' }]);
    expect(out[0]).toBe('\n## For your knowledge (nothing needed from you)');
    expect(out[1]).toBe("- Kashif Mustafa: Correction of Objectives - Delivery. HR asked Nabeel to fix Fawad's objectives today.");
  });
});
