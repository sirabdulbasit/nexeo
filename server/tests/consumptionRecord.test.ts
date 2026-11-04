/**
 * Costing Charter — the consumption record, and recording every Gemini call at the client.
 *
 * Pinned:
 *  1. one price table, as billed: Pro, Flash, cached input, the long-context step;
 *  2. the client records every call from Google's own counts and model name, inside the caller's
 *     scope; a stream is recorded when it ends; a call with no usage records nothing; a failed record
 *     never touches the call;
 *  3. a desktop batch: counts only, safe to resend, unknown services ignored and named, up to 7 days
 *     late, never a future day;
 *  4. a server round is priced from the model; a resend cannot double-count;
 *  5. the report rejects a bad range; CSV escapes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const exec = vi.fn();
const query = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { $executeRawUnsafe: (...a: any[]) => exec(...a), $queryRawUnsafe: (...a: any[]) => query(...a) } }));
const spend = vi.fn();
vi.mock('../src/services/llmSpendService', () => ({ recordLlmSpend: (...a: any[]) => spend(...a) }));

import { DESKTOP_SERVICES, modelPrice, tokenCostUsd } from '../src/services/consumption/priceTable';
import { consumptionReport, recordDesktopBatch, recordServerRound, reportCsv } from '../src/services/consumption/consumptionService';
import { attachBillingLabels, runWithLlmFeature } from '../src/services/llmBillingLabels';

beforeEach(() => { exec.mockReset(); query.mockReset(); spend.mockReset(); exec.mockResolvedValue(1); spend.mockResolvedValue(undefined); });

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('the price table', () => {
  it('prices as billed', () => {
    expect(tokenCostUsd('gemini-2.5-pro', { input: 100_000, output: 100_000 })).toBeCloseTo(1.125);
    expect(tokenCostUsd('gemini-2.5-flash', { input: 100_000, output: 100_000 })).toBeCloseTo(0.28);
  });
  it('cached input is cheaper, thinking is output, and over 200k Pro steps up', () => {
    expect(tokenCostUsd('gemini-2.5-pro', { input: 100_000, cached: 100_000, output: 0 })).toBeCloseTo(0.0125);
    expect(tokenCostUsd('gemini-2.5-pro', { input: 0, output: 0, thinking: 1000 })).toBeCloseTo(0.01);
    expect(tokenCostUsd('gemini-2.5-pro', { input: 300_000, output: 1000 })).toBeCloseTo(0.75 + 0.015);
    expect(tokenCostUsd('gemini-2.5-flash', { input: 300_000, output: 0 })).toBeCloseTo(0.09); // no step on Flash
  });
  it('an unknown model is priced as Pro, the safe side; Flash-Lite is marked unconfirmed', () => {
    expect(modelPrice('some-new-model').in).toBe(1.25);
    expect(modelPrice('gemini-3.1-flash-lite').measured).toBe(false);
    expect(DESKTOP_SERVICES.voice_characters.usdPerUnit * 7000).toBeCloseTo(0.21);
    expect(DESKTOP_SERVICES.local_hearing_seconds.usdPerUnit).toBe(0);
  });
});

describe('every call is recorded at the client', () => {
  const usage = { promptTokenCount: 80_000, cachedContentTokenCount: 30_000, candidatesTokenCount: 200, thoughtsTokenCount: 100 };
  it('a direct call: Google\'s counts, the model, the caller\'s scope; labels on Vertex', async () => {
    let sent: any;
    const client: any = { vertexai: true, models: { generateContent: async (p: any) => { sent = p; return { text: 'ok', usageMetadata: usage }; } } };
    attachBillingLabels(client);
    await runWithLlmFeature('chat_reasoning', 'TMC-0001', () => client.models.generateContent({ model: 'gemini-2.5-pro', contents: [] }), { userId: 2, feedEventId: 'e1' });
    await settle();
    expect(sent.config.labels.feature).toBe('chat_reasoning');
    expect(spend).toHaveBeenCalledWith({
      provider: 'gemini', model: 'gemini-2.5-pro', clientNumber: 'TMC-0001', userId: 2, purpose: 'chat_reasoning', feedEventId: 'e1',
      inputTokens: 80_000, cachedTokens: 30_000, outputTokens: 300,
    });
  });
  it('a caller with no scope shows as unlabeled, which is itself the finding', async () => {
    const client: any = { vertexai: true, models: { generateContent: async () => ({ usageMetadata: usage }) } };
    attachBillingLabels(client);
    await client.models.generateContent({ model: 'gemini-2.5-flash', contents: [] });
    await settle();
    expect(spend.mock.calls[0][0]).toMatchObject({ provider: 'gemini-flash', purpose: 'unlabeled' });
  });
  it('a stream is recorded once, when it ends, from its last usage', async () => {
    const client: any = { vertexai: true, models: { generateContentStream: async () => (async function* () { yield { text: 'a' }; yield { text: 'b', usageMetadata: usage }; })() } };
    attachBillingLabels(client);
    const got: string[] = [];
    for await (const c of await client.models.generateContentStream({ model: 'gemini-2.5-pro', contents: [] })) got.push(c.text);
    expect(got).toEqual(['a', 'b']);
    await settle();
    expect(spend).toHaveBeenCalledTimes(1);
  });
  it('no usage, nothing recorded; a failed record never touches the call; an API-key client records too, with no labels', async () => {
    spend.mockRejectedValue(new Error('db down'));
    let sent: any;
    const client: any = { vertexai: false, models: { generateContent: async (p: any) => { sent = p; return { text: 'ok', usageMetadata: usage }; } } };
    attachBillingLabels(client);
    expect((await client.models.generateContent({ model: 'm', contents: [] })).text).toBe('ok');
    expect(sent.config).toBeUndefined();
    await settle();
    expect(spend).toHaveBeenCalledTimes(1);
    const none: any = { vertexai: true, models: { generateContent: async () => ({ text: 'x' }) } };
    attachBillingLabels(none);
    await none.models.generateContent({ model: 'm', contents: [] });
    await settle();
    expect(spend).toHaveBeenCalledTimes(1);
  });
});

describe('the desktop batch', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const opts = { timezone: 'Asia/Karachi', now };
  const batch = { day: '2026-11-04', os: 'macos', idempotency_key: 'b1', items: [{ service: 'voice_characters', units: 7000 }, { service: 'turns_spoken', units: 30 }] };
  it('stores priced rows keyed for resend, in the batch\'s own day', async () => {
    const r = await recordDesktopBatch('TMC-0001', 2, batch, opts);
    expect(r).toEqual({ status: 200, body: { ok: true, stored: 2, replayed: 0, ignored: [] } });
    const a = exec.mock.calls[0];
    expect(a.slice(1, 6)).toEqual(['TMC-0001', 2, 'voice_characters', 'characters', 7000]);
    expect(a[6]).toBeCloseTo(0.21);
    expect(a[8]).toBe('2026-11-04');
    expect(a[11]).toBe('batch:2:b1:voice_characters');
    expect(exec.mock.calls[1][6]).toBe(0);
    expect(a[0]).toContain('ON CONFLICT (client_number, source_key) DO NOTHING');
  });
  it('a resend stores nothing new; an unknown service is ignored and named', async () => {
    exec.mockResolvedValue(0);
    expect(await recordDesktopBatch('TMC-0001', 2, batch, opts)).toMatchObject({ body: { stored: 0, replayed: 2 } });
    exec.mockResolvedValue(1);
    expect(await recordDesktopBatch('TMC-0001', 2, { ...batch, items: [{ service: 'transcript', units: 1 }] }, opts)).toMatchObject({ body: { stored: 0, ignored: ['transcript'] } });
  });
  it('7 days late is fine, 8 is refused; a future day, bad day, empty items or no key are refused', async () => {
    expect((await recordDesktopBatch('T', 2, { ...batch, day: '2026-10-28' }, opts)).status).toBe(200);
    expect(await recordDesktopBatch('T', 2, { ...batch, day: '2026-10-27' }, opts)).toEqual({ status: 409, body: { ok: false, error: 'too_late' } });
    expect((await recordDesktopBatch('T', 2, { ...batch, day: '2026-11-07' }, opts)).status).toBe(400);
    expect((await recordDesktopBatch('T', 2, { ...batch, day: 'today' }, opts)).status).toBe(400);
    expect((await recordDesktopBatch('T', 2, { ...batch, items: [] }, opts)).status).toBe(400);
    expect((await recordDesktopBatch('T', 2, { ...batch, idempotency_key: ' ' }, opts)).status).toBe(400);
  });
});

describe('a server round', () => {
  it('is priced from the model, on the user\'s own day, with a key a resend cannot double-count', async () => {
    await recordServerRound('TMC-0001', 2, { turn_id: 't1', round: 3, model: 'gemini-2.5-pro', prompt: 4000, cached: 0, output: 200, thoughts: 100 }, { timezone: 'Asia/Karachi', now: new Date('2026-11-04T20:00:00Z') });
    const a = exec.mock.calls[0];
    expect(a[8]).toBeCloseTo((4000 * 1.25 + 300 * 10) / 1e6);
    expect(a[10]).toBe('2026-11-05'); // past midnight in Karachi
    expect(a[12]).toBe('round:t1:3');
  });
});

describe('the report', () => {
  it('rejects a bad range; totals the rows; scopes to the tenant and, when asked, the user', async () => {
    await expect(consumptionReport('T', { from: 'x', to: 'y', groupBy: 'day' })).rejects.toThrow();
    query.mockResolvedValue([{ key: 'nexeo / triage', calls: '2', input_tokens: '10', cached_tokens: '0', output_tokens: '5', est_usd: 1.5, all_measured: true }, { key: 'desktop / voice_characters', calls: '0', input_tokens: '0', cached_tokens: '0', output_tokens: '0', est_usd: 0.21, all_measured: true }]);
    const r = await consumptionReport('TMC-0001', { from: '2026-11-01', to: '2026-11-04', groupBy: 'service', userId: 2 });
    expect(r.total_usd).toBeCloseTo(1.71);
    expect(query.mock.calls[0].slice(1)).toEqual(['TMC-0001', '2026-11-01', '2026-11-04', 2]);
    expect(reportCsv(r.rows).split('\n')[1]).toBe('"nexeo / triage",2,10,0,5,1.5,true');
  });
});
