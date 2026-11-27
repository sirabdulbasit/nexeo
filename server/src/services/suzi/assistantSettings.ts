/**
 * T56 (founder 27 Nov, via Suzi-Builder): "Move Email Signature, Assistant settings to Nexeo and remove from both
 * Suzi (Mob and Laptop)". Nexeo's Settings -> Assistant is now the one place for:
 *   - her name            (record: users.notification_preferences.brainName, as before)
 *   - what she calls him  (record: users.notification_preferences.profile.preferredTitle, as before)
 *   - wake phrase         (record: his profile note, key assistant.wake_phrase)
 *   - sleep phrases       (record: his profile note, key assistant.sleep_phrases)
 *   - email signature     (record: his profile note, key email.signature, D-338)
 * Every Suzi of his (laptop, phone) reads them from the pack: profile.assistant {name, user_name, wake_phrase?,
 * sleep_phrases?} and profile['email.signature'] as before. A phrase never set is left out, so Suzi keeps her own.
 */
import prisma from '../../db/prisma';
import { getAssistantName, setAssistantName } from './suziProfile';

export const MAX_PHRASE = 40;
export const MAX_SLEEP = 10;
export const MAX_SIGNATURE = 500;
const WAKE_KEY = 'assistant.wake_phrase';
const SLEEP_KEY = 'assistant.sleep_phrases';
const SIGNATURE_KEY = 'email.signature';
const PHRASE = /^[\p{L}\p{M}][\p{L}\p{M} '-]*$/u;

export interface AssistantSettings {
  name: string;
  user_name: string;
  wake_phrase: string | null;
  sleep_phrases: string[];
  signature: string | null;
}

export interface PackAssistant { name: string; user_name: string; wake_phrase?: string; sleep_phrases?: string[] }

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** A phrase is 2..40 letters and spaces (written the way it sounds). '' means "not set". null = not a phrase. */
export function phraseOf(v: unknown): string | null {
  const t = clean(v).toLowerCase();
  if (!t) return '';
  return t.length >= 2 && t.length <= MAX_PHRASE && PHRASE.test(t) ? t : null;
}

/** Sleep phrases come as a list or as one comma-separated line. null when any one is not a phrase. */
export function sleepPhrasesOf(v: unknown): string[] | null {
  const parts = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out: string[] = [];
  for (const p of parts) {
    const t = phraseOf(p);
    if (t === null) return null;
    if (t && !out.includes(t)) out.push(t);
  }
  return out.length <= MAX_SLEEP ? out : null;
}

/** What she calls him: the name he set, else his first name. */
export function userNameOf(preferredTitle: unknown, accountName: unknown): string {
  const t = clean(preferredTitle);
  if (t) return t.slice(0, MAX_PHRASE);
  const first = clean(accountName).split(' ')[0];
  return first || 'there';
}

async function userRow(clientNumber: string, userId: number): Promise<{ name: string; title: string | null }> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string | null; title: string | null }>>(
    `SELECT name, notification_preferences->'profile'->>'preferredTitle' AS title FROM users WHERE id = $1 AND client_number = $2`,
    userId, clientNumber,
  );
  return { name: rows[0]?.name ?? '', title: rows[0]?.title ?? null };
}

export async function getAssistantSettings(clientNumber: string, userId: number): Promise<AssistantSettings> {
  const { profileOf } = await import('./suziW1');
  const [name, u, p] = await Promise.all([
    getAssistantName(clientNumber, userId),
    userRow(clientNumber, userId),
    profileOf(clientNumber, userId).catch(() => null),
  ]);
  const wake = typeof p?.[WAKE_KEY] === 'string' ? (p[WAKE_KEY] as string) : null;
  const sleep = Array.isArray(p?.[SLEEP_KEY]) ? (p![SLEEP_KEY] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const sig = typeof p?.[SIGNATURE_KEY] === 'string' ? (p[SIGNATURE_KEY] as string) : null;
  return { name, user_name: userNameOf(u.title, u.name), wake_phrase: wake, sleep_phrases: sleep, signature: sig };
}

export type SaveResult = { ok: true; settings: AssistantSettings } | { ok: false; field: string; error: string };

/** Saves only the fields sent. Nothing is written when any field is wrong. */
export async function saveAssistantSettings(clientNumber: string, userId: number, body: Record<string, unknown>): Promise<SaveResult> {
  const notes: Array<{ key: string; value: unknown }> = [];
  let name: string | undefined;
  let title: string | null | undefined;

  if (body.name !== undefined) {
    name = clean(body.name);
    if (!/^\p{L}[\p{L}\p{M} '-]{0,39}$/u.test(name)) return { ok: false, field: 'name', error: 'Her name is 1 to 40 letters.' };
  }
  if (body.user_name !== undefined) {
    const t = clean(body.user_name);
    if (t.length > MAX_PHRASE) return { ok: false, field: 'user_name', error: 'At most 40 characters.' };
    title = t || null;
  }
  if (body.wake_phrase !== undefined) {
    const w = phraseOf(body.wake_phrase);
    if (w === null) return { ok: false, field: 'wake_phrase', error: 'Letters and spaces, 2 to 40, written the way it sounds.' };
    notes.push({ key: WAKE_KEY, value: w }); // '' forgets it: Suzi keeps her own
  }
  if (body.sleep_phrases !== undefined) {
    const s = sleepPhrasesOf(body.sleep_phrases);
    if (s === null) return { ok: false, field: 'sleep_phrases', error: `Up to ${MAX_SLEEP} phrases, comma-separated, letters and spaces.` };
    notes.push({ key: SLEEP_KEY, value: s.length ? s : '' });
  }
  if (body.signature !== undefined) {
    const raw = typeof body.signature === 'string' ? body.signature.replace(/\r\n/g, '\n').trim() : '';
    if (raw.length > MAX_SIGNATURE) return { ok: false, field: 'signature', error: `At most ${MAX_SIGNATURE} characters.` };
    notes.push({ key: SIGNATURE_KEY, value: raw });
  }

  if (name !== undefined && !(await setAssistantName(clientNumber, userId, name))) {
    return { ok: false, field: 'name', error: 'Her name is 1 to 40 letters.' };
  }
  if (title !== undefined) {
    await prisma.$executeRawUnsafe(
      `UPDATE users SET notification_preferences = jsonb_set(
         jsonb_set(COALESCE(notification_preferences::jsonb, '{}'::jsonb), '{profile}', COALESCE(notification_preferences::jsonb->'profile', '{}'::jsonb)),
         '{profile,preferredTitle}', COALESCE(to_jsonb($1::text), 'null'::jsonb))
        WHERE id = $2 AND client_number = $3`,
      title, userId, clientNumber,
    );
  }
  if (notes.length) {
    const { runW1Op } = await import('./suziW1');
    const at = new Date().toISOString();
    const r: any = await runW1Op(clientNumber, userId, 'profile.update',
      { notes: notes.map((n) => ({ ...n, evidence_count: 0, updated: at })) }, true, { signatureVerified: false, from: 'settings' });
    if (!r?.ok) return { ok: false, field: 'save', error: 'Could not save to your Wiki profile.' };
  }
  return { ok: true, settings: await getAssistantSettings(clientNumber, userId) };
}

/** The pack's profile.assistant. Phrases never set are left out, so Suzi keeps her own. */
export function packAssistant(s: AssistantSettings): PackAssistant {
  return {
    name: s.name,
    user_name: s.user_name,
    ...(s.wake_phrase ? { wake_phrase: s.wake_phrase } : {}),
    ...(s.sleep_phrases.length ? { sleep_phrases: s.sleep_phrases } : {}),
  };
}
