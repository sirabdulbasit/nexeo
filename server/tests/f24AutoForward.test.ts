/**
 * F-2.4 auto-forward (founder 13 Nov, "Yes, as described"; Suzi Master AGREE C1–C4). Pinned: the C3.2 eligibility
 * (To him only, not his own mail, not a thread he answered); rule.set answers auto:true for a delegate rule (C4).
 */
import { describe, it, expect } from 'vitest';
import { eligible, RULE_FORWARD_DAY_CAP } from '../src/jobs/ruleForwardJob';

const own = new Set(['basit@tmc.com']);
const c = (x: any) => ({ feedId: 'f', messageId: 'm', threadId: 't', from: 'Ali <ali@vendor.com>', to: 'Basit <basit@tmc.com>', cc: '', subject: 'Quote', repliedThread: false, ...x });

describe('C3.2 which emails may be forwarded', () => {
  it('addressed to him, from someone else, unanswered: yes', () => expect(eligible(c({}), own)).toBe(true));
  it('only Cc to him: no', () => expect(eligible(c({ to: 'sales@tmc.com', cc: 'basit@tmc.com' }), own)).toBe(false));
  it('his own mail: no', () => expect(eligible(c({ from: 'Basit <basit@tmc.com>' }), own)).toBe(false));
  it('a thread he already answered: no', () => expect(eligible(c({ repliedThread: true }), own)).toBe(false));
  it('the daily cap is 20', () => expect(RULE_FORWARD_DAY_CAP).toBe(20));
});
