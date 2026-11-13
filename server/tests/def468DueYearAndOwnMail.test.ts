/**
 * DEF-468/469/470 (CL-090). Pinned: a due date more than 60 days before creation is dropped (no due date, so nothing
 * fires as overdue) and reported; a normal date is kept; the judge is told the sent date, today, To/Cc and his own
 * addresses (checked through the prompt the model receives).
 */
import { describe, it, expect, vi } from 'vitest';
import { screenDueDate, DUE_SUSPECT_DAYS } from '../src/services/openItems/openItemGate';

const prompts: Array<{ system: string; user: string }> = [];
vi.mock('../src/services/geminiService', () => ({ callGemini: async (system: string, user: string) => { prompts.push({ system, user }); return { text: '{"actionable":false,"reason":"x"}' }; } }));

describe('DEF-468 the due date screen', () => {
  const now = new Date('2026-11-13T07:39:00Z');
  it('a misread year is dropped and reported; a real date is kept', () => {
    expect(screenDueDate(new Date('2023-11-30T12:00:00Z'), now)).toEqual({ dueDate: null, suspect: '2023-11-30' });
    expect(screenDueDate(new Date('2026-11-30T12:00:00Z'), now).dueDate?.toISOString()).toBe('2026-11-30T12:00:00.000Z');
    expect(screenDueDate(new Date('2026-11-10T12:00:00Z'), now).suspect).toBeNull(); // a few days overdue is real
    expect(DUE_SUSPECT_DAYS).toBe(60);
  });
});

describe('DEF-468/470 the judge gets the anchor and the addressing', () => {
  it('sent date, today, To, Cc and his addresses are in the prompt; the rules say so', async () => {
    const { judgeEmailActionability } = await import('../src/jobs/emailItemDerivationJob');
    await judgeEmailActionability({ subject: 'Re: Correction of Objectives', from: 'Kashif <k@x.com>', snippet: '@Nabeel kindly resolve today',
      sentAt: 'Fri, 13 Nov 2026 09:27:11 +0500', to: 'Fawad <f@x.com>', cc: 'nabeel@x.com, Basit <basit@x.com>', ownAddresses: 'basit@x.com' } as any);
    const p = prompts.at(-1)!;
    expect(p.user).toContain('Sent: Fri, 13 Nov 2026 09:27:11 +0500');
    expect(p.user).toMatch(/Today: \d{4}-\d{2}-\d{2}/);
    expect(p.user).toContain('Cc: nabeel@x.com, Basit <basit@x.com>');
    expect(p.user).toContain("Owner's own addresses: basit@x.com");
    expect(p.system).toMatch(/resolve any date the email names against the email's SENT date/);
    expect(p.system).toMatch(/addressed to someone else .* NOT actionable for him/);
  });
});
