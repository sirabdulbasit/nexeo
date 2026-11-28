/**
 * Link T57 (founder 28 Nov 2026, both AGREE 20:28/20:29 PKT): speech-to-text for every Suzi (SLC and SMC) with ONE
 * Google account, held at Nexeo. No device ever holds a key.
 *
 *   speech.token {}                      -> {access_token, expires_at, quota_left_s}
 *        A self-signed JWT, audience https://speech.googleapis.com/ only (Google refuses it on every other API),
 *        15 minutes, signed with the SPEECH-ONLY service account (SPEECH_SA_KEY_FILE), never Nexeo's main account.
 *        The device calls Google directly with `Authorization: Bearer <token>`, so her reply keeps the 2 s target.
 *   speech.used  {seconds, requests}     -> {month_seconds, quota_left_s}  counted per user and device per month.
 *   speech.hear  {audio, languages?, hint?, engine?} -> {text, language, ms, engine}  the relay. engine "gemini" (link T59,
 *        founder 28 Nov "yes SMC should hear like SLC"; both AGREE 28 Nov): Gemini writes his words down, models in
 *        GEMINI_HEAR_MODELS order, 2.5 s each; then Speech-to-Text (SPEECH_MODEL), as without an engine:
 *        LINEAR16 16 kHz mono, at most 15 s (500 KB raw); audio is passed to Google and dropped, never stored.
 *
 * All three need a request signed with a registered device key (T57 (c)). Errors: unsigned | not_set_up | cap |
 * bad_audio | no_speech | failed. These ops never pass through suzi_act_log: it stores args and answers, and these
 * carry audio and a bearer pass (T57 point 5). The audit line holds counts only.
 *
 * The cap is the founder's (Costing Charter): 150 minutes per user per month (28 Nov), SPEECH_MONTHLY_CAP_MINUTES overrides;
 * 0 or a bad value = not_set_up. The key is read from DEFAULT_SPEECH_KEY_FILE unless SPEECH_SA_KEY_FILE says otherwise.
 */
import crypto from 'crypto';
import fs from 'fs';
import prisma from '../../db/prisma';
import { localDate, safeTimezone } from './dayBriefFacts';

export const SPEECH_OPS = ['speech.token', 'speech.used', 'speech.hear'] as const;
export const SPEECH_AUDIENCE = 'https://speech.googleapis.com/';
export const TOKEN_TTL_S = 15 * 60;
export const MAX_AUDIO_BYTES = 500 * 1024;
const BYTES_PER_SECOND = 16_000 * 2; // LINEAR16, 16 kHz, mono
const MAX_LANGS = 4; // Google: one main language and up to 3 others
/** Google Speech-to-Text, standard model: about $0.016 a minute, billed per second (pricing page, 28 Nov 2026). */
export const STT_USD_PER_SECOND = 0.016 / 60;
export const STT_SERVICE = 'google_stt_seconds';
/** Google refuses latest_short and latest_long when Urdu (ur-PK) is the main language. command_and_search takes every
 *  language order and read 3 of 3 test sentences (Urdu and English) right in about 1 s (live test 28 Nov 2026). */
export const SPEECH_MODEL = 'command_and_search';

/** T59 (C1), measured 28 Nov: 2.5-flash kept a mixed Urdu/English clip right with Urdu in Urdu script (2.0 s);
 *  3.1-flash-lite answered 503 once; 2.5-flash-lite wrote Urdu in Latin letters. Each gets HEAR_MODEL_TIMEOUT_MS. */
export const GEMINI_HEAR_MODELS = ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'] as const;
export const HEAR_MODEL_TIMEOUT_MS = 2_500;
/** Below this peak (16-bit samples) a clip is silence: no model is called (T59 point 2). */
export const SILENCE_PEAK = 150;
/** The relay's seconds, whatever engine heard them (T59 C2: one cap for both of Nexeo's engines). */
export const HEAR_SERVICE = 'hearing_seconds';
/** SLC's companion instruction (server/google.ts HEAR), word for word (T59 point 2). */
export const HEAR_INSTRUCTION = 'You transcribe a short recording of one person speaking. Write exactly what they said, nothing else: no reply, no commentary, no translation. English words in English; Urdu words always in Urdu (Perso-Arabic) script, never in Latin letters, even inside an English sentence. Keep names as names. "lang" is "ur" when the speech is mostly Urdu, "en" otherwise. If there are no real words (silence, noise, a cough), "text" is "".';

type Result = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
const fail = (error: string, detail?: string): Result => ({ ok: false, error, ...(detail ? { detail } : {}) });
type Gate = { signatureVerified: boolean; deviceId?: string | null; idempotencyKey?: string; timezone?: string; now?: Date };

interface SpeechAccount { client_email: string; private_key: string; private_key_id?: string }

/** Where the founder's speech-only key lives (28 Nov 2026: suzi-speech@nexeo-tmc, mode 600). SPEECH_SA_KEY_FILE overrides. */
export const DEFAULT_SPEECH_KEY_FILE = '/root/secrets/suzi-speech-nexeo-tmc.json';
/** The founder's cap, 28 Nov 2026 23:2x PKT: "150 minutes (~$2.40)" per user per month. SPEECH_MONTHLY_CAP_MINUTES overrides. */
export const DEFAULT_MONTHLY_CAP_MINUTES = 150;

/** The speech-only account, or null when the founder has not set it up. Never Nexeo's main account. */
export function speechAccount(env: NodeJS.ProcessEnv = process.env): SpeechAccount | null {
  const path = env.SPEECH_SA_KEY_FILE || DEFAULT_SPEECH_KEY_FILE;
  if (!path) return null;
  try {
    // A key readable by group or others is refused (28 Nov: the first key was left in the repo root, mode 644).
    if (fs.statSync(path).mode & 0o077) return null;
    const j = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (typeof j?.client_email !== 'string' || typeof j?.private_key !== 'string') return null;
    if (path === env.GOOGLE_APPLICATION_CREDENTIALS) return null; // T57 (b): the main account is never handed out
    return { client_email: j.client_email, private_key: j.private_key, private_key_id: j.private_key_id };
  } catch { return null; }
}

/** The founder's cap in seconds per user per month, or null when not set. */
export function monthlyCapSeconds(env: NodeJS.ProcessEnv = process.env): number | null {
  const m = env.SPEECH_MONTHLY_CAP_MINUTES === undefined || env.SPEECH_MONTHLY_CAP_MINUTES === '' ? DEFAULT_MONTHLY_CAP_MINUTES : Number(env.SPEECH_MONTHLY_CAP_MINUTES);
  return Number.isFinite(m) && m > 0 ? Math.round(m * 60) : null;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** T57 (a): a self-signed JWT that Google accepts only on Speech-to-Text. */
export function mintSpeechJwt(acct: SpeechAccount, nowS: number): { token: string; expiresAt: number } {
  const exp = nowS + TOKEN_TTL_S;
  const header = { alg: 'RS256', typ: 'JWT', ...(acct.private_key_id ? { kid: acct.private_key_id } : {}) };
  const payload = { iss: acct.client_email, sub: acct.client_email, aud: SPEECH_AUDIENCE, iat: nowS, exp };
  const signing = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(signing), acct.private_key);
  return { token: `${signing}.${b64url(sig)}`, expiresAt: exp };
}

/** Seconds he used this calendar month (his own zone). */
export async function monthSeconds(clientNumber: string, userId: number, today: string): Promise<number> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(units), 0)::float AS s FROM consumption_events
      WHERE client_number = $1 AND user_id = $2 AND part = 'device' AND service IN ($3, $5)
        AND day >= date_trunc('month', $4::date)::date AND day <= $4::date`,
    clientNumber, userId, STT_SERVICE, today, HEAR_SERVICE,
  );
  return Number(rows?.[0]?.s) || 0;
}

async function recordSeconds(clientNumber: string, userId: number, seconds: number, requests: number, today: string, deviceId: string | null, sourceKey: string,
  service: string = STT_SERVICE): Promise<void> {
  // A Gemini hearing's money is already in llm_spend (every Gemini call is recorded there), so its row here carries
  // the seconds for the cap and $0, never the cost twice.
  const usd = service === STT_SERVICE ? seconds * STT_USD_PER_SECOND : 0;
  await prisma.$executeRawUnsafe(
    `INSERT INTO consumption_events (client_number, user_id, part, service, unit, units, est_usd, measured, day, device_id, source_key)
     VALUES ($1, $2, 'device', $3, 'seconds', $4, $5, true, $6::date, $7, $8)
     ON CONFLICT (client_number, source_key) DO NOTHING`,
    clientNumber, userId, service, seconds, usd, today,
    deviceId ? deviceId.slice(0, 60) : null, sourceKey.slice(0, 260),
  );
  void requests; // counted by the audit line; the record keeps seconds (what Google bills)
}

/** A language code like ur-PK or en-US; at most 4, the first is the main one. Defaults to his three, English (India)
 *  first: tested live 28 Nov with the speech pass, en-IN main gives his English word for word and his Urdu in Roman
 *  letters ("Mujhe cal ki meeting ka batao"); ur-PK main writes his English in Urdu script ("اوکے تھینک یو"). */
export function languagesOf(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [];
  const clean = [...new Set(list.map((x) => String(x ?? '').trim()).filter((x) => /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(x)))];
  return (clean.length ? clean : ['en-IN', 'ur-PK', 'en-US']).slice(0, MAX_LANGS);
}

/** Phrase hints (his names, her name): a comma line or a list, at most 50 phrases of 100 characters. */
export function hintsOf(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return [...new Set(list.map((x) => String(x ?? '').trim().slice(0, 100)).filter(Boolean))].slice(0, 50);
}

export type Recognize = (req: { audio: { content: string }; config: Record<string, unknown> }, acct: SpeechAccount) => Promise<any>;
const googleRecognize: Recognize = async (req, acct) => {
  const speech = await import('@google-cloud/speech');
  const client = new speech.v1p1beta1.SpeechClient({ credentials: { client_email: acct.client_email, private_key: acct.private_key } });
  const [response] = await client.recognize(req as any);
  return response;
};

/** The loudest 16-bit sample of a LINEAR16 clip. */
export function peakOf(pcm: Buffer): number {
  let peak = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) { const v = Math.abs(pcm.readInt16LE(i)); if (v > peak) peak = v; }
  return peak;
}

/** A WAV container around LINEAR16 16 kHz mono, as Gemini takes audio/wav. */
export function wavOf(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16_000, 24);
  h.writeUInt32LE(32_000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export type GeminiHear = (model: string, wavB64: string, instruction: string, ctx: { clientNumber: string; userId: number }) => Promise<{ text: string; lang: string }>;
const geminiHear: GeminiHear = async (model, wavB64, instruction, ctx) => {
  const { getConfiguredGenAI } = await import('../genaiClient');
  const { runWithLlmFeature } = await import('../llmBillingLabels');
  const ai = await getConfiguredGenAI();
  const out: any = await runWithLlmFeature('speech_hear', ctx.clientNumber, () => ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: instruction }, { inlineData: { mimeType: 'audio/wav', data: wavB64 } }] }],
    config: {
      temperature: 0.1, maxOutputTokens: 512, responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: { text: { type: 'string' }, lang: { type: 'string' } }, required: ['text', 'lang'] } as any,
      ...(model === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      labels: { app: 'suzi-mobile' },
    } as any,
  }), { userId: ctx.userId });
  const j = JSON.parse(String(out?.text ?? '{}'));
  return { text: String(j?.text ?? '').trim(), lang: String(j?.lang ?? '') };
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`timeout ${ms} ms`)), ms); t.unref?.(); })])
    .finally(() => { if (t) clearTimeout(t); });
}

export async function runSpeechOp(clientNumber: string, userId: number, op: string, a: Record<string, unknown>, gate: Gate,
  deps: { recognize?: Recognize; gemini?: GeminiHear; env?: NodeJS.ProcessEnv } = {}): Promise<Result> {
  if (!(SPEECH_OPS as readonly string[]).includes(op)) return fail('unknown_op');
  if (!gate.signatureVerified) return fail('unsigned', 'speech needs a request signed with a registered device key (T57 c)');
  const env = deps.env ?? process.env;
  const now = gate.now ?? new Date();
  const today = localDate(now, safeTimezone(gate.timezone));
  const deviceId = gate.deviceId ? String(gate.deviceId) : null;

  if (op === 'speech.used') {
    const seconds = Number(a.seconds);
    const requests = Math.max(1, Math.floor(Number(a.requests) || 1));
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86_400) return fail('bad_seconds', 'seconds is 0 to 86400');
    const key = String(gate.idempotencyKey ?? '').trim();
    if (!key) return fail('bad_idempotency_key');
    await recordSeconds(clientNumber, userId, Math.round(seconds * 1000) / 1000, requests, today, deviceId, `stt:${userId}:${key}`);
    const used = await monthSeconds(clientNumber, userId, today);
    const cap = monthlyCapSeconds(env);
    return { ok: true, item: { month_seconds: Math.round(used), quota_left_s: cap === null ? 0 : Math.max(0, Math.floor(cap - used)), quota_full_s: cap ?? 0 } };
  }

  const acct = speechAccount(env);
  const cap = monthlyCapSeconds(env);
  if (!acct || cap === null) return fail('not_set_up', !acct ? 'the speech-only Google account is not set up at Nexeo' : 'the founder has not set the monthly cap');
  const used = await monthSeconds(clientNumber, userId, today);
  const left = Math.max(0, Math.floor(cap - used));
  if (left <= 0) return fail('cap', 'this month\'s speech minutes are used; the device uses its own hearing');

  if (op === 'speech.token') {
    const { token, expiresAt } = mintSpeechJwt(acct, Math.floor(now.getTime() / 1000));
    return { ok: true, item: { access_token: token, expires_at: new Date(expiresAt * 1000).toISOString(), quota_left_s: left, quota_full_s: cap } };
  }

  // speech.hear: the relay.
  const raw = typeof a.audio === 'string' ? Buffer.from(a.audio, 'base64') : Buffer.alloc(0);
  if (!raw.length || raw.length > MAX_AUDIO_BYTES || raw.length % 2) return fail('bad_audio', 'LINEAR16 16 kHz mono, at most 15 s (500 KB)');
  const seconds = raw.length / BYTES_PER_SECOND;
  const langs = languagesOf(a.languages);
  const hints = hintsOf(a.hint);
  const started = Date.now();
  // T59: every reply carries the month's allowance, so SLC/SMC can show the 80% banner (founder 28 Nov).
  const quota = (heard: boolean) => ({ quota_left_s: Math.max(0, left - (heard ? Math.ceil(seconds) : 0)), quota_full_s: cap });
  if (a.engine === 'gemini') {
    // T59: silence never reaches a model.
    if (peakOf(raw) < SILENCE_PEAK) return { ok: true, item: { text: '', language: langs[0], ms: Date.now() - started, engine: 'silence', ...quota(false) } };
    const instruction = hints.length ? `${HEAR_INSTRUCTION}\nWords and names that may come up, spelled this way: ${hints.join(', ')}.` : HEAR_INSTRUCTION;
    const wavB64 = wavOf(raw).toString('base64');
    for (const model of GEMINI_HEAR_MODELS) {
      try {
        const r = await withTimeout((deps.gemini ?? geminiHear)(model, wavB64, instruction, { clientNumber, userId }), HEAR_MODEL_TIMEOUT_MS);
        await recordSeconds(clientNumber, userId, Math.round(seconds * 1000) / 1000, 1, today, deviceId, `hear-relay:${userId}:${crypto.randomUUID()}`, HEAR_SERVICE);
        return { ok: true, item: { text: r.text, language: r.lang === 'ur' ? 'ur' : r.lang === 'en' ? 'en' : (r.lang || langs[0]), ms: Date.now() - started, engine: model, ...quota(true) } };
      } catch { /* next model, then Speech-to-Text (T59 C1) */ }
    }
  }
  let response: any;
  try {
    response = await (deps.recognize ?? googleRecognize)({
      audio: { content: raw.toString('base64') },
      config: {
        encoding: 'LINEAR16', sampleRateHertz: 16_000, audioChannelCount: 1, model: SPEECH_MODEL,
        languageCode: langs[0], ...(langs.length > 1 ? { alternativeLanguageCodes: langs.slice(1) } : {}),
        ...(hints.length ? { speechContexts: [{ phrases: hints }] } : {}),
      },
    }, acct);
  } catch (e: any) {
    return fail('failed', String(e?.message ?? e).slice(0, 200));
  }
  const ms = Date.now() - started;
  // Google bills the seconds it heard, so they count even when nothing was said.
  await recordSeconds(clientNumber, userId, Math.round(seconds * 1000) / 1000, 1, today, deviceId, `stt-relay:${userId}:${crypto.randomUUID()}`);
  const results: any[] = Array.isArray(response?.results) ? response.results : [];
  const text = results.map((r) => String(r?.alternatives?.[0]?.transcript ?? '').trim()).filter(Boolean).join(' ').trim();
  if (!text) return fail('no_speech');
  const language = String(results.find((r) => r?.languageCode)?.languageCode ?? langs[0]);
  return { ok: true, item: { text, language, ms, engine: 'stt', ...quota(true) } };
}
