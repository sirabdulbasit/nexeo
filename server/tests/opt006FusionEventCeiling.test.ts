/**
 * OPT-006 — a per-event ceiling on `criticality_fuse` calls.
 *
 * 28 Oct–4 Nov 2026: 17,112 fusion calls for ~250 emails (~$15 of a $43 bill) despite the
 * OPT-003 prompt cache, because the 90-second critical-bundle sweep re-scores any email
 * whose prompt drifted. Owner: score each email on arrival and once before the morning brief.
 *
 * Pinned:
 *  1. the TTL is 24 h for an event under three days old and 7 days after that; a missing or
 *     invalid receivedAt counts as recent (the shorter TTL, never the longer);
 *  2. the event key is tenant- and prompt-version-bound: another tenant or a bumped
 *     prompt version can never read a cached verdict;
 *  3. in fuseAndScore the event lookup comes BEFORE the prompt cache and the LLM, a real
 *     verdict (live or prompt-cache hit) is remembered for the event, and the
 *     deterministic fallback is not;
 *  4. the attention-list path passes the feed event id, so the ceiling applies there.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { FUSION_EVENT_TTL_MS, fusionEventKey, fusionEventTtlMs, fusionMaterialFingerprint } from '../src/services/triage/criticalityEngineService';

const now = Date.parse('2026-11-04T12:00:00Z');

describe('OPT-006 the TTL', () => {
  it('24 h while recent, 7 days once older than three days, recent when unknown', () => {
    expect(fusionEventTtlMs(new Date(now - 2 * 3600_000), now)).toBe(FUSION_EVENT_TTL_MS.recent);
    expect(fusionEventTtlMs(new Date(now - 2.9 * 86_400_000), now)).toBe(FUSION_EVENT_TTL_MS.recent);
    expect(fusionEventTtlMs(new Date(now - 3.1 * 86_400_000), now)).toBe(FUSION_EVENT_TTL_MS.old);
    expect(fusionEventTtlMs(new Date('not a date'), now)).toBe(FUSION_EVENT_TTL_MS.recent);
    expect(fusionEventTtlMs(null, now)).toBe(FUSION_EVENT_TTL_MS.recent);
    expect(FUSION_EVENT_TTL_MS.recent).toBe(24 * 3600_000);
    expect(FUSION_EVENT_TTL_MS.old).toBe(7 * 86_400_000);
  });
});

describe('OPT-006 the key', () => {
  it('differs per tenant and per event, and is a 64-hex sha256 like the prompt key', () => {
    const a = fusionEventKey('TMC-0001', 'ev1');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(fusionEventKey('OTHER-01', 'ev1')).not.toBe(a);
    expect(fusionEventKey('TMC-0001', 'ev2')).not.toBe(a);
    expect(fusionEventKey('TMC-0001', 'ev1')).toBe(a);
  });
});

describe('OPT-006 the order of operations in fuseAndScore', () => {
  const src = readFileSync(path.join(__dirname, '../src/services/triage/criticalityEngineService.ts'), 'utf8');
  const body = src.slice(src.indexOf('async function fuseAndScore('));
  it('event lookup → prompt cache → LLM; remembered on live and on prompt hit; never the fallback', () => {
    const at = (s: string) => { const i = body.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    const eventRead = at("await fusionHeldForEvent(eventKey, input.receivedAt, materialFp)");
    const promptRead = at("where: { cacheKey },");
    const llm = at("callLLM(FUSION_PROMPT, userMsg");
    const fallback = at("fallbackLogGate('fuseAndScore')");
    expect(eventRead).toBeLessThan(promptRead);
    expect(promptRead).toBeLessThan(llm);
    // a prompt-cache hit and a live verdict are both remembered for the event…
    expect(body.indexOf('rememberFusionForEvent(eventKey, input.clientNumber, hit, materialFp)')).toBeLessThan(llm);
    const liveRemember = body.indexOf('rememberFusionForEvent(eventKey, input.clientNumber, result, materialFp)');
    expect(liveRemember).toBeGreaterThan(llm);
    expect(liveRemember).toBeLessThan(fallback);
    // …and nothing after the fallback gate writes an event entry.
    expect(body.slice(fallback)).not.toContain('rememberFusionForEvent(');
    // the event key is bound to the prompt version, and the held verdict is TTL- and version-checked on read
    expect(src).toContain('${FUSION_EVENT_KEY_VERSION}|${FUSION_PROMPT_VERSION}|${clientNumber}|${feedEventId}');
    const held = src.slice(src.indexOf('async function fusionHeldForEvent('), src.indexOf('function buildUserPrompt('));
    expect(held).toContain('where: { cacheKey: eventKey }');
    expect(held).toContain('ev.promptVersion !== FUSION_PROMPT_VERSION');
    expect(held).toContain('fusionEventTtlMs(receivedAt)');
    expect(held).toContain('if (__fp && __fp !== materialFp) return null;');
  });
  it('the attention-list path passes the feed event id', () => {
    const sug = readFileSync(path.join(__dirname, '../src/services/triage/triageSuggester.ts'), 'utf8');
    const call = sug.slice(sug.indexOf('criticality = await scoreCriticality({'));
    expect(call.slice(0, 1200)).toContain('feedEventId: row.id,');
  });
});

describe('OPT-012 quality: a change that matters re-scores at once', () => {
  const base: any = {
    openItems: [{ id: 'i1', title: 'Contract', status: 'NEW', priority: 'high', age_days: 3, dueDate: null }],
    deadlines: [{ source: 'open_item', what: 'Contract', at: 'x', hoursUntil: 40 }],
    instructionMatches: [], delegationOwners: [], importanceStars: 0, crm: [],
    sentiment: { score: 0, urgency: 0, tone: 'neutral', rationale: 'r' },
    knowledge: [{ title: 't', pageType: 'topic', snippet: 'a' }],
    senderTempo: { medianReplyHours: 5, currentSilenceHours: 10, typicalWindowHours: 9 },
  };
  const fp = (over: any) => fusionMaterialFingerprint({ ...base, ...over });
  it('moves on what matters', () => {
    const a = fp({});
    expect(fp({ openItems: [{ ...base.openItems[0], status: 'IN_PROGRESS' }] })).not.toBe(a);
    expect(fp({ openItems: [...base.openItems, { id: 'i2', title: 'New', status: 'NEW', priority: 'low', age_days: 0, dueDate: null }] })).not.toBe(a);
    expect(fp({ importanceStars: 4 })).not.toBe(a);
    expect(fp({ instructionMatches: [{ id: 'r1', kind: 'k', title: 't', originalText: 'o' }] })).not.toBe(a);
    expect(fp({ deadlines: [{ ...base.deadlines[0], hoursUntil: 20 }] })).not.toBe(a); // came within a day
    expect(fp({ sentiment: { ...base.sentiment, tone: 'hostile' } })).not.toBe(a);
  });
  it('does not move on the clock, on snippets, or on other senders\' deadlines', () => {
    const a = fp({});
    expect(fp({ openItems: [{ ...base.openItems[0], age_days: 9 }] })).toBe(a);
    expect(fp({ deadlines: [{ ...base.deadlines[0], hoursUntil: 30 }] })).toBe(a);
    expect(fp({ knowledge: [{ title: 'other', pageType: 'topic', snippet: 'b' }] })).toBe(a);
    expect(fp({ senderTempo: { medianReplyHours: 5, currentSilenceHours: 99, typicalWindowHours: 9 } })).toBe(a);
    expect(fp({ deadlines: [...base.deadlines, { source: 'open_item', what: 'Someone else item', at: 'x', hoursUntil: 2 }] })).toBe(a);
  });
});
