/**
 * DEF-444 — the records a TEST run read, so the admin sees them with the source's own
 * fields as columns and, for any figure, exactly the records it was computed from
 * (owner 11-12: "seeing records as per fields in column give me exact picture and
 * confident about what is going to be integrated").
 *
 * Kept in server memory only (like the document-reading jobs): one entry per test run,
 * for an hour, at most MAX_ENTRIES runs. Nothing new is stored in the database; a
 * restart or the hour passing means "run the test again". Tenant + integration are
 * checked on every read. Live runs keep nothing here.
 */
export interface PreviewEntry {
  cn: string;
  integrationId: string;
  at: number;
  headers: string[];
  /** The records after the filter — the ones the plan was made from. */
  records: Array<Record<string, string>>;
  /** Fields the approved mapping and filter read (shown first, highlighted). */
  usedFields: string[];
  /** Reading key → positions in `records`. */
  sourceRows: Map<string, number[]>;
}

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 20;
const store = new Map<string, PreviewEntry>();

function sweep(now = Date.now()): void {
  for (const [k, v] of store) if (now - v.at > TTL_MS) store.delete(k);
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
}

export function keepPreview(runId: string, entry: Omit<PreviewEntry, 'at'>): void {
  sweep();
  store.set(runId, { ...entry, at: Date.now() });
  sweep();
}

export function getPreview(cn: string, integrationId: string, runId: string): PreviewEntry | null {
  sweep();
  const e = store.get(runId);
  return e && e.cn === cn && e.integrationId === integrationId ? e : null;
}

export interface PreviewPage {
  available: boolean;
  headers: string[];
  usedFields: string[];
  total: number;
  offset: number;
  rows: Array<Record<string, string>>;
}

export const PREVIEW_PAGE_MAX = 200;

/**
 * One page of the kept records: all of them, or only those behind `reading` (a reading
 * key "kpi|period|dim"), optionally narrowed by `q` (case-insensitive, any field).
 * Columns: the used fields first, then the rest in the source's order.
 */
export function previewPage(e: PreviewEntry | null, opts: { reading?: string | null; q?: string | null; offset?: number; limit?: number }): PreviewPage {
  if (!e) return { available: false, headers: [], usedFields: [], total: 0, offset: 0, rows: [] };
  const used = e.usedFields.filter((f) => e.headers.includes(f));
  const headers = [...used, ...e.headers.filter((h) => !used.includes(h))];
  let positions: number[] = opts.reading ? [...(e.sourceRows.get(opts.reading) ?? [])] : e.records.map((_, i) => i);
  const q = (opts.q ?? '').trim().toLowerCase();
  if (q) positions = positions.filter((i) => Object.values(e.records[i] ?? {}).some((v) => String(v ?? '').toLowerCase().includes(q)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const limit = Math.min(PREVIEW_PAGE_MAX, Math.max(1, Math.floor(opts.limit ?? 50)));
  return {
    available: true,
    headers,
    usedFields: used,
    total: positions.length,
    offset,
    rows: positions.slice(offset, offset + limit).map((i) => e.records[i]!),
  };
}

/** Test seam. */
export function _clearPreviews(): void { store.clear(); }
