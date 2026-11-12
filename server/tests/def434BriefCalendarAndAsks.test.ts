/**
 * CL-075 (2026-11-12, WhatsApp morning brief). Pinned:
 *  DEF-434  an all-day event is "all day" in the brief, whatever shape its start has, never "05:00".
 *  DEF-435  the brief names what to do first (late, due within 3 days, high) with a due phrase, counts the rest
 *           exactly, and its asks follow the agreed Action Center definition.
 */
import { describe, it, expect } from 'vitest';
import { isAllDayStart } from '../src/services/views/calendar';
import { splitDoFirst, duePhrase, renderDayBriefBlock } from '../src/services/views/dayBrief';

const item = (title: string, priority: string, due: string | null): any => ({ id: title, title, priority, dueDate: due ? new Date(`${due}T12:00:00Z`) : null, delegateeName: null });

describe('DEF-434 all-day events', () => {
  it('recognises both stored shapes and nothing else', () => {
    expect(isAllDayStart('2026-11-12')).toBe(true);
    expect(isAllDayStart({ date: '2026-11-12' })).toBe(true);
    expect(isAllDayStart('2026-11-12T10:00:00+05:00')).toBe(false);
    expect(isAllDayStart({ dateTime: '2026-11-12T10:00:00+05:00', date: '2026-11-12' })).toBe(false);
  });
});

describe('DEF-435 do first, by name', () => {
  const today = '2026-11-12';
  it('late, due within 3 days or high come first, soonest first; the rest is counted', () => {
    const { first, rest } = splitDoFirst([
      item('medium, no date', 'medium', null),
      item('high, no date', 'high', null),
      item('medium, due in 2 days', 'medium', '2026-11-14'),
      item('medium, overdue', 'medium', '2026-10-16'),
      item('medium, due in 10 days', 'medium', '2026-11-22'),
    ], today);
    expect(first.map((i) => i.title)).toEqual(['medium, overdue', 'medium, due in 2 days', 'high, no date']);
    expect(rest.map((i) => i.title)).toEqual(['medium, no date', 'medium, due in 10 days']);
  });
  it('due phrases', () => {
    expect(duePhrase(new Date('2026-10-16T12:00:00Z'), today, 'Asia/Karachi')).toBe('overdue since Fri 16 Oct');
    expect(duePhrase(new Date('2026-11-12T12:00:00Z'), today, 'Asia/Karachi')).toBe('due today');
    expect(duePhrase(new Date('2026-11-14T12:00:00Z'), today, 'Asia/Karachi')).toBe('due Sat 14 Nov');
    expect(duePhrase(null, today, 'Asia/Karachi')).toBe('no date');
  });
  it('the block names do-first items and gives the exact count of the rest, never "and N more" for them', () => {
    const block = renderDayBriefBlock({
      generatedAt: new Date(), localDate: today, localTimezone: 'Asia/Karachi', calendar: [],
      openItems: [item('Send Haseeb comments on the TBA spec', 'high', '2026-10-23'), ...Array.from({ length: 12 }, (_, i) => item(`m${i}`, 'medium', null))],
      attention: [], asks: [], recentEmails: [], recentWhatsApp: [], followUps: null,
    } as any);
    expect(block).toContain('- Send Haseeb comments on the TBA spec · overdue since Fri 23 Oct');
    expect(block).toContain('## Other open items (12)');
    expect(block).toContain('- 12 more in the Action Center');
    expect(block).not.toContain('m0');
  });
});
