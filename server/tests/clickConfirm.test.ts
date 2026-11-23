/**
 * click_confirm (founder 23 Nov 2026: "make sure while using manual, then no voice send required"). Pinned:
 *  OPS     a click counts as his yes only for task.followup, email.send, email.delegate, delegation.remove;
 *  SIGNED  only when Suzi's server verified the device's signature;
 *  OTHERS  any other op, or confirmed_by other than 'click', still needs the voiced yes.
 */
import { describe, it, expect } from 'vitest';
import { clickConfirmed, CLICK_CONFIRM_OPS } from '../src/services/suzi/suziAct';

describe('click_confirm', () => {
  it('OPS: exactly the four card steps', () => {
    expect([...CLICK_CONFIRM_OPS]).toEqual(['task.followup', 'email.send', 'email.delegate', 'delegation.remove']);
    for (const op of CLICK_CONFIRM_OPS) expect(clickConfirmed({ op, confirmed_by: 'click', signature_verified: true })).toBe(true);
  });
  it('SIGNED: an unsigned click is not a yes', () => {
    expect(clickConfirmed({ op: 'email.send', confirmed_by: 'click', signature_verified: false })).toBe(false);
    expect(clickConfirmed({ op: 'email.send', confirmed_by: 'click' })).toBe(false);
  });
  it('OTHERS: other ops and other confirmers keep the voice rule', () => {
    for (const op of ['meeting.delete', 'task.create', 'calendar.cancel', 'rule.set', 'gap.open', 'delegation.set'])
      expect(clickConfirmed({ op, confirmed_by: 'click', signature_verified: true })).toBe(false);
    expect(clickConfirmed({ op: 'email.send', confirmed_by: 'voice', signature_verified: true })).toBe(false);
    expect(clickConfirmed({ op: 'email.send', signature_verified: true })).toBe(false);
  });
});
