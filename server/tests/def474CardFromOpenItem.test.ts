/**
 * DEF-474 (CL-091): an email card with an open task made from it shows the task's priority and line. The Green Belt
 * card said "Medium" / "forwarding a request for your approval" while its task said high, "be the sponsor", 14 Nov.
 * Also: cardTruth drops an invitation he has answered (DEF-475) from the list Suzi and the brief read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ rows: [] as any[], args: [] as any[], fail: false, events: [] as any[] }));
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: async (_q: string, ...a: any[]) => { s.args = a; if (s.fail) throw new Error('db'); return s.rows; } } }));
vi.mock('../src/services/calendarService', () => ({ getEvents: async () => ({ events: s.events }) }));

import { applyOpenItems, cardTruth } from '../src/services/triage/cardTruth';
import { _resetInviteCache } from '../src/services/triage/inviteResponses';

const SPONSOR = 'Phase 1 of the Green Belt registration is approved. L&OD needs a sponsor, head of department or above, confirmed by 14 Nov, and Yousaf asked you to be it.';
const card = (x: any = {}): any => ({ feedEventId: 'cmwbtdot0006prteqmwimhyau', threadId: '1a18cd438be92205', subject: 'Fwd: REGISTRATION REQUEST FOR GREEN BELT', criticality: { band: 'medium' }, critical: false, rationale: 'Muhammad Yousuf is forwarding a request for your approval on a Green Belt training registration.', ...x });
beforeEach(() => { s.rows = []; s.fail = false; s.events = []; _resetInviteCache(); });

describe('DEF-474 the card follows its task', () => {
  it('same thread: band high, line from the task, task attached', async () => {
    s.rows = [{ id: 'oi1', title: "Agree to sponsor Muhammad Yousaf's Green Belt project by 14 Nov", description: SPONSOR, priority: 'high', due_date: new Date('2026-11-14T12:00:00Z'), th: '1a18cd438be92205', fe: 'cmwbtdl8x004lrteq8norxirs', sr: '1a1c46d25dea791d' }];
    const c = card(); await applyOpenItems([c], 'TMC-0001', 2);
    expect(c.criticality.band).toBe('high');
    expect(c.rationale).toBe(SPONSOR);
    expect(c.openItem).toMatchObject({ id: 'oi1', priority: 'high', dueDate: '2026-11-14T12:00:00.000Z' });
    expect(s.args[2]).toEqual(['NEW', 'TRIAGED', 'DRAFT', 'DELEGATED']); // open tasks only
  });
  it('no task, or the read fails: the card is unchanged', async () => {
    const a = card(); await applyOpenItems([a], 'TMC-0001', 2);
    expect(a.criticality.band).toBe('medium'); expect(a.openItem).toBeUndefined();
    s.fail = true; const b = card(); await applyOpenItems([b], 'TMC-0001', 2);
    expect(b.criticality.band).toBe('medium');
  });
  it('a task of another thread is not attached', async () => {
    s.rows = [{ id: 'oi9', title: 'x', description: 'y', priority: 'critical', due_date: null, th: 'other', fe: 'other-fe', sr: 'other-sr' }];
    const c = card(); await applyOpenItems([c], 'TMC-0001', 2);
    expect(c.criticality.band).toBe('medium');
  });
  it('cardTruth: an accepted invitation leaves the list; the rest stay', async () => {
    s.events = [{ title: 'PMS System Demo - Vision Metrics', selfResponse: 'accepted' }];
    const invite = card({ feedEventId: 'f2', threadId: 't2', subject: 'Invitation: PMS System Demo - Vision Metrics @ Mon Nov 16, 2026 11am - 12pm (GMT+5) (Basit Ahmed)' });
    const out = await cardTruth([card(), invite], 'TMC-0001', 2);
    expect(out.map((i: any) => i.feedEventId)).toEqual(['cmwbtdot0006prteqmwimhyau']);
  });
});
