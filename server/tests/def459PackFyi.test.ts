/**
 * DEF-459 (b), Suzi Master AGREE 13 Nov: the pack's fyi[]. Pinned: the agreed fields; no body (preview at most 200);
 * urgency critical | high | normal from the criticality band; point = why.
 */
import { describe, it, expect } from 'vitest';
import { toPackFyi, PACK_FYI_MAX } from '../src/services/suzi/dayPack';

describe('fyi[] in the pack', () => {
  it('carries the agreed fields, never a body', () => {
    const f = toPackFyi({
      feedEventId: 'fe1', threadId: 'th1', fromDisplay: 'Kashif Mustafa', from: 'kashif@x.com', subject: 'Re: Correction of Objectives - Delivery',
      preview: 'x'.repeat(500), receivedAt: '2026-11-13T04:29:35.000Z', criticality: { band: 'high' },
      forYourKnowledge: { kind: 'escalation', why: 'HR asked Nabeel to fix Fawad\'s objectives today' },
    }, 'Asia/Karachi');
    expect(Object.keys(f).sort()).toEqual(['email_id', 'from', 'kind', 'point', 'preview', 'received_at', 'subject', 'thread_id', 'urgency', 'why'].sort());
    expect(f).toMatchObject({ email_id: 'fe1', thread_id: 'th1', from: 'Kashif Mustafa', kind: 'escalation', urgency: 'high', why: "HR asked Nabeel to fix Fawad's objectives today", point: "HR asked Nabeel to fix Fawad's objectives today" });
    expect(f.preview.length).toBeLessThanOrEqual(200);
    expect(PACK_FYI_MAX).toBe(10);
  });
  it('urgency is normal unless the band says otherwise', () => {
    const base = { feedEventId: 'fe2', from: 'a@x.com', subject: 's', receivedAt: '2026-11-13T04:00:00Z', forYourKnowledge: { kind: 'risk', why: 'w' } };
    expect(toPackFyi({ ...base, criticality: { band: 'medium' } }, 'UTC').urgency).toBe('normal');
    expect(toPackFyi({ ...base, critical: true }, 'UTC').urgency).toBe('critical');
  });
});
