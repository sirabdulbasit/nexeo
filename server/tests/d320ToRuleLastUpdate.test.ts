/**
 * Suzi 25 Nov 2026 15:17. Pinned:
 *  ADDR  To/Cc headers become lower-case addresses, no duplicates.
 *  TO    a rule {by: "to"} matches when its address is in To or Cc, never on the sender.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/db/prisma', () => ({ default: {} }));
import { addressesIn } from '../src/services/suzi/dayPack';
import { ruleFor } from '../src/services/suzi/suziEmailRules';

describe('to/cc and the "to" rule', () => {
  it('ADDR: header to addresses', () => {
    expect(addressesIn('"VM Team" <VM@tmcltd.com>, ali@x.com, vm@tmcltd.com')).toEqual(['vm@tmcltd.com', 'ali@x.com']);
    expect(addressesIn(null)).toEqual([]);
  });
  it('TO: matches To or Cc, not the sender', () => {
    const rules: any[] = [{ id: 'r1', kind: 'email_ignore', by: 'to', value: 'vm@tmcltd.com' }];
    expect(ruleFor(rules, { from: 'a@x.com', subject: 's', to: ['vm@tmcltd.com'] })?.id).toBe('r1');
    expect(ruleFor(rules, { from: 'a@x.com', subject: 's', to: ['me@x.com'], cc: ['vm@tmcltd.com'] })?.id).toBe('r1');
    expect(ruleFor(rules, { from: 'vm@tmcltd.com', subject: 's', to: ['me@x.com'] })).toBeNull();
    expect(ruleFor(rules, { from: 'a@x.com', subject: 's' })).toBeNull();
  });
});
