/**
 * DEF-479 (founder 16 Nov 2026, PMS demo): "it didnt dervie ... any actionable items" / "no suggestion for me as my
 * assistant". The derive step now also asks for his own follow-ups, grounded in what was said (next session, open
 * questions, material to send, a decision waiting), at most 3, owned by him. They stay proposals until his yes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ system: '', answer: '' }));
vi.mock('../src/services/geminiService', () => ({ callGemini: async (system: string) => { s.system = system; return s.answer; } }));

import { deriveMinutes } from '../src/services/meetings/meetingProcessor';

const lines = [
  { t: '2026-11-16T06:19:16Z', speaker: 'Ateeb', text: 'Installation on our own network, number of users?' },
  { t: '2026-11-16T06:56:35Z', speaker: 'Ateeb', text: 'Hanji discussion next session.' },
];

beforeEach(() => { s.system = ''; s.answer = ''; });

describe('DEF-479 meeting follow-ups for him', () => {
  it('asks for his follow-ups, owned by him, grounded, at most 3', async () => {
    s.answer = JSON.stringify({ title: 'PMS demo', minutes: 'Demo.', decisions: [], action_items: [] });
    await deriveMinutes('PMS System Demo', lines, 'Basit Ahmed');
    expect(s.system).toMatch(/follow-ups Basit Ahmed should take/);
    expect(s.system).toMatch(/owner_name "Basit Ahmed", at most 3/);
    expect(s.system).toMatch(/next session/);
    expect(s.system).toMatch(/Never invent a topic/);
  });
  it('his follow-ups come back as proposed action items', async () => {
    s.answer = JSON.stringify({ title: 'PMS demo', minutes: 'Demo.', decisions: [], action_items: [
      { title: 'Schedule the next PMS session with SFML', owner_name: 'Basit Ahmed' },
      { title: 'Answer SFML on local installation and user count', owner_name: 'Basit Ahmed' },
    ] });
    const d = await deriveMinutes('PMS System Demo', lines, 'Basit Ahmed');
    expect(d?.action_items.map((a) => a.owner_name)).toEqual(['Basit Ahmed', 'Basit Ahmed']);
  });
});
