/**
 * Actual GCP cost, from the Cloud Billing standard export in BigQuery. See docs/GCP_BILLING_VIEW.md.
 *
 * The rules every figure depends on:
 *  - net = cost + credits. `cost` is gross and credit amounts are negative.
 *  - days are Pacific time, as the Cloud Billing console shows them, so figures can match it.
 *  - the latest days are still being finalised: flagged, and never in an average.
 *  - month totals use invoice.month, which is what gets billed.
 *
 * Holds client project names: super-admin routes only. The key comes from the environment and must
 * never reach a log line or a response.
 */
import { readFileSync } from 'fs';
import { BigQuery } from '@google-cloud/bigquery';
import prisma from '../../db/prisma';

const BILLING_PROJECT = 'ispl-billing-analytics';
const TABLE = `${BILLING_PROJECT}.billing_export.gcp_billing_export_v1_01666C_EB28DA_B98F96`;
const ZONE = 'America/Los_Angeles';
const LOCATION = 'US';
const MAX_BYTES_BILLED = String(10 * 1024 ** 3); // a guard: this table is far smaller
const SYNC_WINDOW_DAYS = 70; // Google can still change recent days; older ones stay as loaded
const STALE_MS = 6 * 60 * 60 * 1000;
const MIN_MANUAL_GAP_MS = 5 * 60 * 1000;
const INCOMPLETE_DAYS = 3; // today, yesterday and the day before can all still be filling in

const NET_PARTS = `SUM(CAST(t.cost AS NUMERIC)) AS gross,
       SUM(IFNULL((SELECT SUM(CAST(c.amount AS NUMERIC)) FROM UNNEST(t.credits) c), 0)) AS credits`;
const DAY_SQL = `DATE(t.usage_start_time, '${ZONE}')`;

export function dailySql(fromDay: string): string {
  return `SELECT FORMAT_DATE('%F', ${DAY_SQL}) AS day, t.invoice.month AS invoice_month,
       IFNULL(t.project.id, '(no project)') AS project_id, ANY_VALUE(t.project.name) AS project_name,
       IFNULL(t.service.description, '(none)') AS service, IFNULL(t.sku.description, '(none)') AS sku,
       ${NET_PARTS}
  FROM \`${TABLE}\` t
 WHERE ${DAY_SQL} >= DATE '${fromDay}'
 GROUP BY day, invoice_month, project_id, service, sku`;
}

export function labelSql(fromDay: string): string {
  return `SELECT FORMAT_DATE('%F', ${DAY_SQL}) AS day, t.invoice.month AS invoice_month,
       IFNULL(t.project.id, '(no project)') AS project_id, l.key AS label_key, IFNULL(l.value, '') AS label_value,
       ${NET_PARTS}
  FROM \`${TABLE}\` t CROSS JOIN UNNEST(t.labels) l
 WHERE ${DAY_SQL} >= DATE '${fromDay}'
 GROUP BY day, invoice_month, project_id, label_key, label_value`;
}

export function isConfigured(): boolean {
  return !!(process.env.GCP_BILLING_SA_JSON || process.env.GCP_BILLING_SA_KEY_FILE);
}

/** Never echoes a parse error: those can quote part of the key. */
export function readCredentials(): Record<string, unknown> {
  try {
    const raw = process.env.GCP_BILLING_SA_JSON || readFileSync(String(process.env.GCP_BILLING_SA_KEY_FILE), 'utf8');
    return JSON.parse(raw);
  } catch {
    throw new Error('The billing key could not be read');
  }
}

export function pacificDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isIncomplete(day: string, today: string): boolean {
  return day > addDays(today, -INCOMPLETE_DAYS);
}

type BillingQuery = (sql: string) => Promise<any[]>;

function bigQueryRunner(): BillingQuery {
  const client = new BigQuery({ projectId: BILLING_PROJECT, credentials: readCredentials() as any });
  return async (sql) => {
    const [rows] = await client.query({ query: sql, location: LOCATION, maximumBytesBilled: MAX_BYTES_BILLED });
    return rows;
  };
}

function plain(rows: any[]): any[] {
  return rows.map((r) => ({ ...r, gross: String(r.gross ?? 0), credits: String(r.credits ?? 0) }));
}

export async function syncBilling(now = new Date(), run: BillingQuery = bigQueryRunner()): Promise<{ rows: number }> {
  const fromDay = addDays(pacificDay(now), -SYNC_WINDOW_DAYS);
  try {
    const [daily, labels] = await Promise.all([run(dailySql(fromDay)), run(labelSql(fromDay))]);
    // An empty answer must not wipe what is already loaded.
    if (daily.length === 0) throw new Error('The billing export returned no rows');
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`DELETE FROM gcp_billing_daily WHERE day >= $1::date`, fromDay),
      prisma.$executeRawUnsafe(`DELETE FROM gcp_billing_label_daily WHERE day >= $1::date`, fromDay),
      prisma.$executeRawUnsafe(
        `INSERT INTO gcp_billing_daily (day, invoice_month, project_id, project_name, service, sku, gross, credits)
         SELECT day, invoice_month, project_id, project_name, service, sku, gross, credits
           FROM jsonb_to_recordset($1::jsonb) AS x(day date, invoice_month text, project_id text, project_name text, service text, sku text, gross numeric, credits numeric)`,
        JSON.stringify(plain(daily)),
      ),
      prisma.$executeRawUnsafe(
        `INSERT INTO gcp_billing_label_daily (day, invoice_month, project_id, label_key, label_value, gross, credits)
         SELECT day, invoice_month, project_id, label_key, label_value, gross, credits
           FROM jsonb_to_recordset($1::jsonb) AS x(day date, invoice_month text, project_id text, label_key text, label_value text, gross numeric, credits numeric)`,
        JSON.stringify(plain(labels)),
      ),
      prisma.$executeRawUnsafe(
        `INSERT INTO gcp_billing_sync (id, last_ok_at, last_try_at, last_error, rows_loaded) VALUES (1, now(), now(), NULL, $1)
         ON CONFLICT (id) DO UPDATE SET last_ok_at = now(), last_try_at = now(), last_error = NULL, rows_loaded = $1`,
        daily.length,
      ),
    ]);
    return { rows: daily.length };
  } catch (err: any) {
    const message = String(err?.message ?? 'Billing sync failed').slice(0, 500);
    await prisma.$executeRawUnsafe(
      `INSERT INTO gcp_billing_sync (id, last_try_at, last_error) VALUES (1, now(), $1)
       ON CONFLICT (id) DO UPDATE SET last_try_at = now(), last_error = $1`,
      message,
    );
    throw new Error(message);
  }
}

async function syncState(): Promise<{ last_ok_at: Date | null; last_try_at: Date | null; last_error: string | null } | null> {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT last_ok_at, last_try_at, last_error FROM gcp_billing_sync WHERE id = 1`);
  return rows[0] ?? null;
}

/** The scheduled pass: at most one scan every six hours, however often the server restarts. */
export async function syncIfStale(now = new Date()): Promise<void> {
  if (!isConfigured()) return;
  const state = await syncState();
  const last = state?.last_try_at ? new Date(state.last_try_at).getTime() : 0;
  if (now.getTime() - last < STALE_MS) return;
  await syncBilling(now);
}

export async function manualSync(now = new Date()): Promise<{ rows: number } | { tooSoon: true }> {
  const state = await syncState();
  const last = state?.last_try_at ? new Date(state.last_try_at).getTime() : 0;
  if (now.getTime() - last < MIN_MANUAL_GAP_MS) return { tooSoon: true };
  return syncBilling(now);
}

const NET = `SUM(gross + credits)::float8`;

export interface BillingDay { day: string; gross: number; net: number; incomplete: boolean; first_export_day: boolean }

export function markDays(rows: Array<{ day: string; gross: number; net: number }>, today: string, firstDay: string | null): BillingDay[] {
  return rows.map((r) => ({ ...r, incomplete: isIncomplete(r.day, today), first_export_day: r.day === firstDay }));
}

/** Only finished days: a partly loaded day reads low and looks like a saving. */
export function completeAverage(days: BillingDay[]): number | null {
  const done = days.filter((d) => !d.incomplete && !d.first_export_day);
  return done.length ? done.reduce((s, d) => s + d.net, 0) / done.length : null;
}

function previousInvoiceMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(4, 6));
  return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, '0')}`;
}

export async function billingOverview(now = new Date()) {
  const today = pacificDay(now);
  const month = today.slice(0, 7).replace('-', '');
  const previous = previousInvoiceMonth(month);
  const from = addDays(today, -59);

  const [state, first, dailyRows, projectRows, labelRows, monthTotalRows] = await Promise.all([
    syncState(),
    prisma.$queryRawUnsafe<any[]>(`SELECT MIN(day)::text AS day FROM gcp_billing_daily`),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT day::text AS day, SUM(gross)::float8 AS gross, ${NET} AS net FROM gcp_billing_daily WHERE day >= $1::date GROUP BY day ORDER BY day`, from),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT project_id, MAX(project_name) AS project_name,
              COALESCE(SUM(gross + credits) FILTER (WHERE invoice_month = $1), 0)::float8 AS current_net,
              COALESCE(SUM(gross + credits) FILTER (WHERE invoice_month = $2), 0)::float8 AS previous_net
         FROM gcp_billing_daily WHERE invoice_month IN ($1, $2) GROUP BY project_id ORDER BY current_net DESC`, month, previous),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT label_key, label_value, ${NET} AS net FROM gcp_billing_label_daily WHERE invoice_month = $1
        GROUP BY label_key, label_value ORDER BY label_key, net DESC`, month),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT invoice_month, SUM(gross)::float8 AS gross, ${NET} AS net FROM gcp_billing_daily WHERE invoice_month IN ($1, $2) GROUP BY invoice_month`, month, previous),
  ]);

  const days = markDays(dailyRows, today, first[0]?.day ?? null);
  const totals = new Map(monthTotalRows.map((r: any) => [r.invoice_month, r]));
  const current = totals.get(month);
  const budget = Number(process.env.GCP_BILLING_MONTHLY_BUDGET_USD);
  const netMtd = current?.net ?? 0;

  // Per label key, what carries no such label. Keys are shown separately because one call carries
  // several keys, so adding across keys would double-count.
  const labelled = new Map<string, number>();
  for (const r of labelRows) labelled.set(r.label_key, (labelled.get(r.label_key) ?? 0) + r.net);

  return {
    configured: isConfigured(),
    sync: state,
    export_starts: first[0]?.day ?? null,
    today,
    invoice_month: month,
    previous_invoice_month: previous,
    has_previous_month: totals.has(previous),
    days,
    average_complete_day: completeAverage(days),
    month_to_date: { gross: current?.gross ?? 0, net: netMtd },
    budget: Number.isFinite(budget) && budget > 0 ? { amount: budget, used_share: netMtd / budget } : null,
    projects: projectRows,
    labels: labelRows,
    unlabelled_by_key: [...labelled].map(([label_key, net]) => ({ label_key, net: netMtd - net })),
  };
}

export async function projectDetail(projectId: string, now = new Date()) {
  const today = pacificDay(now);
  const month = today.slice(0, 7).replace('-', '');
  const [skus, daily] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(
      `SELECT service, sku, SUM(gross)::float8 AS gross, ${NET} AS net FROM gcp_billing_daily
        WHERE project_id = $1 AND invoice_month = $2 GROUP BY service, sku ORDER BY net DESC`, projectId, month),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT day::text AS day, SUM(gross)::float8 AS gross, ${NET} AS net FROM gcp_billing_daily
        WHERE project_id = $1 AND invoice_month = $2 GROUP BY day ORDER BY day DESC`, projectId, month),
  ]);
  return { project_id: projectId, invoice_month: month, skus, days: markDays(daily, today, null) };
}
