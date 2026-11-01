/**
 * Suzi desktop — Nexeo's side of the per-user API key flow (DEF-370).
 *
 * Suzi is the voice assistant on a user's own computer. Its server half, the
 * gateway (/var/www/jarvis-gateway, PM2 `jarvis-gateway`), owns the devices.
 * Nexeo only asks it, on behalf of the signed-in person, to mint that person's
 * own API key (valid 7 / 30 / 90 days), list their computers, or disconnect one. The calls
 * go to the gateway's admin API on loopback; the browser never sees the
 * gateway or its secret.
 *
 * The admin secret is a FILE the gateway owns, read per call so rotating it
 * needs no Nexeo restart. A missing secret, an unreachable gateway or a
 * gateway error is a typed failure the route turns into a visible message —
 * never a fake success (AGENTS.md §2.6).
 */
import { promises as fs } from 'fs';
import { env } from '../../config/env';
import createLogger from '../../utils/logger';

const log = createLogger('suzi');

export class SuziNotConfiguredError extends Error {}
export class SuziGatewayError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Who the request is for. Always built from req.user on the server, never from the request body. */
export interface SuziOwner { userId: number; clientNumber: string; displayName: string }

export interface SuziDevice {
  id: string;
  name: string;
  os: string;
  connectedAt: string;
  lastSeenAt: string | null;
  online: boolean;
  /** API-key computers stop working at this time; null for computers paired another way. */
  expiresAt: string | null;
  keyPrefix: string | null;
}

async function readSecret(): Promise<string> {
  let secret = '';
  try {
    secret = (await fs.readFile(env.suziGatewayAdminSecretFile, 'utf8')).trim();
  } catch {
    /* treated as not configured below */
  }
  if (secret.length < 32) throw new SuziNotConfiguredError('Suzi desktop is not set up on this server');
  return secret;
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
  // DEF-377: the gateway on this box is the LIVE one, and the test fixtures are the owner (user 2,
  // TMC-0001). A test run must never reach it — a fixture would be spoken on his desktop. Only the
  // suites that stub fetch opt in.
  if (process.env.VITEST && process.env.SUZI_GATEWAY_IN_TESTS !== '1') {
    throw new SuziNotConfiguredError('the live Suzi gateway is never called from a test run');
  }
  const secret = await readSecret();
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${env.suziGatewayAdminUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // The secret must never follow a redirect to another host.
      redirect: 'manual',
      signal: AbortSignal.timeout(env.suziGatewayTimeoutMs),
    });
  } catch (err) {
    const timedOut = (err as { name?: string })?.name === 'TimeoutError';
    log.warn('suzi gateway unreachable', { path, timedOut, ms: Date.now() - started });
    throw new SuziGatewayError(timedOut ? 'Suzi server did not answer in time' : 'Suzi server could not be reached', 502);
  }
  const data: any = await res.json().catch(() => null);
  if (res.status === 404) throw new SuziGatewayError('No such connected computer', 404);
  if (res.status === 503) throw new SuziNotConfiguredError('Suzi desktop is not set up on this server');
  if (!res.ok) {
    // The gateway's own code only — never its URL, never the secret.
    log.warn('suzi gateway error', { path, status: res.status, code: data?.error?.code, ms: Date.now() - started });
    throw new SuziGatewayError('Suzi server returned an error', 502);
  }
  return data;
}

/** 'never' = the key works until it is disconnected (DEF-373, owner 10-31). */
export const SUZI_KEY_VALIDITY_DAYS = [7, 30, 90, 'never'] as const;
export type SuziKeyValidity = (typeof SUZI_KEY_VALIDITY_DAYS)[number];

export interface SuziApiKey {
  apiKey: string;
  keyPrefix: string;
  /** null = never expires. */
  expiresAt: string | null;
  validityDays: SuziKeyValidity;
  serverUrl: string;
  /** One line the Suzi app accepts pasted into its Connect field. */
  connectLink: string;
}

/**
 * A new API key for THIS person (each user gets their own; it is never shared or reused), valid for
 * `validityDays` ('never' = until disconnected). The gateway keeps only its hash, so this is the one moment it can be shown.
 */
export async function createApiKey(owner: SuziOwner, validityDays: SuziKeyValidity): Promise<SuziApiKey> {
  const data = await call('POST', '/admin/api-keys', {
    user_id: String(owner.userId),
    tenant_id: owner.clientNumber,
    user_name: owner.displayName,
    validity_days: validityDays,
    created_by: 'nexeo-web',
  });
  const expiryOk = validityDays === 'never' ? data?.expires_at === null : typeof data?.expires_at === 'string';
  if (typeof data?.api_key !== 'string' || !expiryOk || !/^https?:\/\/[^\s]+$/.test(String(data?.server_url ?? ''))) {
    throw new SuziGatewayError('Suzi server returned an unexpected answer', 502);
  }
  const serverUrl = String(data.server_url).replace(/\/+$/, '');
  log.info('suzi api key issued', { userId: owner.userId, clientNumber: owner.clientNumber, validityDays });
  return {
    apiKey: data.api_key,
    keyPrefix: String(data.key_prefix ?? data.api_key.slice(0, 12)),
    expiresAt: data.expires_at,
    validityDays,
    serverUrl,
    connectLink: `suzi://connect?server=${encodeURIComponent(serverUrl)}&key=${encodeURIComponent(data.api_key)}`,
  };
}

export async function listDevices(owner: SuziOwner): Promise<SuziDevice[]> {
  const q = new URLSearchParams({ user_id: String(owner.userId), tenant_id: owner.clientNumber });
  const data = await call('GET', `/admin/devices?${q}`);
  const rows: any[] = Array.isArray(data?.devices) ? data.devices : [];
  return rows.map((d) => ({
    id: String(d.id),
    name: String(d.name ?? ''),
    os: String(d.os ?? ''),
    connectedAt: String(d.connected_at ?? ''),
    lastSeenAt: d.last_seen_at ? String(d.last_seen_at) : null,
    online: !!d.online,
    expiresAt: d.expires_at ? String(d.expires_at) : null,
    keyPrefix: d.key_prefix ? String(d.key_prefix) : null,
  }));
}

/**
 * DEF-374: give Suzi the AI backend Nexeo is configured with (Admin → Client Config → AI Provider), so
 * the desktop assistant runs on the same billed Vertex project instead of needing its own key. The
 * service account goes to the gateway's loopback admin API, which stores it owner-only; it is never
 * logged here. Only Vertex with a stored service account can be shared — anything else is a no-op
 * with the reason. Never throws: Nexeo must not fail a Save, a Verify or a boot because Suzi is down.
 */
export async function shareAiCredentialsWithSuzi(): Promise<{ shared: boolean; reason?: string }> {
  try {
    const { getAiProviderConfig, clearAiProviderCache } = await import('../aiProviderConfig');
    clearAiProviderCache();
    const cfg = await getAiProviderConfig();
    if (cfg.provider !== 'vertex') return { shared: false, reason: `AI provider is ${cfg.provider}, not vertex` };
    if (!cfg.serviceAccount) return { shared: false, reason: 'no service account JSON is stored in Client Config' };
    const data = await call('POST', '/admin/llm-credentials', {
      provider: 'vertex', model: cfg.model, region: cfg.region, service_account: cfg.serviceAccount,
    });
    log.info('suzi ai credentials shared', { model: cfg.model, region: cfg.region, changed: !!data?.changed });
    return { shared: true };
  } catch (err) {
    const reason = err instanceof SuziNotConfiguredError ? 'Suzi is not set up on this server'
      : err instanceof SuziGatewayError ? err.message : 'unexpected error';
    log.warn('suzi ai credentials not shared', { reason });
    return { shared: false, reason };
  }
}

/**
 * DEF-377 — which of Nexeo's own proactive messages Suzi should also say out loud, and as what
 * (the Suzi protocol's assistant_start reasons). An allowlist: anything not named here — connector
 * alerts, health alerts, digests, test pings, a person's forwarded words — stays off the voice
 * channel, so a kind added tomorrow is silent until someone decides otherwise. Third-party words
 * inside an allowed kind are refused by provenance in tellSuzi.
 */
export function suziReasonFor(kind: string, metadata?: Record<string, unknown>): 'reminder' | 'email' | 'task' | null {
  const source = typeof metadata?.source === 'string' ? metadata.source : '';
  if (source.startsWith('preactive_')) return 'reminder'; // meeting prep, deadline due / overdue
  if (kind === 'critical_bundle') return 'email';
  if (['open_item_owner_chase', 'open_item_owner_chase_prompt', 'open_item_draft_ask'].includes(kind)) return 'task';
  // Any OTHER brain_prompt / brain_prompt_top is silent. That kind is a carrier for many producers,
  // and several quote a person verbatim with no provenance set (sender triage: a stranger's WhatsApp;
  // expected-reply capture: a contact's reply). Only the sources named above are Nexeo's own words.
  return null;
}

/**
 * DEF-377 — hand a proactive message Nexeo has just delivered to the person's live Suzi desktop,
 * which then says it unprompted (CN-008). Only after Nexeo's own gates (opt-in, quiet hours, dedup,
 * caps) passed. Nobody online = nothing happens; Nexeo's own delivery already stands. Never throws:
 * a Suzi failure must not touch the WhatsApp path.
 */
export async function tellSuzi(
  owner: { userId: number; clientNumber: string },
  msg: { kind: string; body: string; urgency?: string; provenance?: string; metadata?: Record<string, unknown> },
): Promise<{ delivered: number; reason?: string }> {
  const reason = suziReasonFor(msg.kind, msg.metadata);
  if (!reason) return { delivered: 0, reason: 'kind not spoken by Suzi' };
  // Another person's words, verbatim (e.g. an unattached counterpart reply riding a brain_prompt),
  // never become a voice turn: a tool-capable model would be reading a third party's text to him.
  if (msg.provenance === 'quoted_third_party') return { delivered: 0, reason: "a third party's words are not spoken by Suzi" };
  const text = msg.body.trim().slice(0, 4000);
  if (!text) return { delivered: 0, reason: 'empty body' };
  const priority = msg.urgency === 'high' || msg.urgency === 'emergency' ? 'urgent' : msg.urgency === 'low' ? 'low' : 'normal';
  try {
    const ref = typeof msg.metadata?.promptId === 'string' ? `prompt:${msg.metadata.promptId}` : msg.kind;
    const data = await call('POST', '/admin/proactive', {
      user_id: String(owner.userId), tenant_id: owner.clientNumber, reason, priority, text, ref: ref.slice(0, 200),
    });
    const delivered = Number(data?.delivered ?? 0);
    if (delivered > 0) log.info('suzi told', { userId: owner.userId, clientNumber: owner.clientNumber, kind: msg.kind, reason });
    return { delivered };
  } catch (err) {
    const why = err instanceof SuziNotConfiguredError ? 'Suzi is not set up on this server'
      : err instanceof SuziGatewayError ? err.message : 'unexpected error';
    log.warn('suzi not told', { kind: msg.kind, reason: why });
    return { delivered: 0, reason: why };
  }
}

/** Disconnects only a computer that belongs to this owner; the gateway enforces it too. */
export async function disconnectDevice(owner: SuziOwner, deviceId: string): Promise<void> {
  await call('POST', '/admin/revoke', { device_id: deviceId, user_id: String(owner.userId), tenant_id: owner.clientNumber });
  log.info('suzi device disconnected', { userId: owner.userId, clientNumber: owner.clientNumber, deviceId });
}
