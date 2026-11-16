/**
 * DEF-503 (CL-094, founder 16 Nov 2026): "Proposed new time: TMC System Catalogues @ Fri Nov 13, 2026 3:30pm" was
 * still listed as an email needing his reply on 16 Nov. A calendar notice for a day that is over needs nothing.
 */
import { describe, it, expect } from 'vitest';
import { pastCalendarNotice } from '../src/services/triage/cardTruth';

const now = new Date('2026-11-16T14:00:00Z');
describe('DEF-503 past calendar notices', () => {
  it('a notice for a past day is out', () => {
    expect(pastCalendarNotice('Proposed new time: TMC System Catalogues @ Fri Nov 13, 2026 3:30pm - 4:30pm (GMT+5) (Basit Ahmed)', now)).toBe(true);
    expect(pastCalendarNotice('Invitation: PMS System Demo @ Thu Nov 12, 2026 11am - 12pm (PKT) (basit.ahmed@tmcltd.com)', now)).toBe(true);
    expect(pastCalendarNotice('Accepted: ECP Payroll @ Fri Nov 13, 2026 11:30am - 12:30pm (PKT)', now)).toBe(true);
  });
  it('today, the future and anything that is not a notice stay', () => {
    expect(pastCalendarNotice('Proposed new time: X @ Mon Nov 16, 2026 3:30pm', now)).toBe(false);
    expect(pastCalendarNotice('Invitation: X @ Tue Nov 17, 2026 5pm', now)).toBe(false);
    expect(pastCalendarNotice('Re: TMC Systems Catalogue @ Fri Nov 13, 2026', now)).toBe(false);
    expect(pastCalendarNotice('Invitation: X (no date)', now)).toBe(false);
    expect(pastCalendarNotice(null, now)).toBe(false);
  });
});
