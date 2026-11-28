/**
 * Link T57 (founder 28 Nov 2026, both AGREE 20:28/20:29 PKT): speech-to-text with one Google account at Nexeo. Pinned:
 *  (a) the pass is a self-signed JWT for https://speech.googleapis.com/ only, 15 minutes, verifiable with the account's key;
 *  (b) it is signed only by the speech-only account; Nexeo's main account is never handed out;
 *  (c) nothing without a signed device request;
 *  usage is counted per user and device; at the founder's cap there is no pass; unset cap or account = not_set_up;
 *  the relay takes LINEAR16 16 kHz mono up to 15 s and passes his languages and hints to Google;
 *  audio and the pass never enter suzi_act_log.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const exec = vi.fn();
const actLogCreate = vi.fn();
vi.mock('../src/db/prisma', () => ({
  default: {
    $queryRawUnsafe: (...a: any[]) => query(...a),
    $executeRawUnsafe: (...a: any[]) => exec(...a),
    suziActLog: { create: (...a: any[]) => actLogCreate(...a), findUnique: vi.fn(), update: vi.fn() },
  },
}));
const auditFn = vi.fn();
vi.mock('../src/services/auditLogService', () => ({ audit: (...a: any[]) => auditFn(...a) }));

import { DEFAULT_SPEECH_KEY_FILE, GEMINI_HEAR_MODELS, HEAR_INSTRUCTION, HEAR_SERVICE, MAX_AUDIO_BYTES, peakOf, SPEECH_AUDIENCE, STT_SERVICE, TOKEN_TTL_S, hintsOf, languagesOf, runSpeechOp, speechAccount } from '../src/services/suzi/suziSpeech';
import { act } from '../src/services/suzi/suziAct';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't57-'));
const keyFile = path.join(dir, 'speech.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'nexeo-speech@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), private_key_id: 'k1' }));
fs.chmodSync(keyFile, 0o600);
const env = { SPEECH_SA_KEY_FILE: keyFile, SPEECH_MONTHLY_CAP_MINUTES: '300' } as any;
const signed = { signatureVerified: true, deviceId: 'dev-1', idempotencyKey: 'k-1', timezone: 'Asia/Karachi', now: new Date('2026-11-28T15:00:00Z') };
const pcm = (seconds: number) => Buffer.alloc(Math.round(seconds * 32_000)).toString('base64');
/** A clip with sound in it (a 1 kHz tone at peak 3000), so it is not silence. */
const voiced = (seconds: number) => { const b = Buffer.alloc(Math.round(seconds * 32_000)); for (let i = 0; i + 1 < b.length; i += 2) b.writeInt16LE(Math.round(3000 * Math.sin((i / 2) * 2 * Math.PI / 16)), i); return b.toString('base64'); };

beforeEach(() => {
  query.mockReset(); exec.mockReset(); actLogCreate.mockReset(); auditFn.mockReset();
  query.mockResolvedValue([{ s: 600 }]); // 10 minutes used this month
  exec.mockResolvedValue(1);
});

describe('the pass (a), (b), (c)', () => {
  it('is a self-signed JWT for Speech-to-Text only, 15 minutes, verifiable with the speech account', async () => {
    const r: any = await runSpeechOp('T', 2, 'speech.token', {}, signed, { env });
    expect(r.ok).toBe(true);
    const [h, p, s] = r.item.access_token.split('.');
    expect(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))).toBe(true);
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload.aud).toBe(SPEECH_AUDIENCE);
    expect(payload.iss).toBe('nexeo-speech@p.iam.gserviceaccount.com');
    expect(payload.exp - payload.iat).toBe(TOKEN_TTL_S);
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'k1' });
    expect(r.item.quota_left_s).toBe(300 * 60 - 600);
    expect(r.item.expires_at).toBe('2026-11-28T15:15:00.000Z');
  });
  it('a device request that is not signed gets nothing', async () => {
    expect(await runSpeechOp('T', 2, 'speech.token', {}, { ...signed, signatureVerified: false }, { env })).toMatchObject({ ok: false, error: 'unsigned' });
    expect(await runSpeechOp('T', 2, 'speech.used', { seconds: 3 }, { ...signed, signatureVerified: false }, { env })).toMatchObject({ ok: false, error: 'unsigned' });
    expect(exec).not.toHaveBeenCalled();
  });
  it('Nexeo\'s main account is never used: same file as GOOGLE_APPLICATION_CREDENTIALS = not set up', async () => {
    expect(speechAccount({ SPEECH_SA_KEY_FILE: keyFile, GOOGLE_APPLICATION_CREDENTIALS: keyFile } as any)).toBeNull();
    expect(await runSpeechOp('T', 2, 'speech.token', {}, signed, { env: { SPEECH_MONTHLY_CAP_MINUTES: '300', SPEECH_SA_KEY_FILE: keyFile, GOOGLE_APPLICATION_CREDENTIALS: keyFile } as any }))
      .toMatchObject({ ok: false, error: 'not_set_up' });
  });
  it('a key file that group or others can read is refused', () => {
    const open = path.join(dir, 'open.json');
    fs.copyFileSync(keyFile, open); fs.chmodSync(open, 0o644);
    expect(speechAccount({ SPEECH_SA_KEY_FILE: open } as any)).toBeNull();
    expect(speechAccount({ SPEECH_SA_KEY_FILE: keyFile } as any)).not.toBeNull();
  });
  it('the founder\'s cap is 150 minutes by default; 0 or a bad value = not set up', async () => {
    const r: any = await runSpeechOp('T', 2, 'speech.token', {}, signed, { env: { SPEECH_SA_KEY_FILE: keyFile } as any });
    expect(r.item.quota_left_s).toBe(150 * 60 - 600);
    expect(r.item.quota_full_s).toBe(150 * 60);
    expect(await runSpeechOp('T', 2, 'speech.token', {}, signed, { env: { SPEECH_SA_KEY_FILE: keyFile, SPEECH_MONTHLY_CAP_MINUTES: '0' } as any })).toMatchObject({ ok: false, error: 'not_set_up' });
  });
  it('with no setting the key is read from its fixed place; a missing file = not set up', () => {
    expect(DEFAULT_SPEECH_KEY_FILE).toBe('/root/secrets/suzi-speech-nexeo-tmc.json');
    expect(speechAccount({ SPEECH_SA_KEY_FILE: path.join(dir, 'missing.json') } as any)).toBeNull();
  });
  it('at the cap there is no pass', async () => {
    query.mockResolvedValue([{ s: 300 * 60 }]);
    expect(await runSpeechOp('T', 2, 'speech.token', {}, signed, { env })).toMatchObject({ ok: false, error: 'cap' });
  });
});

describe('usage', () => {
  it('speech.used counts seconds per user and device this month, safe to resend', async () => {
    const r: any = await runSpeechOp('T', 2, 'speech.used', { seconds: 3.2, requests: 1 }, signed, { env });
    expect(r).toEqual({ ok: true, item: { month_seconds: 600, quota_left_s: 300 * 60 - 600, quota_full_s: 300 * 60 } });
    const args = exec.mock.calls[0];
    expect(args[0]).toContain('ON CONFLICT (client_number, source_key) DO NOTHING');
    expect(args.slice(1)).toEqual(['T', 2, STT_SERVICE, 3.2, expect.any(Number), '2026-11-28', 'dev-1', 'stt:2:k-1']);
    expect(query.mock.calls[0].slice(1)).toEqual(['T', 2, STT_SERVICE, '2026-11-28', HEAR_SERVICE]);
  });
  it('bad seconds are refused and nothing is counted', async () => {
    expect(await runSpeechOp('T', 2, 'speech.used', { seconds: -1 }, signed, { env })).toMatchObject({ ok: false, error: 'bad_seconds' });
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('the relay speech.hear', () => {
  it('passes LINEAR16 16 kHz with his languages and hints, counts the seconds, returns text', async () => {
    const recognize = vi.fn().mockResolvedValue({ results: [{ alternatives: [{ transcript: 'OK thank you' }], languageCode: 'en-in' }] });
    const r: any = await runSpeechOp('T', 2, 'speech.hear', { audio: pcm(2), languages: ['ur-PK', 'en-IN'], hint: 'Basit, Suzi' }, signed, { env, recognize });
    expect(r.ok).toBe(true);
    expect(r.item).toMatchObject({ text: 'OK thank you', language: 'en-in' });
    const cfg = recognize.mock.calls[0][0].config;
    expect(cfg).toMatchObject({ encoding: 'LINEAR16', sampleRateHertz: 16000, model: 'command_and_search', languageCode: 'ur-PK', alternativeLanguageCodes: ['en-IN'], speechContexts: [{ phrases: ['Basit', 'Suzi'] }] });
    expect(recognize.mock.calls[0][1].client_email).toBe('nexeo-speech@p.iam.gserviceaccount.com');
    expect(exec.mock.calls[0][4]).toBe(2); // two seconds counted
  });
  it('over 15 s (500 KB) or empty audio is refused before Google is called', async () => {
    const recognize = vi.fn();
    expect(await runSpeechOp('T', 2, 'speech.hear', { audio: Buffer.alloc(MAX_AUDIO_BYTES + 2).toString('base64') }, signed, { env, recognize })).toMatchObject({ ok: false, error: 'bad_audio' });
    expect(await runSpeechOp('T', 2, 'speech.hear', { audio: '' }, signed, { env, recognize })).toMatchObject({ ok: false, error: 'bad_audio' });
    expect(recognize).not.toHaveBeenCalled();
  });
  it('nothing heard = no_speech; a Google failure = failed', async () => {
    expect(await runSpeechOp('T', 2, 'speech.hear', { audio: pcm(1) }, signed, { env, recognize: vi.fn().mockResolvedValue({ results: [] }) })).toMatchObject({ ok: false, error: 'no_speech' });
    expect(await runSpeechOp('T', 2, 'speech.hear', { audio: pcm(1) }, signed, { env, recognize: vi.fn().mockRejectedValue(new Error('down')) })).toMatchObject({ ok: false, error: 'failed' });
  });
  it('languages default to his three, English (India) first (ur-PK first writes his English in Urdu script), at most four; hints at most 50', () => {
    expect(languagesOf(undefined)).toEqual(['en-IN', 'ur-PK', 'en-US']);
    expect(languagesOf(['ur-PK', 'bad code', 'en-US', 'en-IN', 'en-GB', 'fr-FR'])).toEqual(['ur-PK', 'en-US', 'en-IN', 'en-GB']);
    expect(hintsOf(Array.from({ length: 60 }, (_, i) => `n${i}`))).toHaveLength(50);
  });
});

describe('through act()', () => {
  it('speech ops never enter suzi_act_log (no audio, no pass stored); the audit line holds counts only', async () => {
    const r = await act('T', 2, { op: 'speech.used', args: { seconds: 3 }, idempotency_key: 'k-9', signature_verified: true, device_id: 'dev-1', timezone: 'Asia/Karachi' });
    expect(r.status).toBe(200);
    expect(actLogCreate).not.toHaveBeenCalled();
    const a = auditFn.mock.calls[0][0];
    expect(a.action).toBe('suzi.act.speech.used');
    expect(JSON.stringify(a.details)).not.toMatch(/audio|access_token/);
  });
  it('an unsigned speech op is answered 403', async () => {
    const r = await act('T', 2, { op: 'speech.token', args: {}, idempotency_key: 'k-10' });
    expect(r).toMatchObject({ status: 403, body: { ok: false, error: 'unsigned' } });
  });
});

describe('T59: the relay hears through Gemini first (engine "gemini")', () => {
  it('the first model writes his words; his instruction, the hint line and audio/wav go in; seconds count as hearing', async () => {
    const gemini = vi.fn().mockResolvedValue({ text: 'Suzi Salman کو رپورٹ بھیج دو Monday تک', lang: 'ur' });
    const recognize = vi.fn();
    const r: any = await runSpeechOp('T', 2, 'speech.hear', { audio: voiced(2), engine: 'gemini', hint: 'Suzi, Salman' }, signed, { env, gemini, recognize });
    expect(r.ok).toBe(true);
    expect(r.item).toMatchObject({ text: 'Suzi Salman کو رپورٹ بھیج دو Monday تک', language: 'ur', engine: GEMINI_HEAR_MODELS[0] });
    expect(r.item).toMatchObject({ quota_full_s: 300 * 60, quota_left_s: 300 * 60 - 600 - 2 }); // the 80% banner reads these
    const [model, wavB64, instruction] = gemini.mock.calls[0];
    expect(model).toBe('gemini-2.5-flash');
    expect(Buffer.from(wavB64, 'base64').subarray(0, 4).toString()).toBe('RIFF');
    expect(instruction).toBe(`${HEAR_INSTRUCTION}\nWords and names that may come up, spelled this way: Suzi, Salman.`);
    expect(recognize).not.toHaveBeenCalled();
    expect(exec.mock.calls[0][3]).toBe(HEAR_SERVICE);
    expect(exec.mock.calls[0][4]).toBe(2);
    expect(exec.mock.calls[0][5]).toBe(0); // its money is in llm_spend, never twice
  });
  it('silence never reaches a model', async () => {
    const gemini = vi.fn();
    const r: any = await runSpeechOp('T', 2, 'speech.hear', { audio: pcm(1), engine: 'gemini' }, signed, { env, gemini });
    expect(r).toMatchObject({ ok: true, item: { text: '', engine: 'silence' } });
    expect(gemini).not.toHaveBeenCalled();
    expect(peakOf(Buffer.from(voiced(0.1), 'base64'))).toBeGreaterThan(2900);
  });
  it('a failing model moves to the next; all failing moves to Speech-to-Text', async () => {
    const gemini = vi.fn().mockRejectedValueOnce(new Error('503 high demand')).mockResolvedValueOnce({ text: 'ok thank you', lang: 'en' });
    const r1: any = await runSpeechOp('T', 2, 'speech.hear', { audio: voiced(1), engine: 'gemini' }, signed, { env, gemini });
    expect(r1.item).toMatchObject({ text: 'ok thank you', engine: GEMINI_HEAR_MODELS[1] });
    const down = vi.fn().mockRejectedValue(new Error('down'));
    const recognize = vi.fn().mockResolvedValue({ results: [{ alternatives: [{ transcript: 'ok thank you' }], languageCode: 'en-in' }] });
    const r2: any = await runSpeechOp('T', 2, 'speech.hear', { audio: voiced(1), engine: 'gemini' }, signed, { env, gemini: down, recognize });
    expect(down).toHaveBeenCalledTimes(GEMINI_HEAR_MODELS.length);
    expect(r2.item).toMatchObject({ text: 'ok thank you', engine: 'stt' });
  });
  it('without engine the relay is Speech-to-Text as before', async () => {
    const gemini = vi.fn();
    const recognize = vi.fn().mockResolvedValue({ results: [{ alternatives: [{ transcript: 'hello' }], languageCode: 'en-in' }] });
    const r: any = await runSpeechOp('T', 2, 'speech.hear', { audio: voiced(1) }, signed, { env, gemini, recognize });
    expect(r.item.engine).toBe('stt');
    expect(gemini).not.toHaveBeenCalled();
  });
  it('one cap for both engines: the month counts Speech-to-Text and relay seconds of his devices', async () => {
    await runSpeechOp('T', 2, 'speech.token', {}, signed, { env });
    const [sql, ...args] = query.mock.calls[0];
    expect(sql).toContain("part = 'device' AND service IN ($3, $5)");
    expect(args).toEqual(['T', 2, STT_SERVICE, '2026-11-28', HEAR_SERVICE]);
  });
});
