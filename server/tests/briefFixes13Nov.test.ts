/**
 * "fix the brief" (founder 13 Nov: "fix the brief (where UI/UX will not be changed)"). Pinned:
 *  DEF-415  the brief carries his local time and the greeting must fit it;
 *  DEF-422  "Other open items" is the true remainder, not what is left of a list capped at 20;
 *  names    attendees are named where we know the person, never his own address;
 *  DEF-420  every action-lifecycle ask folds into the brief (governor AND reply interpreter); an emergency never folds.
 */
import { describe, it, expect } from 'vitest';
import { renderDayBriefBlock } from '../src/services/views/dayBrief';
import { foldsIntoBrief } from '../src/services/notifications/brainOutboundService';

const base: any = {
  generatedAt: new Date('2026-11-13T07:34:00Z'), localDate: '2026-11-13', localTimezone: 'Asia/Karachi',
  calendar: [{ title: 'ECP Payroll', localTime: '16:30', isAllDay: false, attendees: ['fida@x.com', 'basit@x.com', 'new@x.com'] }],
  openItems: Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, title: `item ${i}`, dueDate: null, priority: 'medium' })),
  attention: [], asks: [], recentEmails: [], recentWhatsApp: [], followUps: null,
  ownEmails: ['basit@x.com'], openTotal: 57, nowLocal: '12:34', attendeeNames: { 'fida@x.com': 'Fida Ahmed Khan' },
};

describe('the brief', () => {
  it('DEF-415: says the local time and that the greeting must fit it', () => {
    expect(renderDayBriefBlock(base)).toContain('Local time now: 12:34. Any greeting must fit this time of day (never "Good morning" after 12:00).');
  });
  it('DEF-422: other open items is the true remainder', () => {
    expect(renderDayBriefBlock(base)).toMatch(/## Other open items \(57\)\n- 57 more in the Action Center/);
  });
  it('names attendees we know; never his own address; an unknown one stays an address', () => {
    const out = renderDayBriefBlock(base);
    expect(out).toContain('- 16:30 ECP Payroll — with Fida Ahmed Khan, new@x.com');
    expect(out).not.toContain('basit@x.com');
  });
});

describe('DEF-420', () => {
  it('both lifecycle producers fold into the brief; an emergency does not', () => {
    expect(foldsIntoBrief({ kind: 'brain_prompt', metadata: { source: 'action_lifecycle_reply' } })).toBe(true);
    expect(foldsIntoBrief({ kind: 'brain_prompt', metadata: { source: 'action_lifecycle_governor' } })).toBe(true);
    expect(foldsIntoBrief({ kind: 'brain_prompt', urgency: 'emergency', metadata: { source: 'action_lifecycle_reply' } })).toBe(false);
  });
});
