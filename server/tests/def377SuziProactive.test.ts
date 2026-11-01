// DEF-377 — Nexeo's proactive messages (reminders, critical emails, Task Master asks) are also said
// out loud by Suzi desktop when it is online (Suzi protocol CN-008, assistant_start). This file: the
// allowlist and the call to the gateway. def377SuziProactiveChokepoint.test.ts: the hook in
// brainContactsUser.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { suziReasonFor, tellSuzi } from '../src/services/suzi/gatewayAdminClient';

const SECRET = 'test-suzi-admin-secret-0123456789-abcdefghij';
let dir = '';
let calls: { url: string; init: any }[] = [];
let responder: () => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const owner = { userId: 2, clientNumber: 'TMC-0001' };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suzi377-'));
  writeFileSync(join(dir, 'secret'), `${SECRET}\n`);
  process.env.SUZI_GATEWAY_ADMIN_SECRET_FILE = join(dir, 'secret');
  process.env.SUZI_GATEWAY_ADMIN_URL = 'http://127.0.0.1:4012';
  process.env.SUZI_GATEWAY_IN_TESTS = '1'; // fetch is stubbed below
  calls = [];
  responder = () => json({ ok: true, online: 1, delivered: 1 });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url: String(url), init }); return responder(); }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SUZI_GATEWAY_ADMIN_SECRET_FILE;
  delete process.env.SUZI_GATEWAY_ADMIN_URL;
  delete process.env.SUZI_GATEWAY_IN_TESTS;
});

describe('DEF-377 suziReasonFor — an allowlist', () => {
  it('maps the three things the Suzi app asked for', () => {
    expect(suziReasonFor('brain_prompt', { source: 'preactive_due_nudge' })).toBe('reminder');
    expect(suziReasonFor('brain_prompt', { source: 'preactive_meeting_prep' })).toBe('reminder');
    expect(suziReasonFor('critical_bundle')).toBe('email');
    expect(suziReasonFor('brain_prompt_top', { source: 'preactive_due_nudge' })).toBe('reminder');
    for (const k of ['open_item_owner_chase', 'open_item_owner_chase_prompt', 'open_item_draft_ask']) {
      expect(suziReasonFor(k, {})).toBe('task');
    }
  });

  it('a brain_prompt from any other producer is silent: sender triage and reply capture quote people verbatim', () => {
    for (const source of ['sender_triage', 'expected_external_whatsapp_reply', 'delegatee_followup_worker', 'action_lifecycle_reply', undefined]) {
      expect(suziReasonFor('brain_prompt', source ? { source } : {})).toBeNull();
      expect(suziReasonFor('brain_prompt_top', source ? { source } : {})).toBeNull();
    }
  });

  it('keeps everything else off the voice channel, including a kind nobody has written yet', () => {
    for (const k of ['connector_stale', 'brain_health_alert', 'day_brief', 'brain_daily_digest', 'wa_counterpart_message',
      'test_ping', 'admin_test_brain', 'suppressed_pushes_digest', 'some_kind_written_next_month']) {
      expect(suziReasonFor(k, {})).toBeNull();
    }
  });
});

describe('DEF-377 tellSuzi', () => {
  it('posts reason, priority and Nexeo\'s own text for this person to the gateway', async () => {
    const r = await tellSuzi(owner, { kind: 'critical_bundle', body: '  Two critical emails from Ali about the audit.  ', urgency: 'high', metadata: {} });
    expect(r).toEqual({ delivered: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:4012/admin/proactive');
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(calls[0].init.body)).toEqual({
      user_id: '2', tenant_id: 'TMC-0001', reason: 'email', priority: 'urgent', text: 'Two critical emails from Ali about the audit.', ref: 'critical_bundle',
    });
  });

  it('normal and low urgency map through; the queue prompt id is the ref', async () => {
    await tellSuzi(owner, { kind: 'brain_prompt', body: 'Report due at 5.', urgency: 'normal', metadata: { source: 'preactive_due_nudge', promptId: '491' } });
    await tellSuzi(owner, { kind: 'open_item_draft_ask', body: 'Draft the leave policy?', urgency: 'low' });
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ reason: 'reminder', priority: 'normal', ref: 'prompt:491' });
    expect(JSON.parse(calls[1].init.body)).toMatchObject({ reason: 'task', priority: 'low' });
  });

  it('does not call the gateway for a kind outside the allowlist or an empty body', async () => {
    expect(await tellSuzi(owner, { kind: 'connector_stale', body: 'Gmail is stale' })).toEqual({ delivered: 0, reason: 'kind not spoken by Suzi' });
    expect(await tellSuzi(owner, { kind: 'critical_bundle', body: '   ' })).toEqual({ delivered: 0, reason: 'empty body' });
    expect(calls).toHaveLength(0);
  });

  it("refuses a third party's verbatim words even inside an allowed kind", async () => {
    expect(await tellSuzi(owner, { kind: 'brain_prompt', body: 'Ali replied: "send me the file"', provenance: 'quoted_third_party', metadata: { source: 'preactive_due_nudge' } }))
      .toEqual({ delivered: 0, reason: "a third party's words are not spoken by Suzi" });
    expect(calls).toHaveLength(0);
    await tellSuzi(owner, { kind: 'brain_prompt', body: 'Report due at 5.', provenance: 'brain_prose', metadata: { source: 'preactive_due_nudge' } });
    expect(calls).toHaveLength(1);
  });

  it('never throws: gateway down, gateway error and no secret all come back as delivered 0', async () => {
    responder = () => { throw new TypeError('fetch failed'); };
    expect(await tellSuzi(owner, { kind: 'critical_bundle', body: 'x' })).toEqual({ delivered: 0, reason: 'Suzi server could not be reached' });
    responder = () => json({ error: { code: 'bad_request' } }, 400);
    expect(await tellSuzi(owner, { kind: 'critical_bundle', body: 'x' })).toEqual({ delivered: 0, reason: 'Suzi server returned an error' });
    rmSync(join(dir, 'secret'));
    expect(await tellSuzi(owner, { kind: 'critical_bundle', body: 'x' })).toEqual({ delivered: 0, reason: 'Suzi is not set up on this server' });
  });
  it('a test run that did not opt in never reaches the live gateway (the fixtures are the owner)', async () => {
    delete process.env.SUZI_GATEWAY_IN_TESTS;
    expect(await tellSuzi(owner, { kind: 'critical_bundle', body: 'fixture text' })).toEqual({ delivered: 0, reason: 'Suzi is not set up on this server' });
    expect(calls).toHaveLength(0);
  });
});
