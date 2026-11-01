// DEF-374 — Suzi desktop runs on the AI backend configured in Admin → Client Config → AI Provider.
// Nexeo hands the Vertex service account to the Suzi gateway's loopback admin API; nothing else
// is shared, nothing is logged, and a Suzi failure never surfaces as a Nexeo failure.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let cfg: any;
vi.mock('../src/services/aiProviderConfig', () => ({
  clearAiProviderCache: vi.fn(),
  getAiProviderConfig: vi.fn(async () => cfg),
}));
import { shareAiCredentialsWithSuzi } from '../src/services/suzi/gatewayAdminClient';

const SECRET = 'test-suzi-admin-secret-0123456789-abcdefghij';
const SA = { type: 'service_account', project_id: 'nexeo-billed', private_key: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----\n', client_email: 'a@b.iam.gserviceaccount.com' };
let dir = '';
let calls: { url: string; init: any }[] = [];
let responder: () => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suzi374-'));
  writeFileSync(join(dir, 'secret'), `${SECRET}\n`);
  process.env.SUZI_GATEWAY_ADMIN_SECRET_FILE = join(dir, 'secret');
  process.env.SUZI_GATEWAY_ADMIN_URL = 'http://127.0.0.1:4012';
  process.env.SUZI_GATEWAY_IN_TESTS = '1'; // fetch is stubbed below
  cfg = { provider: 'vertex', model: 'gemini-2.5-pro', region: 'us-central1', serviceAccount: SA, ready: true };
  calls = [];
  responder = () => json({ ok: true, changed: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url: String(url), init }); return responder(); }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SUZI_GATEWAY_ADMIN_SECRET_FILE;
  delete process.env.SUZI_GATEWAY_ADMIN_URL;
  delete process.env.SUZI_GATEWAY_IN_TESTS;
});

describe('DEF-374 shareAiCredentialsWithSuzi', () => {
  it('sends the configured Vertex backend and its service account to the gateway admin API', async () => {
    expect(await shareAiCredentialsWithSuzi()).toEqual({ shared: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:4012/admin/llm-credentials');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(calls[0].init.body)).toEqual({ provider: 'vertex', model: 'gemini-2.5-pro', region: 'us-central1', service_account: SA });
  });

  it('shares nothing when the provider is not Vertex or no service account is stored', async () => {
    cfg = { ...cfg, provider: 'gemini' };
    expect(await shareAiCredentialsWithSuzi()).toMatchObject({ shared: false, reason: 'AI provider is gemini, not vertex' });
    cfg = { ...cfg, provider: 'vertex', serviceAccount: null };
    expect((await shareAiCredentialsWithSuzi()).shared).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('never throws: gateway down, gateway error and no secret all come back as shared:false', async () => {
    responder = () => { throw new TypeError('fetch failed'); };
    expect(await shareAiCredentialsWithSuzi()).toMatchObject({ shared: false, reason: 'Suzi server could not be reached' });
    responder = () => json({ error: { code: 'bad_request' } }, 400);
    expect((await shareAiCredentialsWithSuzi()).shared).toBe(false);
    process.env.SUZI_GATEWAY_ADMIN_SECRET_FILE = join(dir, 'missing');
    expect(await shareAiCredentialsWithSuzi()).toMatchObject({ shared: false, reason: 'Suzi is not set up on this server' });
  });
});
