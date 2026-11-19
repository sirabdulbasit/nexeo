/**
 * Systems, KPIs and business units in the Wiki (docs/Wiki-Knowledge.md §0.13 part 11).
 *
 * What an integration brings in is the company's, so these notes are shared
 * (tenant) notes, readable by every user of the client:
 *  - a `system` note per integration: what it is, whether it runs, what it gives;
 *  - a `kpi` note per KPI it measures: unit, period, direction, the latest
 *    figures and the trend, by business unit;
 *  - a `business_unit` note per business unit the figures name.
 * Each KPI's readings are landed as one company `record` source, which the KPI
 * and business-unit notes cite. Records an integration maps as Context stay
 * the integration's own pages (contextWriter), already taken in as notes.
 * Facts only: no model.
 */
import prisma from '../../db/prisma';
import { saveSource } from './wikiSources';
import { cleanTitle, titleKey, wikiLink } from './wikiLinks';
import { WIKI_GENERATION } from './wikiStore';
import { syncNotes, type BuiltNote, type SyncResult } from './wikiSync';

export const SYSTEMS_ACTOR = 'wiki_systems';
const TREND_PERIODS = 12;

export interface IntegrationRow { id: string; name: string; purpose: string | null; source_kind: string | null; status: string; frequency: string | null; last_run_at: Date | null; last_run_status: string | null }
export interface KpiRow { id: string; kpi_key: string; name: string; unit: string | null; direction: string | null; period: string | null; integration_id: string | null; active: boolean }
export interface ReadingRow { kpi_key: string; period_start: Date | string; dimension_key: string; value: number | string; integration_id: string; written_at: Date }

const ymd = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const num = (v: number | string) => Number(v);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** `businessUnit=TMC Private Limited` → { businessUnit: 'TMC Private Limited' }. */
export function dimensions(key: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(key ?? '').split(/[;&|]/)) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
const unitOf = (dimKey: string) => dimensions(dimKey).businessUnit ?? dimensions(dimKey).business_unit ?? dimensions(dimKey).unit ?? null;

/** The readings of one KPI as the text of its source: one line per period and dimension. */
export function readingsText(kpi: KpiRow, readings: ReadingRow[]): string {
  return [`${kpi.name} (${kpi.kpi_key})`, 'period,dimension,value',
    ...[...readings].sort((a, b) => ymd(a.period_start).localeCompare(ymd(b.period_start)) || a.dimension_key.localeCompare(b.dimension_key))
      .map((r) => `${ymd(r.period_start)},${r.dimension_key || 'all'},${fmt(num(r.value))}`)].join('\n');
}

/** Integrations, KPIs and readings in, notes out. Pure. `sourceOf` gives each KPI's source id. */
export function buildSystemNotes(
  integrations: IntegrationRow[], kpis: KpiRow[], readings: ReadingRow[],
  ctx: { sourceOf: (kpiKey: string) => string | null; taken: Set<string> },
): BuiltNote[] {
  const notes: BuiltNote[] = [];
  const name = (t: string, kind: string) => (ctx.taken.has(titleKey(t)) ? cleanTitle(`${t} (${kind})`) : cleanTitle(t));
  const sysTitle = new Map(integrations.map((i) => [i.id, name(i.name, 'system')]));
  const kpiTitle = new Map(kpis.map((k) => [k.kpi_key, name(k.name, 'KPI')]));
  const byKpi = new Map<string, ReadingRow[]>();
  for (const r of readings) byKpi.set(r.kpi_key, [...(byKpi.get(r.kpi_key) ?? []), r]);
  // Business units: every one a reading names, with what each KPI says of it.
  const units = new Map<string, { title: string; kpis: Map<string, { latest: string; value: number; total12: number }>; sources: Set<string> }>();

  for (const k of kpis) {
    const rows = byKpi.get(k.kpi_key) ?? [];
    const periods = [...new Set(rows.map((r) => ymd(r.period_start)))].sort();
    const recent = periods.slice(-TREND_PERIODS);
    const latest = periods[periods.length - 1] ?? null;
    const total = (p: string) => rows.filter((r) => ymd(r.period_start) === p).reduce((s, r) => s + num(r.value), 0);
    const src = ctx.sourceOf(k.kpi_key);
    const perUnit = new Map<string, { latest: number; total12: number; all: number }>();
    for (const r of rows) {
      const u = unitOf(r.dimension_key);
      if (!u) continue;
      const e = perUnit.get(u) ?? { latest: 0, total12: 0, all: 0 };
      if (ymd(r.period_start) === latest) e.latest += num(r.value);
      if (recent.includes(ymd(r.period_start))) e.total12 += num(r.value);
      e.all += num(r.value);
      perUnit.set(u, e);
    }
    for (const [u, e] of perUnit) {
      const key = titleKey(u);
      const d = units.get(key) ?? { title: name(u, 'business unit'), kpis: new Map(), sources: new Set<string>() };
      d.kpis.set(k.kpi_key, { latest: latest ?? '', value: e.latest, total12: e.total12 });
      if (src) d.sources.add(src);
      units.set(key, d);
    }
    const sys = k.integration_id ? sysTitle.get(k.integration_id) : undefined;
    const unitRows = [...perUnit.entries()].sort((a, b) => b[1].total12 - a[1].total12 || a[0].localeCompare(b[0]));
    notes.push({
      type: 'kpi', title: kpiTitle.get(k.kpi_key)!,
      body: [
        `**Measured in:** ${k.unit ?? 'units'}, per ${k.period ?? 'period'}${k.direction ? `; ${k.direction === 'down' ? 'lower' : 'higher'} is better` : ''}`,
        ...(sys ? [`**From:** ${wikiLink(sys)}`] : []),
        `**State:** ${k.active ? 'measured' : 'not measured any more'}`,
        ...(latest ? [`**Latest:** ${latest}: ${fmt(total(latest))}`] : ['**Latest:** no readings yet']),
        ...(recent.length ? ['', `## Last ${recent.length} periods`, ...[...recent].reverse().map((p) => `- ${p}: ${fmt(total(p))}`)] : []),
        ...(unitRows.length ? ['', '## By business unit', '| Business unit | Latest | Last 12 periods | All time |', '|---|---|---|---|',
          ...unitRows.map(([u, e]) => `| ${wikiLink(units.get(titleKey(u))!.title)} | ${fmt(e.latest)} | ${fmt(e.total12)} | ${fmt(e.all)} |`)] : []),
      ].join('\n'),
      properties: { key: k.kpi_key, unit: k.unit, period: k.period, direction: k.direction, active: k.active, latestPeriod: latest, latestValue: latest ? total(latest) : null, readings: rows.length, businessUnits: perUnit.size },
      ids: [`kpi:${k.kpi_key}`],
      sourceIds: src ? [src] : [],
    });
  }

  for (const i of integrations) {
    const own = kpis.filter((k) => k.integration_id === i.id);
    notes.push({
      type: 'system', title: sysTitle.get(i.id)!,
      body: [
        ...(i.purpose ? [String(i.purpose).replace(/\[\[|\]\]/g, '').slice(0, 600), ''] : []),
        `**Kind:** connected system${i.source_kind ? ` (${i.source_kind})` : ''}`,
        `**State:** ${({ ACTIVE: 'running', PAUSED: 'paused', DRAFT: 'being set up', DISABLED: 'turned off' } as Record<string, string>)[i.status] ?? i.status.toLowerCase()}`,
        ...(i.frequency ? [`**Runs:** ${i.frequency.toLowerCase()}`] : []),
        ...(i.last_run_at ? [`**Last run:** ${ymd(i.last_run_at)}${i.last_run_status ? ` (${i.last_run_status.toLowerCase()})` : ''}`] : []),
        ...(own.length ? ['', '## KPIs', ...own.map((k) => `- ${wikiLink(kpiTitle.get(k.kpi_key)!)}`)] : []),
      ].join('\n'),
      properties: { integration: i.id, status: i.status, kind: i.source_kind, kpis: own.length, lastRun: i.last_run_at ? ymd(i.last_run_at) : null },
      ids: [`integration:${i.id}`],
      sourceIds: own.map((k) => ctx.sourceOf(k.kpi_key)).filter((x): x is string => !!x),
    });
  }

  for (const [key, u] of units) {
    const lines = [...u.kpis.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    notes.push({
      type: 'business_unit', title: u.title,
      body: ['A business unit named in the company\'s figures.', '', '## Figures',
        ...lines.map(([k, e]) => `- ${wikiLink(kpiTitle.get(k)!)}: ${fmt(e.value)} in ${e.latest}; ${fmt(e.total12)} over the last 12 periods`)].join('\n'),
      properties: { kpis: lines.length },
      ids: [`business_unit:${key}`],
      sourceIds: [...u.sources].sort(),
    });
  }
  const order: Record<string, number> = { system: 0, kpi: 1, business_unit: 2 };
  return notes.sort((a, b) => order[a.type] - order[b.type] || a.title.localeCompare(b.title));
}

/** The user who writes a client's shared notes: its first active user (as the rule notes). */
export async function sharedWriter(clientNumber: string): Promise<number | null> {
  // Never a Client Owned Data user: his company knowledge is in his vault, and the door would refuse him.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `SELECT id FROM users WHERE client_number = $1 AND is_active = true AND knowledge_model = 'nexeo' ORDER BY id LIMIT 1`, clientNumber,
  ).catch(() => []);
  return rows[0]?.id != null ? Number(rows[0].id) : null;
}

/** Write a client's system, KPI and business-unit notes from its integrations. */
export async function rebuildSystemsForClient(clientNumber: string): Promise<SyncResult & { kpis: number; readings: number }> {
  const writer = await sharedWriter(clientNumber);
  if (!writer) return { notes: 0, written: 0, unchanged: 0, retired: 0, kpis: 0, readings: 0 };
  const integrations = await prisma.$queryRawUnsafe<IntegrationRow[]>(
    `SELECT id, name, purpose, source_kind, status, frequency, last_run_at, last_run_status FROM integration_syncs WHERE client_number = $1 ORDER BY name`, clientNumber,
  );
  const kpis = await prisma.$queryRawUnsafe<KpiRow[]>(
    `SELECT id, kpi_key, label AS name, unit, direction, grain AS period, source_integration_id AS integration_id, is_active AS active
       FROM kpi_definitions WHERE client_number = $1 ORDER BY kpi_key`, clientNumber,
  );
  const readings = await prisma.$queryRawUnsafe<ReadingRow[]>(
    `SELECT kpi_key, period_start, dimension_key, value, integration_id, written_at FROM kpi_readings WHERE client_number = $1`, clientNumber,
  );
  const sources = new Map<string, string>();
  for (const k of kpis) {
    const rows = readings.filter((r) => r.kpi_key === k.kpi_key);
    if (rows.length === 0) continue;
    const asOf = new Date(Math.max(...rows.map((r) => new Date(r.written_at).getTime())));
    const s = await saveSource({
      clientNumber, userId: writer, kind: 'record', scope: 'tenant', externalId: `kpi:${k.kpi_key}`,
      title: `${k.name}: readings`, occurredAt: asOf, body: readingsText(k, rows), asOf,
      details: { kpiKey: k.kpi_key, integrationId: k.integration_id, readings: rows.length },
    });
    sources.set(k.kpi_key, s.id);
  }
  // A title another shared or writer's note already has gets its kind added, so links stay single.
  const taken = new Set((await prisma.wikiPage.findMany({
    where: { clientNumber, status: 'active', OR: [{ scope: 'tenant' }, { userId: writer }], metadata: { path: ['wiki'], equals: WIKI_GENERATION }, NOT: { lastUpdatedBy: SYSTEMS_ACTOR } },
    select: { title: true },
  }) as any[]).map((p) => titleKey(p.title)));
  const notes = buildSystemNotes(integrations, kpis, readings, { sourceOf: (k) => sources.get(k) ?? null, taken });
  const r = await syncNotes({ clientNumber, userId: writer }, SYSTEMS_ACTOR, notes, { tenant: true });
  return { ...r, kpis: kpis.length, readings: readings.length };
}
