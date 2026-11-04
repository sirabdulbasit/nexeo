/**
 * OPT-008, 009, 010 — cost cuts toward the owner's target of $0.90/day per user (2026-11-04).
 *
 * OPT-008 connectionWatchdog asked the model to write the same "WhatsApp is down" message once a
 *         minute (1,022 Pro calls on 2–3 Nov, ~$1/day during an outage) because the dedup sits
 *         after the call. The wording is held for the dedup window.
 * OPT-009 Mind State is written once a day, not on all 48 ticks; observations still run each tick.
 * OPT-010 one triage reasoning per email: 2.8 Pro calls per email before. Flash was tested and
 *         failed. The hold is deleted with the rest when the user acts (same dedup hash).
 *
 * Every model call in the unknown row now names its purpose.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const read = (p: string) => readFileSync(path.join(__dirname, '../src', p), 'utf8');

describe('OPT-008 the disconnect notice', () => {
  const src = read('services/whatsapp/connectionWatchdog.ts');
  it('the held wording is checked before the model is called, and the dedup and delivery stay', () => {
    const heldAt = src.indexOf('disconnectNoticeBody.get(noticeKey)');
    const callAt = src.indexOf("await import('../llmRouter')", heldAt);
    expect(heldAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(heldAt);
    expect(src).toContain('held && Date.now() - held.at < DISCONNECT_NOTICE_WINDOW_MS');
    expect(src).toContain('dedupWindowMs: DISCONNECT_NOTICE_WINDOW_MS');
    expect(src).toContain('await brainContactsUser({');
  });
  it('a failed model call is NOT held, so the next tick can still write it', () => {
    const body = src.slice(src.indexOf('disconnectNoticeBody.get(noticeKey)'), src.indexOf('brainContactsUser({'));
    const setAt = body.indexOf('disconnectNoticeBody.set(');
    expect(setAt).toBeGreaterThan(body.indexOf("throw new Error('empty completion')"));
    expect(setAt).toBeLessThan(body.indexOf('} catch {'));
  });
});

describe('every call in the unknown row names its purpose', () => {
  it.each([
    ['services/whatsapp/connectionWatchdog.ts', 'wa_disconnect_notice'],
    ['services/notifications/brainOutboundService.ts', 'held_digest'],
    ['services/whatsapp/senderTriage.ts', 'sender_decision'],
    ['services/brainPrompts/promptReplyRelevance.ts', 'prompt_reply_relevance'],
  ])('%s', (file, purpose) => {
    expect(read(file)).toContain(`purpose: '${purpose}'`);
  });
});

describe('OPT-009 Mind State once a day', () => {
  const src = read('services/knowledge/brainCognitiveEngine.ts');
  it('a page under a day old skips the model call, before anything is sent', () => {
    const body = src.slice(src.indexOf('async function updateMindState('));
    const skip = body.indexOf('MIND_STATE_MIN_INTERVAL_MS) return false');
    const call = body.indexOf('callLLM(');
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(call);
  });
});

const row = { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() };
vi.mock('../src/db/prisma', () => ({ default: { triageDecisionCache: row } }));
const callLLM = vi.fn();
vi.mock('../src/services/llmRouter', () => ({ callLLM: (...a: any[]) => callLLM(...a) }));

import { reasonAboutEvent, triageEventKey, triageMaterialFingerprint, TRIAGE_EVENT_TTL_MS, __triageCacheInternals } from '../src/services/triage/triageReasoner';

const decision = { archetype: 'reply_needed', rationale: 'r', suggestedAction: 'draft_reply', confidence: 0.9, actions: [], critical: false, noise: false, meetingIntent: false };
const ctx = (over: any = {}): any => ({
  userId: 2, clientNumber: 'TMC-0001', feedEventId: 'ev1', itemType: 'email', sourceType: 'gmail', from: 'A <a@x.com>', fromEmail: 'a@x.com',
  senderDomain: 'x.com', subject: `s-${Math.random()}`, preview: 'p',
  sender: { interactionCount: 1, firstContact: false, recentDecisionCounts: {}, dominantDelegationCount: 0, relatedOpenItems: [], threadContext: [] },
  org: { senderOnActiveAccount: false, senderOnActiveProject: false, faclDocTitles: [], faclRelevantDocs: [] },
  ...over,
});

describe('OPT-010 one reasoning per email', () => {
  beforeEach(() => {
    row.findUnique.mockReset(); row.upsert.mockReset(); row.update.mockReset(); callLLM.mockReset();
    row.findUnique.mockResolvedValue(null);
    row.upsert.mockResolvedValue({});
    row.update.mockResolvedValue({});
    callLLM.mockResolvedValue({ text: JSON.stringify(decision) });
  });

  it('a held email is answered without a model call, even when its prompt has drifted', async () => {
    row.findUnique.mockResolvedValueOnce({ decision, createdAt: new Date(), promptVersion: __triageCacheInternals.TRIAGE_PROMPT_VERSION });
    const out = await reasonAboutEvent('dh', ctx({ preview: 'drifted' }));
    expect(out).toEqual(decision);
    expect(callLLM).not.toHaveBeenCalled();
    expect(row.findUnique.mock.calls[0][0].where.cacheKey).toBe(triageEventKey(ctx()));
  });

  it('an expired hold is not served: the prompt cache answers, and the answer is held again with the dedup hash', async () => {
    const v = __triageCacheInternals.TRIAGE_PROMPT_VERSION;
    row.findUnique
      .mockResolvedValueOnce({ decision: { ...decision, rationale: 'stale' }, createdAt: new Date(Date.now() - TRIAGE_EVENT_TTL_MS - 1000), promptVersion: v })
      .mockResolvedValueOnce({ decision, createdAt: new Date(), promptVersion: v });
    const out = await reasonAboutEvent('dh', ctx());
    expect(out.rationale).toBe('r');
    await new Promise((r) => setTimeout(r, 5));
    // The hold carries the dedup hash, so the user's own action deletes it (invalidateReasonerCache).
    const held = row.upsert.mock.calls.find((c) => c[0].where.cacheKey === triageEventKey(ctx()))![0];
    expect(held.create.dedupHash).toBe('dh');
  });

  it('a hold from an older prompt version is not served', async () => {
    row.findUnique.mockResolvedValueOnce({ decision: { ...decision, rationale: 'old prompt' }, createdAt: new Date(), promptVersion: 'v0' })
      .mockResolvedValueOnce({ decision, createdAt: new Date(), promptVersion: __triageCacheInternals.TRIAGE_PROMPT_VERSION });
    expect((await reasonAboutEvent('dh', ctx())).rationale).toBe('r');
  });

  it('OPT-012: when what matters changes, the hold is not served; the verdict never carries its fingerprint', async () => {
    const v = __triageCacheInternals.TRIAGE_PROMPT_VERSION;
    row.findUnique
      .mockResolvedValueOnce({ decision: { ...decision, rationale: 'before the change', __fp: 'an-older-fingerprint' }, createdAt: new Date(), promptVersion: v })
      .mockResolvedValueOnce({ decision, createdAt: new Date(), promptVersion: v });
    const out = await reasonAboutEvent('dh', ctx());
    expect(out.rationale).toBe('r');
    await new Promise((r) => setTimeout(r, 5));
    const held = row.upsert.mock.calls.find((c) => c[0].where.cacheKey === triageEventKey(ctx()))![0];
    expect(held.create.decision.__fp).toBe(triageMaterialFingerprint(ctx()));
    // An unchanged fingerprint is served, without the internal field.
    row.findUnique.mockReset();
    row.findUnique.mockResolvedValueOnce({ decision: { ...decision, __fp: triageMaterialFingerprint(ctx()) }, createdAt: new Date(), promptVersion: v });
    expect(await reasonAboutEvent('dh', ctx())).toEqual(decision);
  });

  it('OPT-012: a hold from before fingerprints is kept and stamped, with no model call', async () => {
    row.findUnique.mockResolvedValueOnce({ decision, createdAt: new Date(), promptVersion: __triageCacheInternals.TRIAGE_PROMPT_VERSION });
    expect(await reasonAboutEvent('dh', ctx())).toEqual(decision);
    expect(callLLM).not.toHaveBeenCalled();
    expect(row.update.mock.calls[0][0].data.decision.__fp).toBe(triageMaterialFingerprint(ctx()));
  });

  it('OPT-012: the fingerprint moves on a new related item or thread message, not on the subject line', () => {
    const a = triageMaterialFingerprint(ctx());
    expect(triageMaterialFingerprint(ctx({ sender: { ...ctx().sender, relatedOpenItems: [{ title: 'x', status: 'NEW' }] } }))).not.toBe(a);
    expect(triageMaterialFingerprint(ctx({ sender: { ...ctx().sender, threadContext: [{ from: 'them', text: 'hi' }] } }))).not.toBe(a);
    expect(triageMaterialFingerprint(ctx())).toBe(a);
  });

  it('a live answer is held too', () => {
    const src = read('services/triage/triageReasoner.ts');
    const live = src.slice(src.indexOf('const decision = await llmReason(ctx, userPrompt)'), src.indexOf('return decision;', src.indexOf('const decision = await llmReason(ctx, userPrompt)')));
    expect(live).toContain('if (eventKey) void writeCache(eventKey, dedupHash, ctx, { ...decision, __fp: materialFp } as ReasonerDecision)');
  });

  it('the key is per tenant, per user and per event; an event-less call has no hold', () => {
    const a = triageEventKey(ctx());
    expect(triageEventKey(ctx({ userId: 3 }))).not.toBe(a);
    expect(triageEventKey(ctx({ clientNumber: 'OTHER' }))).not.toBe(a);
    expect(triageEventKey(ctx({ feedEventId: 'ev2' }))).not.toBe(a);
    expect(triageEventKey(ctx({ feedEventId: null }))).toBeNull();
  });
});
