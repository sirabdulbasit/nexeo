/**
 * DEF-465, W-1.E (Suzi Master AGREE 13 Nov 15:20). Pinned:
 *  PLACE  needs_you or not judged -> emails (never hidden); for_your_knowledge -> fyi; brief / own / handled -> neither;
 *  READ   one item per thread (the newest), with the shape the pack and the brief read, preview <= 200, urgency kept;
 *  RULES  a rule mark keyed by the rule's id with its action; a stale rule mark cleared; the sweep re-marks only what changed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let rows: any[] = [];
const markSource = vi.fn(async () => ({ changed: true }));
const clearMark = vi.fn(async () => ({ changed: true }));
vi.mock('../src/services/wiki/wikiStore', () => ({ listMarkedSources: async () => rows, markSource: (...a: any[]) => (markSource as any)(...a), clearMark: (...a: any[]) => (clearMark as any)(...a) }));
vi.mock('../src/services/wiki/wikiSources', () => ({ readSource: async (_c: string, _u: number, id: string) => ({ body: `${id} body `.repeat(40), details: { from: 'Kashif Mustafa <kashif@x.com>' } }) }));
const rules = [{ id: 'uar_1', kind: 'email_ignore', by: 'sender', value: 'demo_vm@tmcltd.com' }];
vi.mock('../src/services/suzi/suziEmailRules', async (orig) => ({ ...(await (orig as any)()), suziEmailRules: async () => rules }));

import { placeOf, loadWikiEmails, markRulesOn, sweepRuleMarks } from '../src/services/suzi/wikiEmails';

const at = (cls?: string, extra: any = {}) => (cls ? [{ kind: 'attention', value: { class: cls, ...extra } }] : []);
beforeEach(() => { rows = []; markSource.mockClear(); clearMark.mockClear(); });

describe('placement from marks', () => {
  it('needs you or not judged = email; fyi = fyi; brief, own, handled = neither', () => {
    expect(placeOf(at('needs_you'))).toBe('email');
    expect(placeOf([])).toBe('email');
    expect(placeOf(at('for_your_knowledge'))).toBe('fyi');
    expect(placeOf(at('brief'))).toBe('none');
    expect(placeOf(at('own'))).toBe('none');
    expect(placeOf([...at('needs_you'), { kind: 'handled', value: { how: 'handled' } }])).toBe('none');
  });
});

describe('reading from the Wiki', () => {
  it('one per thread (newest), pack-ready fields, preview <= 200, urgency and point kept', async () => {
    rows = [
      { id: 's3', externalId: 'g3', threadKey: 't1', title: 'Re: Objectives', occurredAt: new Date('2026-11-13T04:33:00Z'), marks: at('for_your_knowledge', { reason: 'escalation', why: 'HR chasing Nabeel', urgency: 'high' }) },
      { id: 's2', externalId: 'g2', threadKey: 't1', title: 'Re: Objectives', occurredAt: new Date('2026-11-13T04:29:00Z'), marks: at('for_your_knowledge') },
      { id: 's1', externalId: 'g1', threadKey: 't2', title: 'Approve PO', occurredAt: new Date('2026-11-13T03:00:00Z'), marks: at('needs_you', { urgency: 'critical', point: 'Ali needs your approval today' }) },
      { id: 's0', externalId: 'g0', threadKey: 't3', title: 'Newsletter', occurredAt: new Date('2026-11-13T02:00:00Z'), marks: at('brief') },
    ];
    const r = await loadWikiEmails('T', 2, new Date('2026-11-13T09:00:00Z'));
    expect(r.fyi).toHaveLength(1);
    expect(r.fyi[0]).toMatchObject({ feedEventId: 'g3', threadId: 't1', fromDisplay: 'Kashif Mustafa', fromEmail: 'kashif@x.com', forYourKnowledge: { kind: 'escalation', why: 'HR chasing Nabeel' } });
    expect(r.emails).toHaveLength(1);
    expect(r.emails[0]).toMatchObject({ feedEventId: 'g1', subject: 'Approve PO', criticality: { band: 'critical' }, critical: true, rationale: 'Ali needs your approval today' });
    expect(r.emails[0].preview.length).toBeLessThanOrEqual(200);
  });
});

describe('rule marks', () => {
  it('a matching email gets the rule mark keyed by the rule id; a stale one is cleared', async () => {
    await markRulesOn({ clientNumber: 'T', userId: 2 }, 's9', { from: 'Demo VM <demo_vm@tmcltd.com>', subject: 'x' }, rules as any, [{ kind: 'rule', key: 'uar_old' }]);
    expect(clearMark).toHaveBeenCalledWith({ clientNumber: 'T', userId: 2 }, 's9', 'rule', 'uar_old');
    expect(markSource).toHaveBeenCalledWith({ clientNumber: 'T', userId: 2 }, 's9', { kind: 'rule', key: 'uar_1', by: 'rule:uar_1', value: { action: 'ignore' } });
  });
  it('the sweep touches only emails whose rule mark should change', async () => {
    rows = [
      { id: 'a', title: 'x', participants: ['demo_vm@tmcltd.com'], marks: [{ kind: 'rule', key: 'uar_1' }] }, // already right
      { id: 'b', title: 'x', participants: ['demo_vm@tmcltd.com'], marks: [] },                         // needs the mark
      { id: 'c', title: 'x', participants: ['other@x.com'], marks: [{ kind: 'rule', key: 'uar_gone' }] }, // stale
      { id: 'd', title: 'x', participants: ['other@x.com'], marks: [] },                                // nothing to do
    ];
    expect(await sweepRuleMarks('T', 2, new Date('2026-11-13T09:00:00Z'))).toBe(2);
    expect(markSource).toHaveBeenCalledTimes(1);
    expect(clearMark).toHaveBeenCalledWith({ clientNumber: 'T', userId: 2 }, 'c', 'rule', 'uar_gone');
  });
});
