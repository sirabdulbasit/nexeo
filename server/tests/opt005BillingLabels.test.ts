/**
 * OPT-005 — billing labels on every Vertex call (owner ask, 2026-11-04: "add billing labels
 * to every Vertex call — tenant/customer and feature").
 *
 * Pinned:
 *  1. label values obey Vertex's rules (lowercase, [a-z0-9_-], ≤63, never empty);
 *  2. outside any call scope the labels are app=nexeo, tenant=none, feature=unlabeled;
 *     inside runWithLlmFeature they carry the call's purpose and tenant;
 *  3. attachBillingLabels patches generateContent AND generateContentStream of a Vertex
 *     client, merges labels into config without dropping the caller's config, lets a
 *     caller's own label win, is idempotent, and leaves a non-Vertex client untouched;
 *  4. the price table is what GCP bills (Flash 0.30/2.50, Pro 1.25/10.00).
 */
import { describe, it, expect } from 'vitest';
import { attachBillingLabels, currentBillingLabels, labelValue, runWithLlmFeature, withBillingLabels } from '../src/services/llmBillingLabels';
import { estimatedCostUsd } from '../src/services/llmSpendService';

describe('OPT-005 label values', () => {
  it('lowercase, [a-z0-9_-], at most 63 chars, never empty', () => {
    expect(labelValue('TMC-0001')).toBe('tmc-0001');
    expect(labelValue('criticality_fuse')).toBe('criticality_fuse');
    expect(labelValue('Chat Compose (web)')).toBe('chat-compose-web');
    expect(labelValue('x'.repeat(80))).toHaveLength(63);
    expect(labelValue('')).toBe('unlabeled');
    expect(labelValue(undefined, 'none')).toBe('none');
    expect(labelValue('---')).toBe('unlabeled');
  });
});

describe('OPT-005 the call scope', () => {
  it('defaults outside a scope; carries purpose and tenant inside one', async () => {
    expect(currentBillingLabels()).toEqual({ app: 'nexeo', tenant: 'none', feature: 'unlabeled' });
    const inside = await runWithLlmFeature('retrieval_plan', 'TMC-0001', async () => currentBillingLabels());
    expect(inside).toEqual({ app: 'nexeo', tenant: 'tmc-0001', feature: 'retrieval_plan' });
    expect(currentBillingLabels().feature).toBe('unlabeled');
  });
});

function fakeClient(vertexai: boolean) {
  const seen: any[] = [];
  const models: any = {
    async generateContent(params: any) { seen.push({ name: 'generateContent', params, self: this }); return { text: 'ok' }; },
    async generateContentStream(params: any) { seen.push({ name: 'generateContentStream', params, self: this }); return {}; },
  };
  return { client: { vertexai, models } as any, seen, models };
}

describe('OPT-005 the client patch', () => {
  it('labels both methods, keeps the caller config, lets the caller\'s label win, is idempotent', async () => {
    const { client, seen, models } = fakeClient(true);
    attachBillingLabels(client);
    attachBillingLabels(client);
    await runWithLlmFeature('triage', 'TMC-0001', async () => {
      await client.models.generateContent({ model: 'gemini-2.5-flash', contents: [], config: { maxOutputTokens: 10 } });
      await client.models.generateContentStream({ model: 'gemini-2.5-flash', contents: [], config: { labels: { feature: 'custom' } } });
    });
    expect(seen).toHaveLength(2); // idempotent: the second attach did not double-wrap
    expect(seen[0].params.config).toEqual({ maxOutputTokens: 10, labels: { app: 'nexeo', tenant: 'tmc-0001', feature: 'triage' } });
    expect(seen[1].params.config.labels).toEqual({ app: 'nexeo', tenant: 'tmc-0001', feature: 'custom' });
    expect(seen[0].self).toBe(models); // `this` preserved for the SDK's own method
    expect(seen[0].params.model).toBe('gemini-2.5-flash');
  });
  it('a non-Vertex client is left untouched (the Gemini API has no labels field)', async () => {
    const { client, seen } = fakeClient(false);
    attachBillingLabels(client);
    await client.models.generateContent({ model: 'm', contents: [] });
    expect(seen[0].params.config).toBeUndefined();
  });
  it('withBillingLabels tolerates a missing config', () => {
    expect(withBillingLabels({ model: 'm' } as any).config.labels.app).toBe('nexeo');
  });
});

describe('OPT-005 the price table is what GCP bills', () => {
  it('Flash 0.30 in / 2.50 out, Pro 1.25 in / 10.00 out per million', () => {
    expect(estimatedCostUsd({ provider: 'gemini-flash', inputTokens: 1_000_000, outputTokens: 1_000_000 } as any)).toBeCloseTo(2.80, 6);
    expect(estimatedCostUsd({ provider: 'gemini', inputTokens: 1_000_000, outputTokens: 100_000 } as any)).toBeCloseTo(2.25, 6);
  });
});
