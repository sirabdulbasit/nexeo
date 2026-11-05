/**
 * Costing Charter — the ONE price table. USD per million units, as billed on project nexeo-tmc
 * (bill for 28 Oct–4 Nov 2026), so every part of Nexeo and Suzi is priced the same way.
 *
 * `measured: false` marks a figure the bill has not confirmed. Gemini 3.1 Flash-Lite did not appear
 * in the bill's top lines, so its rates are estimates until the monthly check.
 */
export interface ModelPrice { in: number; cached: number; out: number; longIn?: number; longOut?: number; measured: boolean }

/** Above this many input tokens a Pro request bills at the long-context rate. */
export const LONG_CONTEXT_TOKENS = 200_000;

const PRO: ModelPrice = { in: 1.25, cached: 0.125, out: 10, longIn: 2.5, longOut: 15, measured: true };
const FLASH: ModelPrice = { in: 0.30, cached: 0.03, out: 2.5, measured: true };
const FLASH_LITE: ModelPrice = { in: 0.10, cached: 0.01, out: 0.40, measured: false };

/** The price of a model id; an unknown one is priced as Pro, the safe side for a budget. */
export function modelPrice(model: string | null | undefined): ModelPrice {
  const m = String(model ?? '').toLowerCase();
  if (m.includes('flash-lite')) return FLASH_LITE;
  if (m.includes('flash')) return FLASH;
  return PRO;
}

export function tokenCostUsd(model: string | null | undefined, t: { input: number; cached?: number; output: number; thinking?: number }): number {
  const p = modelPrice(model);
  const long = t.input > LONG_CONTEXT_TOKENS;
  const cached = Math.min(t.cached ?? 0, t.input);
  const inRate = long && p.longIn ? p.longIn : p.in;
  const outRate = long && p.longOut ? p.longOut : p.out;
  return ((t.input - cached) * inRate + cached * p.cached + (t.output + (t.thinking ?? 0)) * outRate) / 1e6;
}

/** The desktop app's per-use services (Costing Charter). Free and activity counts cost $0. */
export const DESKTOP_SERVICES: Record<string, { unit: string; usdPerUnit: number; measured: boolean }> = {
  voice_characters: { unit: 'characters', usdPerUnit: 30 / 1e6, measured: true },
  // ~32 audio tokens a second on Flash-Lite: the seconds are measured, the tokens estimated.
  hearing_seconds: { unit: 'seconds', usdPerUnit: (32 * FLASH_LITE.in) / 1e6, measured: false },
  meeting_audio_seconds: { unit: 'seconds', usdPerUnit: (32 * FLASH_LITE.in) / 1e6, measured: false },
  // ~4 characters a token, priced at the output rate as the safe side.
  meeting_writing_characters: { unit: 'characters', usdPerUnit: (FLASH_LITE.out / 4) / 1e6, measured: false },
  voice_characters_fallback: { unit: 'characters', usdPerUnit: 0, measured: true },
  local_hearing_seconds: { unit: 'seconds', usdPerUnit: 0, measured: true },
  local_screen_operator_steps: { unit: 'steps', usdPerUnit: 0, measured: true },
  turns_spoken: { unit: 'turns', usdPerUnit: 0, measured: true },
  turns_typed: { unit: 'turns', usdPerUnit: 0, measured: true },
  turns_app_started: { unit: 'turns', usdPerUnit: 0, measured: true },
  local_answers: { unit: 'answers', usdPerUnit: 0, measured: true },
  tool_steps: { unit: 'steps', usdPerUnit: 0, measured: true },
  screenshots_sent: { unit: 'screenshots', usdPerUnit: 0, measured: true },
  briefs_shown: { unit: 'briefs', usdPerUnit: 0, measured: true },
};
