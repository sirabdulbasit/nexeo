/**
 * DEF-362 — the pure rules behind the Stage 1b screens, kept out of the JSX so they can
 * be pinned by tests (server/tests/def362IntegrationClient.test.ts) without a browser.
 *
 *  - The API connection form ⇄ ApiConfig (server types.ts). The form is strings; the
 *    config is what the server stores. `configFromForm` is the ONE conversion, and
 *    "is the form dirty?" compares two configs built by it, so a saved config that the
 *    server canonicalised (nulls, defaults) does not look edited.
 *  - The draft from the AI's reading of the document only PRE-FILLS the form; a saved
 *    config always wins over the draft (the admin's edits are never overwritten by a
 *    re-read) — except a saved example address, which a real one from the reading replaces.
 *  - The secret is never in the form or the config (it has its own write-only call).
 *  - Review groups rows by target (KPI · Context · Filter · Not used); a filter row on
 *    its own is not something a run can do, so it does not unlock Continue / the test.
 */

export const AUTH_SCHEMES = ['NONE', 'BEARER', 'API_KEY', 'BASIC'];
export const API_METHODS = ['GET', 'POST'];
export const PAGINATION_KINDS = ['none', 'page', 'offset', 'next_url'];

const str = (v) => (v === undefined || v === null ? '' : String(v));

function queryToText(q) {
  if (!q || typeof q !== 'object') return '';
  return Object.entries(q).map(([k, v]) => `${k}=${v}`).join('\n');
}

/** ApiConfig (or the AI's Partial<ApiConfig> draft) → form strings. */
export function formFromConfig(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const p = c.pagination && typeof c.pagination === 'object' ? c.pagination : { kind: 'none' };
  return {
    baseUrl: str(c.baseUrl),
    method: API_METHODS.includes(c.method) ? c.method : 'GET',
    path: str(c.path),
    query: queryToText(c.query),
    body: c.body && typeof c.body === 'object' ? JSON.stringify(c.body, null, 2) : '',
    authScheme: AUTH_SCHEMES.includes(c.authScheme) ? c.authScheme : 'NONE',
    authHeaderName: str(c.authHeaderName),
    authQueryParam: str(c.authQueryParam),
    recordsPath: str(c.recordsPath),
    idField: str(c.idField),
    declaredTotalPath: str(c.declaredTotalPath),
    pageKind: PAGINATION_KINDS.includes(p.kind) ? p.kind : 'none',
    pageParam: str(p.pageParam),
    pageSizeParam: str(p.pageSizeParam),
    offsetParam: str(p.offsetParam),
    limitParam: str(p.limitParam),
    nextUrlPath: str(p.nextUrlPath),
    pageSize: str(p.pageSize),
    startPage: str(p.startPage),
    maxPages: str(p.maxPages),
    mcpTool: str(c.mcpTool),
  };
}

/** The form the Connect step opens with: the SAVED config when there is one, else the
 *  AI's draft, else blank. A re-read of the document never overwrites saved edits. */
/** Same rule as the server's placeholderHost (sources/apiReader.ts): a documentation
 *  example host, which can never be a real system. */
export function isPlaceholderAddress(baseUrl) {
  let host;
  try { host = new URL(String(baseUrl ?? '')).hostname.toLowerCase(); } catch { return false; }
  return /(?:^|\.)example\.(?:com|org|net)$/.test(host)
    || /(?:^|\.)(?:your[-_]?[a-z0-9]*|my[-_]?(?:domain|company|server|host|api|site)|domain|company|sample|placeholder)\.(?:com|org|net|io|co|app|local)$/.test(host);
}

export function initialForm(integ) {
  const draft = integ?.apiDocReading?.draft ?? null;
  if (integ?.apiConfig) {
    const form = formFromConfig(integ.apiConfig);
    // DEF-438: a saved EXAMPLE address is not an admin's edit — it can never work. A
    // reading that found the real address replaces it (the form is then dirty, so Test
    // saves it); every other saved value still wins over the draft.
    if (isPlaceholderAddress(form.baseUrl) && draft?.baseUrl && !isPlaceholderAddress(draft.baseUrl)) {
      form.baseUrl = String(draft.baseUrl);
    }
    return form;
  }
  return formFromConfig(draft);
}

function posInt(raw, label, errors, { min = 1 } = {}) {
  const t = String(raw ?? '').trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isInteger(n) || n < min) {
    errors.push(`${label} must be a whole number${min > 0 ? ` of at least ${min}` : ''}.`);
    return undefined;
  }
  return n;
}

/**
 * Form → `{config, errors}`. `config` is null when `errors` is non-empty. The server
 * validates again; these checks only stop the admin sending something that cannot work
 * (vm: a draft is a question until the admin answers it).
 */
export function configFromForm(f, kind = 'api') {
  if (kind === 'mcp') return mcpConfigFromForm(f);
  const errors = [];
  const baseUrl = String(f.baseUrl ?? '').trim();
  if (!baseUrl) errors.push('The base URL is missing.');
  else if (!/^https:\/\/[^\s/]+/i.test(baseUrl)) errors.push('The base URL must start with https:// (plain http is refused).');

  const query = {};
  for (const line of String(f.query ?? '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf('=');
    if (i <= 0) { errors.push(`Fixed query line “${t}” must look like name=value.`); continue; }
    query[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }

  const method = API_METHODS.includes(f.method) ? f.method : 'GET';
  let body = null;
  if (method === 'POST' && String(f.body ?? '').trim()) {
    try {
      const parsed = JSON.parse(f.body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) errors.push('The request body must be a JSON object.');
      else body = parsed;
    } catch {
      errors.push('The request body is not valid JSON.');
    }
  }

  const authScheme = AUTH_SCHEMES.includes(f.authScheme) ? f.authScheme : 'NONE';
  const authHeaderName = authScheme === 'API_KEY' ? (String(f.authHeaderName ?? '').trim() || null) : null;
  const authQueryParam = authScheme === 'API_KEY' ? (String(f.authQueryParam ?? '').trim() || null) : null;

  const maxPages = posInt(f.maxPages, 'Max pages', errors);
  let pagination;
  switch (f.pageKind) {
    case 'page': {
      const pageParam = String(f.pageParam ?? '').trim();
      if (!pageParam) errors.push('Name the page-number parameter.');
      const pageSize = posInt(f.pageSize, 'Page size', errors);
      const startPage = posInt(f.startPage, 'First page', errors, { min: 0 });
      pagination = { kind: 'page', pageParam };
      const sp = String(f.pageSizeParam ?? '').trim();
      if (sp) pagination.pageSizeParam = sp;
      if (pageSize !== undefined) pagination.pageSize = pageSize;
      if (startPage !== undefined) pagination.startPage = startPage;
      break;
    }
    case 'offset': {
      const offsetParam = String(f.offsetParam ?? '').trim();
      if (!offsetParam) errors.push('Name the offset parameter.');
      const pageSize = posInt(f.pageSize, 'Page size', errors);
      if (pageSize === undefined && !errors.some((e) => e.startsWith('Page size'))) errors.push('Offset pages need a page size.');
      pagination = { kind: 'offset', offsetParam, pageSize: pageSize ?? 0 };
      const lp = String(f.limitParam ?? '').trim();
      if (lp) pagination.limitParam = lp;
      break;
    }
    case 'next_url': {
      const nextUrlPath = String(f.nextUrlPath ?? '').trim();
      if (!nextUrlPath) errors.push('Say where the next-page link is in the answer.');
      pagination = { kind: 'next_url', nextUrlPath };
      break;
    }
    default:
      pagination = { kind: 'none' };
  }
  if (pagination.kind !== 'none' && maxPages !== undefined) pagination.maxPages = maxPages;

  const config = {
    baseUrl,
    method,
    path: String(f.path ?? '').trim(),
    query,
    body,
    authScheme,
    authHeaderName,
    authQueryParam,
    recordsPath: String(f.recordsPath ?? '').trim(),
    idField: String(f.idField ?? '').trim() || null,
    pagination,
    declaredTotalPath: String(f.declaredTotalPath ?? '').trim() || null,
  };
  return { config: errors.length ? null : config, errors };
}

/**
 * DEF-447 — the MCP connection form → `{config, errors}`, in the API connection's shape
 * (the server keeps both in api_config): the server address, sign-in, the tool and its
 * arguments (`body`), where the records are and how one is identified. One call, no
 * paging. The tool may still be empty — the address and token are saved first so the
 * server's tools can be listed — but the test needs it (canTestMcp).
 */
export function mcpConfigFromForm(f) {
  const errors = [];
  const baseUrl = String(f.baseUrl ?? '').trim();
  if (!baseUrl) errors.push('The MCP server address is missing.');
  else if (!/^https:\/\/[^\s/]+/i.test(baseUrl)) errors.push('The MCP server address must start with https:// (plain http is refused).');
  let body = null;
  if (String(f.body ?? '').trim()) {
    try {
      const parsed = JSON.parse(f.body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) errors.push('The tool settings must be a JSON object, e.g. {"status": "active"}.');
      else body = parsed;
    } catch {
      errors.push('The tool settings are not valid JSON.');
    }
  }
  const mcpTool = String(f.mcpTool ?? '').trim();
  if (mcpTool && !/^[A-Za-z0-9_.\/-]{1,128}$/.test(mcpTool)) errors.push('That is not a valid tool name.');
  const authScheme = AUTH_SCHEMES.includes(f.authScheme) ? f.authScheme : 'NONE';
  const config = {
    baseUrl,
    method: 'POST',
    path: '',
    query: {},
    body,
    authScheme,
    authHeaderName: authScheme === 'API_KEY' ? (String(f.authHeaderName ?? '').trim() || null) : null,
    authQueryParam: null,
    recordsPath: String(f.recordsPath ?? '').trim(),
    idField: String(f.idField ?? '').trim() || null,
    pagination: { kind: 'none' },
    declaredTotalPath: String(f.declaredTotalPath ?? '').trim() || null,
    mcpTool: mcpTool || null,
  };
  return { config: errors.length ? null : config, errors };
}

/**
 * DEF-447 — a tool's starting settings from its input schema: every property that has a
 * default, as JSON text ("{}" when none). The admin edits it; nothing is guessed.
 */
export function mcpArgsFromSchema(schema) {
  const props = schema && typeof schema === 'object' && schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const out = {};
  for (const [k, v] of Object.entries(props)) if (v && typeof v === 'object' && 'default' in v) out[k] = v.default;
  return JSON.stringify(out, null, 2);
}

/** DEF-447 — a tool's settings, as rows for the admin: name, type, required, what it is. */
export function mcpSchemaRows(schema) {
  const props = schema && typeof schema === 'object' && schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const req = new Set(Array.isArray(schema?.required) ? schema.required : []);
  return Object.entries(props).map(([name, v]) => ({
    name,
    type: v && typeof v === 'object' ? (Array.isArray(v.enum) ? v.enum.map(String).join(' | ') : String(v.type ?? '')) : '',
    required: req.has(name),
    description: v && typeof v === 'object' && typeof v.description === 'string' ? v.description : '',
  }));
}

/** Stable JSON (sorted keys) — so key order never makes a config look edited. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** True when the form differs from the saved config (or nothing is saved yet). Both
 *  sides go through configFromForm, so only a real edit counts. An invalid form is
 *  dirty: it cannot be what was tested. */
export function isConfigDirty(form, savedConfig, kind = 'api') {
  if (!savedConfig) return true;
  const a = configFromForm(form, kind);
  if (!a.config) return true;
  const b = configFromForm(formFromConfig(savedConfig), kind);
  return stable(a.config) !== stable(b.config);
}

/** Does the scheme carry a secret at all? NONE never asks for one. */
export function needsSecret(authScheme) {
  return authScheme && authScheme !== 'NONE';
}

/** "N records on this page (declared total M)" — spec §2b Connect. */
export function pageCountText(result) {
  if (!result) return '';
  const n = Number(result.pageRecords ?? result.rows ?? 0);
  const total = result.declaredTotal;
  const base = `${n} ${n === 1 ? 'record' : 'records'} on this page`;
  return total === null || total === undefined ? base : `${base} (declared total ${total})`;
}

// ── Review ─────────────────────────────────────────────────────────────────

export const REVIEW_GROUPS = ['kpi', 'context', 'filter', 'not_used'];

/** Rows by target. A REJECTED row of any kind is "Not used" — the admin (or the AI)
 *  decided it does not go anywhere — and keeps its reason. */
export function groupSuggestions(suggestions) {
  const g = { kpi: [], context: [], filter: [], not_used: [] };
  for (const sg of suggestions || []) {
    if (sg.status === 'REJECTED') { g.not_used.push(sg); continue; }
    const kind = sg.targetKind || 'kpi';
    (g[kind] || g.kpi).push(sg);
  }
  return g;
}

/** Fields the proposer reported as not used (spec §2b "Not used, with the reason").
 *  Read from the version spec when the proposer stores them there; tolerant of
 *  either key, and of plain strings. */
export function notUsedFromSpec(spec) {
  const raw = Array.isArray(spec?.notUsed) ? spec.notUsed : Array.isArray(spec?.unused) ? spec.unused : [];
  return raw.map((x) => (typeof x === 'string'
    ? { field: x, reason: '', followed: null }
    : { field: String(x?.field ?? ''), reason: String(x?.reason ?? ''), followed: x?.followed ? String(x.followed) : null }))
    .filter((x) => x.field);
}

/** Approved rows a run can act on. The filter only narrows what KPI / Context rows
 *  read; approved on its own the run has nothing to do (runEngine fails it), so it
 *  does not count towards Continue or the test. */
export function runnableApprovedCount(suggestions) {
  return (suggestions || []).filter((x) => x.status === 'APPROVED' && x.targetKind !== 'filter').length;
}

/** Review's notice list without the "Not used: …" lines when the spec carries
 *  spec.notUsed — the proposer writes each such field to BOTH, and Review already
 *  shows notUsed in its own "Not used" group (DEF-362 review: every reason was
 *  listed twice). An older spec without notUsed keeps its notices as they are. */
export function reviewNotices(spec) {
  const notices = Array.isArray(spec?.notices) ? spec.notices : [];
  if (notUsedFromSpec(spec).length === 0) return notices;
  return notices.filter((n) => !/^Not used: /.test(String(n)));
}

// ── DEF-443: the test's KPI changes, in words and as one table per KPI ─────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2015-02-01" → "Feb 2015"; anything else is shown as it is. */
export function periodWords(period) {
  const m = /^(\d{4})-(\d{2})-01$/.exec(String(period ?? ''));
  return m && +m[2] >= 1 && +m[2] <= 12 ? `${MONTHS[+m[2] - 1]} ${m[1]}` : String(period ?? '');
}

/**
 * Owner 11-12 on Test & turn on: "unable to understand Test Run data" — 192 flat rows, each
 * repeating the KPI, period, breakdown and recipe. The same changes regrouped: one entry
 * per KPI with its periods (newest first) × breakdown values, counts of new and updated
 * figures, and the range. Knowledge-page changes are not readings and are left out.
 * A change's subjectKey is "kpiKey|period|dim" (dim "field=value" or ""), its
 * subjectLabel "KPI label · period · dim", its sourceKey "recipe › how it is worked out".
 */
export function summariseReadings(changes) {
  const byKpi = new Map();
  for (const c of Array.isArray(changes) ? changes : []) {
    if (c?.targetKind === 'context' || String(c?.targetKey ?? '').startsWith('context:') || String(c?.subjectKey ?? '').startsWith('context:')) continue;
    const [kpi, period, dim = ''] = String(c?.subjectKey ?? '').split('|');
    if (!kpi || !period) continue;
    let k = byKpi.get(kpi);
    if (!k) {
      const label = String(c.subjectLabel ?? '').split(' · ')[0] || kpi;
      const how = String(c.sourceKey ?? '').replace(/^recipe\s*›\s*/i, '');
      k = { key: kpi, label, how, dimName: '', dims: [], periods: [], cells: new Map(), added: 0, updated: 0 };
      byKpi.set(kpi, k);
    }
    const eq = dim.indexOf('=');
    const dimValue = dim ? (eq >= 0 ? dim.slice(eq + 1) : dim) : '';
    if (dim && eq >= 0 && !k.dimName) k.dimName = dim.slice(0, eq);
    if (!k.dims.includes(dimValue)) k.dims.push(dimValue);
    if (!k.periods.includes(period)) k.periods.push(period);
    const isNew = c.beforeValue === null || c.beforeValue === undefined || c.beforeValue === '';
    if (isNew) k.added++; else k.updated++;
    k.cells.set(`${period}|${dimValue}`, { after: c.afterValue, before: isNew ? null : c.beforeValue });
  }
  return [...byKpi.values()].map((k) => {
    const periods = [...k.periods].sort().reverse();
    const dims = [...k.dims].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    return { ...k, periods, dims, first: periods[periods.length - 1], last: periods[0], total: k.added + k.updated };
  });
}
