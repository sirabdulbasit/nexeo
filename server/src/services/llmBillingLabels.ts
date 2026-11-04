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
 * The labels are attached in ONE place — the GenAI client's generateContent /
 * generateContentStream — so the seventeen direct callers of the client are covered
 * without changing a line of them. `callLLM` sets the feature for everything it routes;
 * a direct caller that sets none shows up as 'unlabeled', which is itself the finding.
 *
 * Vertex rules for a label: lowercase letters, digits, '_' and '-', at most 63 characters.
 * The Gemini Developer API (API-key mode) has no labels field, so the client is left alone
 * there.
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { GoogleGenAI } from '@google/genai';
import { currentClientNumber } from '../db/tenantContext';

export const APP_LABEL = 'nexeo';
export const UNLABELED = 'unlabeled';
export const NO_TENANT = 'none';

interface LlmFeatureScope { feature: string; tenant?: string | null }
const scope = new AsyncLocalStorage<LlmFeatureScope>();

/** Run `fn` with this feature (and tenant) on every Vertex call it makes. */
export function runWithLlmFeature<T>(feature: string, tenant: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  return scope.run({ feature, tenant }, fn);
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

/**
 * Patch a Vertex client so every generateContent / generateContentStream carries the labels.
 * Idempotent; a non-Vertex client is returned untouched.
 */
export function attachBillingLabels(client: GoogleGenAI): GoogleGenAI {
  const c = client as any;
  const models = c?.models;
  if (!c?.vertexai || !models || models.__billingLabels) return client;
  for (const name of ['generateContent', 'generateContentStream'] as const) {
    const orig = models[name];
    if (typeof orig !== 'function') continue;
    models[name] = (params: any, ...rest: any[]) => orig.call(models, withBillingLabels(params), ...rest);
  }
  models.__billingLabels = true;
  return client;
}
