/**
 * Costing Charter — the consumption record. Nexeo keeps the one record, daily, for Nexeo and Suzi,
 * viewable by service, user, day or date range. Counts only: never content.
 *
 *   recordServerRound     one model round from Suzi's server (the provider's own counts)
 *   recordDesktopBatch    the desktop app's daily batch; safe to resend; up to 7 days late
 *   consumptionReport     everything together: these rows plus Nexeo's own llm_spend
 *
 * Day = the user's own zone. Nexeo's own rows in llm_spend are bucketed by the view it already has.
 */
import prisma from '../../db/prisma';
import { localDate, safeTimezone } from '../suzi/dayBriefFacts';
import { DESKTOP_SERVICES, modelPrice, tokenCostUsd } from './priceTable';

export const MAX_BATCH_AGE_DAYS = 7;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ServerRound {
  turn_id: string; round: number; model?: string | null; prompt: number; cached: number; output: number; thoughts: number; device_id?: string | null;
}

export async function recordServerRound(clientNumber: string, userId: number, r: ServerRound, opts: { timezone?: string; now?: Date } = {}): Promise<void> {
  const num = (x: unknown) => Math.max(0, Math.floor(Number(x) || 0));
  const t = { input: num(r.prompt), cached: num(r.cached), output: num(r.output), thinking: num(r.thoughts) };
  const usd = tokenCostUsd(r.model, t);
  await prisma.$executeRawUnsafe(
    `INSERT INTO consumption_events
       (client_number, user_id, part, service, model, unit, units, input_tokens, cached_tokens, output_tokens, thinking_tokens, est_usd, measured, day, device_id, source_key)
     VALUES ($1, $2, 'suzi_server', 'conversation', $3, 'rounds', 1, $4, $5, $6, $7, $8, $9, $10::date, $11, $12)
     ON CONFLICT (client_number, source_key) DO NOTHING`,
    clientNumber, userId, r.model ? String(r.model).slice(0, 80) : null, t.input, t.cached, t.output, t.thinking, usd,
    modelPrice(r.model).measured, localDate(opts.now ?? new Date(), safeTimezone(opts.timezone)),
    r.device_id ? String(r.device_id).slice(0, 60) : null, `round:${String(r.turn_id).slice(0, 200)}:${num(r.round)}`,
  );
}

export interface DesktopBatch {
  day: string; os?: string; app_version?: string; idempotency_key: string; device_id?: string | null;
  items: Array<{ service: string; units: number; unit?: string }>;
}

export type BatchResult =
  | { status: 200; body: { ok: true; stored: number; replayed: number; ignored: string[] } }
  | { status: 400 | 409; body: { ok: false; error: string } };

export async function recordDesktopBatch(clientNumber: string, userId: number, b: DesktopBatch, opts: { timezone?: string; now?: Date } = {}): Promise<BatchResult> {
  const key = typeof b.idempotency_key === 'string' ? b.idempotency_key.trim() : '';
  if (!key || key.length > 180) return { status: 400, body: { ok: false, error: 'bad_idempotency_key' } };
  if (typeof b.day !== 'string' || !DAY.test(b.day) || isNaN(Date.parse(`${b.day}T12:00:00Z`))) return { status: 400, body: { ok: false, error: 'bad_day' } };
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) return { status: 400, body: { ok: false, error: 'bad_items' } };
  const today = localDate(opts.now ?? new Date(), safeTimezone(opts.timezone));
  const age = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${b.day}T12:00:00Z`)) / 86_400_000;
  if (age > MAX_BATCH_AGE_DAYS) return { status: 409, body: { ok: false, error: 'too_late' } };
  if (age < -1) return { status: 400, body: { ok: false, error: 'bad_day' } };

  let stored = 0; let replayed = 0; const ignored: string[] = [];
  for (const it of b.items) {
    const price = DESKTOP_SERVICES[String(it?.service)];
    const units = Number(it?.units);
    if (!price || !Number.isFinite(units) || units < 0) { ignored.push(String(it?.service).slice(0, 60)); continue; }
    const n = await prisma.$executeRawUnsafe(
      `INSERT INTO consumption_events
         (client_number, user_id, part, service, unit, units, est_usd, measured, day, device_id, os, source_key)
       VALUES ($1, $2, 'desktop', $3, $4, $5, $6, $7, $8::date, $9, $10, $11)
       ON CONFLICT (client_number, source_key) DO NOTHING`,
      clientNumber, userId, it.service, price.unit, units, units * price.usdPerUnit, price.measured, b.day,
      b.device_id ? String(b.device_id).slice(0, 60) : null, b.os ? String(b.os).slice(0, 20) : null, `batch:${userId}:${key}:${it.service}`,
    );
    if (n) stored++; else replayed++;
  }
  return { status: 200, body: { ok: true, stored, replayed, ignored } };
}

export const GROUPS = ['service', 'user', 'day', 'month', 'part', 'client'] as const;
export type ConsumptionGroup = typeof GROUPS[number];

export interface ConsumptionRow { key: string; part?: string; calls: number; input_tokens: number; cached_tokens: number; output_tokens: number; est_usd: number; all_measured: boolean }

const COMBINED = `
  SELECT day, client_number, user_id, 'nexeo'::text AS part, COALESCE(purpose, 'unknown')::text AS service,
         calls::bigint AS calls, input_tokens::bigint AS input_tokens, 0::bigint AS cached_tokens, output_tokens::bigint AS output_tokens,
         est_usd::numeric AS est_usd, true AS measured
    FROM llm_spend_unified
  UNION ALL
  SELECT day, client_number, user_id, part::text, service::text,
         (CASE WHEN part = 'desktop' THEN 0 ELSE 1 END)::bigint, input_tokens::bigint, cached_tokens::bigint, (output_tokens + thinking_tokens)::bigint,
         est_usd::numeric, measured
    FROM consumption_events`;

const KEY: Record<ConsumptionGroup, string> = { service: `part || ' / ' || service`, user: `COALESCE((SELECT u.name FROM users u WHERE u.id = c.user_id) || ' #' || c.user_id, c.user_id::text, 'system')`, day: `day::text`, month: `to_char(day, 'YYYY-MM')`, part: `part`, client: `COALESCE((SELECT t.name FROM tenants t WHERE t.client_number = c.client_number) || ' · ', '') || c.client_number` };

/** One line per service, user, day, month, part or client over a date range, plus the total. userId narrows it to one person. A null client means every client: super admins only, enforced by the route. */
export async function consumptionReport(clientNumber: string | null, p: { from: string; to: string; groupBy: ConsumptionGroup; userId?: number }) {
  if (!DAY.test(p.from) || !DAY.test(p.to)) throw new Error('from and to must be YYYY-MM-DD');
  const params: unknown[] = [p.from, p.to];
  if (clientNumber !== null) params.unshift(clientNumber);
  const firstDay = clientNumber !== null ? 2 : 1;
  if (p.userId) params.push(p.userId);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${KEY[p.groupBy]} AS key, SUM(calls)::bigint AS calls, SUM(input_tokens)::bigint AS input_tokens, SUM(cached_tokens)::bigint AS cached_tokens,
            SUM(output_tokens)::bigint AS output_tokens, SUM(est_usd)::float8 AS est_usd, BOOL_AND(measured) AS all_measured
       FROM (${COMBINED}) c
      WHERE ${clientNumber !== null ? 'client_number = $1 AND ' : ''}day BETWEEN $${firstDay}::date AND $${firstDay + 1}::date ${p.userId ? `AND user_id = $${firstDay + 2}` : ''}
      GROUP BY 1 ORDER BY ${p.groupBy === 'day' || p.groupBy === 'month' ? '1' : 'SUM(est_usd) DESC'}`,
    ...params,
  );
  const out: ConsumptionRow[] = rows.map((r) => ({
    key: String(r.key), calls: Number(r.calls), input_tokens: Number(r.input_tokens), cached_tokens: Number(r.cached_tokens),
    output_tokens: Number(r.output_tokens), est_usd: Math.round(Number(r.est_usd) * 1e4) / 1e4, all_measured: r.all_measured === true,
  }));
  return { from: p.from, to: p.to, groupBy: p.groupBy, rows: out, total_usd: Math.round(out.reduce((s, r) => s + r.est_usd, 0) * 1e4) / 1e4 };
}

export function reportCsv(rows: ConsumptionRow[]): string {
  const q = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  return ['key,calls,input_tokens,cached_tokens,output_tokens,est_usd,all_measured',
    ...rows.map((r) => [q(r.key), r.calls, r.input_tokens, r.cached_tokens, r.output_tokens, r.est_usd, r.all_measured].join(','))].join('\n') + '\n';
}

/**
 * F-4 (Costing Charter §7.3): `meeting_transcript_minutes`, counted when a Way A transcript is read. A count only,
 * never content; once per transcript (a re-read of the same transcript is not counted again).
 */
export async function recordMeetingTranscriptMinutes(
  clientNumber: string, userId: number, transcriptName: string, minutes: number, opts: { timezone?: string; now?: Date } = {},
): Promise<void> {
  const units = Math.max(0, Math.round(Number(minutes) || 0));
  await prisma.$executeRawUnsafe(
    `INSERT INTO consumption_events (client_number, user_id, part, service, unit, units, est_usd, measured, day, source_key)
     VALUES ($1, $2, 'nexeo', 'meeting_transcript_minutes', 'minutes', $3, 0, TRUE, $4::date, $5)
     ON CONFLICT (client_number, source_key) DO NOTHING`,
    clientNumber, userId, units, localDate(opts.now ?? new Date(), safeTimezone(opts.timezone)),
    `meet:${String(transcriptName).slice(0, 200)}`,
  );
}
