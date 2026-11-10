/**
 * DEF-412 (CL-069, CL-070; founder 10 Nov, "go with your recommendations"). Pinned:
 *  1. the follow-ups he complained about are folded into the morning brief: overdue reminders (even `high`),
 *     "Intervention needed" lifecycle asks, memory-proposal notices, draft asks. An emergency never is;
 *     anything not named still goes at once;
 *  2. email at once only for urgent items or the brief itself when WhatsApp fails;
 *  3. the email reads like an assistant wrote it: a title, formatting, and a quiet footer instead of a banner;
 *  4. a folded queue prompt is final ('skipped'), never retried;
 *  5. the brief's Follow-ups facts: when due, how late, who has it, last real change; decisions in plain words;
 *     the memory-proposal count; and "couldn't be read" is said, never shown as nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const items = vi.fn();
const query = vi.fn();
const count = vi.fn();
vi.mock('../src/db/prisma', () => ({
  default: {
    openItem: { findMany: (...a: any[]) => items(...a) },
    $queryRawUnsafe: (...a: any[]) => query(...a),
    governedBrainMemory: { count: (...a: any[]) => count(...a) },
  },
}));

import { foldsIntoBrief, emailsWhenWhatsAppFails, assistantEmailHtml } from '../src/services/notifications/brainOutboundService';
import { getFollowUps, plainReason } from '../src/services/views/followUps';
import { renderFollowUps } from '../src/services/views/dayBrief';

beforeEach(() => { for (const f of [items, query, count]) f.mockReset(); query.mockResolvedValue([]); count.mockResolvedValue(0); });

describe('what is folded into the brief', () => {
  it('his examples are folded, whatever their urgency short of emergency', () => {
    expect(foldsIntoBrief({ kind: 'brain_prompt', urgency: 'high', metadata: { source: 'preactive_due_nudge' } })).toBe(true);
    expect(foldsIntoBrief({ kind: 'brain_prompt', urgency: 'high', metadata: { source: 'action_lifecycle_governor' } })).toBe(true);
    expect(foldsIntoBrief({ kind: 'brain_prompt', urgency: 'normal', metadata: { source: 'learn_proposal_digest' } })).toBe(true);
    expect(foldsIntoBrief({ kind: 'open_item_draft_ask', urgency: 'normal' })).toBe(true);
  });
  it('an emergency, anything unnamed, and the urgent alerts still go at once', () => {
    expect(foldsIntoBrief({ kind: 'brain_prompt', urgency: 'emergency', metadata: { source: 'preactive_due_nudge' } })).toBe(false);
    expect(foldsIntoBrief({ kind: 'brain_prompt', urgency: 'normal', metadata: { source: 'preactive_meeting_prep' } })).toBe(false);
    expect(foldsIntoBrief({ kind: 'brain_prompt', urgency: 'normal', metadata: {} })).toBe(false);
    for (const kind of ['critical_bundle', 'day_brief', 'wa_counterpart_message', 'connector_stale', 'suppressed_pushes_digest', 'suzi_to_user']) {
      expect(foldsIntoBrief({ kind, urgency: 'normal' }), kind).toBe(false);
    }
  });
});

describe('email when WhatsApp fails', () => {
  it('only for something urgent, or the brief itself', () => {
    expect(emailsWhenWhatsAppFails({ kind: 'critical_bundle', urgency: 'high' })).toBe(true);
    expect(emailsWhenWhatsAppFails({ kind: 'connector_stale', urgency: 'emergency' })).toBe(true);
    expect(emailsWhenWhatsAppFails({ kind: 'day_brief', urgency: 'normal' })).toBe(true);
    expect(emailsWhenWhatsAppFails({ kind: 'brain_prompt', urgency: 'normal' })).toBe(false);
    expect(emailsWhenWhatsAppFails({ kind: 'connector_stale', urgency: 'low' })).toBe(false);
  });
  it('the email reads like an assistant: a title, real formatting, the reason as a quiet footer, no banner', () => {
    const html = assistantEmailHtml('Your brief for Tuesday', "*Today's calendar*\nNo meetings <today>.");
    expect(html).toContain('Your brief for Tuesday');
    expect(html).toContain('<strong>Today&#39;s calendar</strong>');
    expect(html).toContain('No meetings &lt;today&gt;.');
    expect(html).toContain("Sent by email because WhatsApp couldn't be reached");
    expect(html).not.toContain('Delivered via email fallback');
  });
  it('both email paths use the one layout', () => {
    const src = readFileSync(path.join(__dirname, '../src/services/notifications/brainOutboundService.ts'), 'utf8');
    expect(src.match(/assistantEmailHtml\(/g)!.length).toBeGreaterThanOrEqual(3); // definition + fallback + Suzi's held item
    expect(src).not.toContain('<em>Delivered via email fallback');
  });
});

describe('a folded queue prompt is final', () => {
  it("folded_into_brief maps to 'skipped', after the normal rollback, so it is never retried", () => {
    const src = readFileSync(path.join(__dirname, '../src/services/brainPrompts/brainPromptQueueService.ts'), 'utf8');
    const i = src.indexOf("r.suppressedBy === 'folded_into_brief'");
    expect(i).toBeGreaterThan(src.indexOf('lastSuppressedReason'));
    expect(src.slice(i, i + 200)).toContain("state: 'skipped'");
  });
});

describe('the brief\'s Follow-ups facts', () => {
  const now = new Date('2026-11-10T06:00:00Z'); // 11:00 PKT
  it('overdue with due date, days late, who has it and the last real change; decisions in plain words; proposals counted', async () => {
    items.mockResolvedValue([
      { id: 'a', title: 'Connect with HRBP', dueDate: new Date('2026-11-04T07:00:00Z'), delegateeName: 'Ali', createdAt: new Date('2026-11-01T05:00:00Z'), notes: [], delegationTrail: [], metadata: {} },
      { id: 'b', title: 'Review config errors', dueDate: new Date('2026-11-09T07:00:00Z'), delegateeName: null, createdAt: new Date('2026-11-02T05:00:00Z'), notes: [{ text: 'started', at: '2026-11-08T10:00:00Z', by: 'user:2' }], delegationTrail: [], metadata: {} },
      { id: 'c', title: 'Due tomorrow', dueDate: new Date('2026-11-11T07:00:00Z'), delegateeName: null, createdAt: new Date('2026-11-02T05:00:00Z'), notes: [], delegationTrail: [], metadata: {} },
      { id: 'd', title: 'Textile Business Process Discussion', dueDate: null, delegateeName: null, createdAt: new Date('2026-11-02T05:00:00Z'), notes: [], delegationTrail: [],
        metadata: { actionLifecycle: { needsUserIntervention: true, interventionReason: 'concerned party has not responded after three attempts' } } },
    ]);
    count.mockResolvedValue(40);
    const f = await getFollowUps({ clientNumber: 'T', userId: 2, timezone: 'Asia/Karachi', now });
    expect(f.overdue.map((o) => [o.title, o.daysOverdue, o.withWhom])).toEqual([['Connect with HRBP', 6, 'Ali'], ['Review config errors', 1, 'you']]);
    expect(f.overdue[0].due).toBe('Wed 4 Nov');
    expect(f.overdue[1].lastChange).toBe('Sun 8 Nov');
    expect(f.needsDecision).toEqual([{ id: 'd', title: 'Textile Business Process Discussion', reason: 'no answer after several follow-ups' }]);
    expect(f.memoryProposalsWaiting).toBe(40);
    expect(items.mock.calls[0][0].where).toMatchObject({ clientNumber: 'T', userId: 2 });

    const text = renderFollowUps(f).join('\n');
    expect(text).toContain('Connect with HRBP · due Wed 4 Nov (6 days overdue) · with Ali');
    expect(text).toContain('Textile Business Process Discussion · no answer after several follow-ups');
    expect(text).toContain('Memory proposals waiting for approval: 40');
    expect(text).not.toMatch(/concerned party|Commitments recorded|volume budget|draft ask/i);
  });
  it('unreadable follow-ups are said, never shown as nothing', () => {
    expect(renderFollowUps(null).join('\n')).toContain('could not be read');
  });
  it('plain words for the follow-up\'s reasons', () => {
    expect(plainReason('No owner is recorded for this item')).toBe('nobody owns it');
    expect(plainReason('')).toBeNull();
  });
});
