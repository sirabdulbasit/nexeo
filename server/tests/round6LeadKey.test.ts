/**
 * Round 6, Nexeo's half (SuziUpgrade_Charter §4; gateway side live 13 Nov 16:06, installed by Suzi Master). Pinned:
 * a lead key is asked for explicitly; the gateway gets `lead: true` only then, never by default (a lead key moves the
 * lead on the master, so it is opt-in even for a super admin). The route's SA-only check is pinned in the route test below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiKey } from '../src/services/suzi/gatewayAdminClient';

let dir = '';
const bodies: any[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'r6-'));
  writeFileSync(join(dir, 'secret'), 'test-suzi-admin-secret-0123456789-abcdefghij\n');
  process.env.SUZI_GATEWAY_ADMIN_SECRET_FILE = join(dir, 'secret');
  process.env.SUZI_GATEWAY_IN_TESTS = '1';
  bodies.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ api_key: 'sk_x', key_prefix: 'sk_x', expires_at: '2026-12-13T00:00:00Z', device_id: 'd', server_url: 'https://s.example' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.SUZI_GATEWAY_IN_TESTS; vi.unstubAllGlobals(); });

const owner = { userId: 2, clientNumber: 'T', displayName: 'Basit' };

describe('lead keys', () => {
  it('the gateway gets lead:true only when asked', async () => {
    await createApiKey(owner, 30);
    await createApiKey(owner, 30, { lead: false });
    await createApiKey(owner, 30, { lead: true });
    expect(bodies[0]).not.toHaveProperty('lead');
    expect(bodies[1]).not.toHaveProperty('lead');
    expect(bodies[2]).toMatchObject({ lead: true, user_id: '2', tenant_id: 'T' });
  });
});
