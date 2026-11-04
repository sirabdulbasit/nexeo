/**
 * OPT-005 — billing labels on every Vertex AI call, and the feature context they come from.
 *
 * Owner, 2026-11-04 (GCP bill 28 Oct–4 Nov: $43.30, one user): "add billing labels to every
 * Vertex call — tenant/customer and feature. Google breaks costs down by label, so we can
 * then see cost per customer directly."
 *
 * Three labels ride on each request's `config.labels`:
 *   app      always 'nexeo' (Suzi's server labels its own calls, so the two can be told apart)
 *   tenant   the customer: `opts.clientNumber` of the call, else the request's tenant scope
 *   feature  the call's purpose ('triage', 'criticality_fuse', …), else 'unlabeled'
 *
 * Costing Charter, 2026-11-04: the same place also RECORDS every call in `llm_spend`, from Google's
 * own usage counts (prompt, cached, output, thinking) and with the real model name. So Brain's reply
 * path and the seventeen direct callers, which recorded nothing, are now on the record, and the ledger
 * no longer estimates tokens at 4 characters each.
 *
 * The labels are attached in ONE place — the GenAI client's generateContent /
 * generateContentStream — so the seventeen direct callers of the client are covered
 * without changing a line of them. `callLLM` sets the feature for everything it routes;
 * a direct caller that sets none shows up as 'unlabeled', which is itself the finding.
 *
 * Vertex rules for a label: lowercase letters, digits, '_' and '-', at most 63 characters.
 * The Gemini Developer API (API-key mode) has no labels field, so calls there are recorded but
 * not labelled.
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { GoogleGenAI } from '@google/genai';
import { currentClientNumber, currentTenant } from '../db/tenantContext';

export const APP_LABEL = 'nexeo';
export const UNLABELED = 'unlabeled';
export const NO_TENANT = 'none';

interface LlmFeatureScope { feature: string; tenant?: string | null; userId?: number | null; feedEventId?: string | null }
const scope = new AsyncLocalStorage<LlmFeatureScope>();

/** Run `fn` with this feature (and tenant) on every Vertex call it makes. */
export function runWithLlmFeature<T>(feature: string, tenant: string | null | undefined, fn: () => Promise<T>, extra: { userId?: number | null; feedEventId?: string | null } = {}): Promise<T> {
  return scope.run({ feature, tenant, ...extra }, fn);
}

/** A Vertex label value: lowercase letters, digits, '_' and '-', at most 63 chars, never empty. */
export function labelValue(raw: unknown, fallback = UNLABELED): string {
  const s = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return s || fallback;
}

export function currentBillingLabels(): Record<string, string> {
  const s = scope.getStore();
  return {
    app: APP_LABEL,
    tenant: labelValue(s?.tenant ?? currentClientNumber(), NO_TENANT),
    feature: labelValue(s?.feature),
  };
}

/** The request with the current labels merged in. A caller's own labels win. */
export function withBillingLabels<T extends { config?: any }>(params: T): T {
  if (!params || typeof params !== 'object') return params;
  const config = params.config ?? {};
  return { ...params, config: { ...config, labels: { ...currentBillingLabels(), ...(config.labels ?? {}) } } };
}

/** Writes one call to the ledger from Google's counts. Never throws into the call it measures. */
function recordUsage(model: unknown, usage: any, s: LlmFeatureScope | undefined): void {
  if (!usage) return;
  const name = String(model ?? '');
  // Imported here, not at the top: the GenAI client must not pull in the database (and .env) at load.
  void import('./llmSpendService').then(({ recordLlmSpend }) => recordLlmSpend({
    provider: /flash/i.test(name) ? 'gemini-flash' : 'gemini',
    model: name.slice(0, 80) || undefined,
    clientNumber: s?.tenant ?? currentClientNumber() ?? undefined,
    userId: s?.userId ?? currentTenant()?.userId ?? undefined,
    purpose: s?.feature ?? UNLABELED,
    feedEventId: s?.feedEventId ?? null,
    inputTokens: Number(usage.promptTokenCount) || 0,
    cachedTokens: Number(usage.cachedContentTokenCount) || 0,
    outputTokens: (Number(usage.candidatesTokenCount) || 0) + (Number(usage.thoughtsTokenCount) || 0),
  })).catch(() => {});
}

/**
 * Patch a client so every generateContent / generateContentStream is recorded and, on Vertex, carries
 * the labels (the Gemini Developer API has no labels field). Idempotent.
 */
export function attachBillingLabels(client: GoogleGenAI): GoogleGenAI {
  const c = client as any;
  const models = c?.models;
  if (!models || models.__billingLabels) return client;
  const label = (params: any) => (c.vertexai ? withBillingLabels(params) : params);
  if (typeof models.generateContent === 'function') {
    const orig = models.generateContent;
    models.generateContent = async (params: any, ...rest: any[]) => {
      const s = scope.getStore();
      const r = await orig.call(models, label(params), ...rest);
      recordUsage(params?.model, r?.usageMetadata, s);
      return r;
    };
  }
  if (typeof models.generateContentStream === 'function') {
    const orig = models.generateContentStream;
    models.generateContentStream = async (params: any, ...rest: any[]) => {
      const s = scope.getStore();
      const stream = await orig.call(models, label(params), ...rest);
      return (async function* () {
        let usage: unknown;
        for await (const chunk of stream) {
          if (chunk?.usageMetadata) usage = chunk.usageMetadata;
          yield chunk;
        }
        recordUsage(params?.model, usage, s);
      })();
    };
  }
  models.__billingLabels = true;
  return client;
}
