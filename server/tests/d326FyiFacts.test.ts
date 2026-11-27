/**
 * D-326 (T49; Suzi-Builder 26 Nov 10:51). His three questions on "For your knowledge" cards: "was it sent to me?",
 * "why showing again, you didn't check the rule?", "was it not answered?". fyi[] had no to/cc, no reply state, no rules.
 * Pinned (fyiWithFacts):
 *  1. TO_ME: his address in To → "to", in Cc → "cc", in neither → "group"; to[] and cc[] are sent.
 *  2. ANSWERED: an FYI he replied to leaves the list and is counted `answered`.
 *  3. RULES: an ignore rule (the "sent to vm@" kind included) takes it out, counted `ignored`; a delegate rule marks
 *     it ready with by_rule, unless rules forward by themselves.
 *  4. UNKNOWN stays honest: no recipients on record → no to_me; reply not checked → reply_checked false.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/db/prisma', () => ({ default: {} }));
import { fyiWithFacts, type PackFyi } from '../src/services/suzi/dayPack';
import { ruleFor } from '../src/services/suzi/suziEmailRules';

const F = (id: string, from: string, subject = 'S'): { fyi: PackFyi; address: string } => ({ address: from, fyi: { email_id: id, thread_id: `t-${id}`, from, subject, kind: 'cc', why: 'w', point: 'p', urgency: 'normal', received_at: '2026-11-26T10:00:00+05:00', preview: '' } });
const own = new Set(['basit@tmcltd.ai']);
const rules: any[] = [
  { id: 'r-vm', kind: 'email_ignore', by: 'to', value: 'vm@tmcltd.com' },
  { id: 'r-del', kind: 'email_delegate', by: 'sender', value: 'boss@x.com', person_name: 'Ali' },
];
const base = (over: Partial<Parameters<typeof fyiWithFacts>[1]> = {}) => ({
  recips: new Map([
    ['a', { to: ['Basit@tmcltd.ai'], cc: [] }], ['b', { to: ['x@y.com'], cc: ['basit@tmcltd.ai'] }],
    ['c', { to: ['pmo-all@tmcltd.com'], cc: [] }], ['d', { to: ['vm@tmcltd.com'], cc: [] }], ['e', { to: ['basit@tmcltd.ai'], cc: [] }],
  ]),
  replies: new Map([['t-a', { replied_at: null, reply_checked: true }], ['t-e', { replied_at: '2026-11-26T09:00:00Z', reply_checked: true }]]),
  own, at: '2026-11-26T11:00:00+05:00', autoForward: false,
  ruleOf: (e: any) => ruleFor(rules, e) as any,
  ...over,
});

describe('D-326 fyi facts', () => {
  it('TO_ME: to / cc / group, with the addresses', () => {
    const r = fyiWithFacts([F('a', 'z@a.com'), F('b', 'z@a.com'), F('c', 'z@a.com')], base());
    expect(r.fyi.map((x) => x.to_me)).toEqual(['to', 'cc', 'group']);
    expect(r.fyi[2].to).toEqual(['pmo-all@tmcltd.com']);
  });
  it('ANSWERED: leaves the list, counted', () => {
    const r = fyiWithFacts([F('a', 'z@a.com'), F('e', 'z@a.com')], base());
    expect(r.fyi.map((x) => x.email_id)).toEqual(['a']);
    expect(r.answered).toBe(1);
    expect(r.fyi[0]).toMatchObject({ replied_at: null, reply_checked: true });
  });
  it('RULES: the sent-to-vm@ ignore rule takes it out; a delegate rule marks it ready', () => {
    const r = fyiWithFacts([F('d', 'mirza.nabeel@tmcltd.com'), F('a', 'boss@x.com')], base());
    expect(r.ignored).toBe(1);
    expect(r.fyi).toHaveLength(1);
    expect(r.fyi[0].by_rule).toEqual({ action: 'ready', rule_id: 'r-del', person_name: 'Ali', at: '2026-11-26T11:00:00+05:00' });
    expect(fyiWithFacts([F('a', 'boss@x.com')], base({ autoForward: true })).fyi[0].by_rule).toBeUndefined();
  });
  it('UNKNOWN: no recipients on record → no to_me; no reply state → none claimed', () => {
    const r = fyiWithFacts([F('zz', 'z@a.com')], base());
    expect(r.fyi[0].to_me).toBeUndefined();
    expect('replied_at' in r.fyi[0]).toBe(false);
  });
});
