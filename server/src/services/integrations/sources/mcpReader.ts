/**
 * DEF-447 — Integrations: read an outside system's MCP server as records
 * (inbound MCP; owner 2026-11-12, CL-085. Outbound — Nexeo's own /api/v1/mcp —
 * is held and untouched).
 *
 * What it speaks: the MCP "Streamable HTTP" transport — JSON-RPC 2.0 POSTed to
 * ONE https endpoint, answered either as JSON or as a short event stream:
 *
 *   initialize → notifications/initialized → tools/list | tools/call
 *
 * The session id the server hands out (Mcp-Session-Id) and the negotiated
 * protocol version ride on every later request. The older two-endpoint SSE
 * transport and local (stdio) servers are not supported, and the admin is told
 * so in words rather than with a parser error.
 *
 * Why each rule:
 *  - EVERY request goes through integrationFetch.guardedFetch, exactly like the
 *    API reader: https only, vetted and pinned address, same-origin redirects,
 *    one deadline, a byte cap. The token is attached by guardedFetch only to
 *    the configured origin, and scrubbed from any text the server sends back.
 *  - The connection is the API connection's shape (api_config): baseUrl is the
 *    MCP endpoint, `mcpTool` the tool, `body` its arguments, `recordsPath` where
 *    the list sits in the tool's answer, `idField` how a record is identified.
 *    So the store's validation, the encrypted secret, the fingerprint and the
 *    rest of the wizard work unchanged.
 *  - A tool answers with `structuredContent` (preferred) or with text content;
 *    text is accepted only when it IS JSON. Prose is not data: the admin is
 *    told which tool answered in words, never given a guessed table.
 *  - One tool call per read. Records over integrations.max_rows are cut and the
 *    read is TRUNCATED (the run is PARTIAL), and a declared total that is not
 *    reached is reported the same way as for an API.
 *
 * Deterministic and model-free: it runs on the execution path.
 */
import createLogger from '../../../utils/logger';
import { getBehaviorValue } from '../../behaviorConfig';
import { getSecret } from '../store/secretStore';
import { buildAuth, fetchLimits, guardedFetch } from './integrationFetch';
import {
  ApiReadError, arrayPaths, declaredNumber, flattenRecord, lookupPath, measureIdentity, placeholderHost, scrubSecret,
} from './apiReader';
import {
  CredentialUnreadableError,
  FetchGuardError,
  IntegrationInputError,
  type ApiConfig,
  type FetchLimits,
  type ReadResult,
  type TestResult,
} from '../types';

const log = createLogger('integrations-mcp');

/** The newest protocol revision we speak; the server may answer with an older one. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';
/** tools/list pages followed at most (a server listing hundreds of tools is paged). */
const MAX_TOOL_PAGES = 5;
/** Tools shown to the admin at most. */
export const MAX_TOOLS = 200;

export interface McpTool {
  name: string;
  title: string | null;
  description: string;
  /** The tool's JSON Schema for its arguments, as the server sent it (may be {}). */
  inputSchema: Record<string, unknown>;
}

export interface McpRef {
  id: string;
  apiConfig: ApiConfig;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const where = (cfg: ApiConfig): string => { try { const u = new URL(cfg.baseUrl); return `${u.host}${u.pathname}`; } catch { return 'the MCP server'; } };

// ── Wire: one JSON-RPC exchange ───────────────────────────────────────────

/** The JSON-RPC messages in an answer: a JSON body (one message or a batch),
 *  or an event stream whose `data:` lines carry them. Exported for tests. */
export function parseMcpBody(body: string, contentType: string): unknown[] {
  const text = body.trim();
  if (!text) return [];
  if (/text\/event-stream/i.test(contentType) || /^(event|data|id|retry):/m.test(text.slice(0, 200))) {
    const out: unknown[] = [];
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (!data) continue;
      try {
        const msg = JSON.parse(data);
        if (Array.isArray(msg)) out.push(...msg); else out.push(msg);
      } catch { /* a keep-alive or a non-JSON event is not a message */ }
    }
    return out;
  }
  const msg = JSON.parse(text);
  return Array.isArray(msg) ? msg : [msg];
}

function httpMessage(status: number, at: string, initialize: boolean): string {
  if (status === 401 || status === 403) return `The MCP server at ${at} refused the request (${status}) — the token is missing, wrong or lacks permission.`;
  if (initialize && (status === 404 || status === 405)) {
    return `The address ${at} answered ${status} — it is not an MCP endpoint that accepts requests (Streamable HTTP). Check the address (it often ends in /mcp). `
      + 'Servers that run only on a computer (stdio) or use the older SSE-only transport cannot be connected.';
  }
  if (status === 429) return `The MCP server at ${at} answered 429 — too many requests. Try again later.`;
  if (status >= 500) return `The MCP server at ${at} had an internal error (${status}). Try again later.`;
  return `The MCP server at ${at} answered ${status}.`;
}

class McpSession {
  private sessionId: string | null = null;
  private version: string | null = null;
  private nextId = 1;
  private readonly origin: string;

  constructor(private readonly cfg: ApiConfig, private readonly secret: string | null, private readonly limits: FetchLimits) {
    this.origin = new URL(cfg.baseUrl).origin;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      ...(this.version ? { 'mcp-protocol-version': this.version } : {}),
    };
  }

  private async post(payload: Record<string, unknown>, initialize = false) {
    const res = await guardedFetch(new URL(this.cfg.baseUrl), {
      origin: this.origin,
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
      auth: buildAuth(this.cfg, this.secret),
      maxBytes: this.limits.maxBytes,
      timeoutMs: this.limits.timeoutMs,
    });
    const at = where(this.cfg);
    if (res.status < 200 || res.status >= 300) {
      const snippet = scrubSecret(res.body.toString('utf8', 0, Math.min(res.body.length, 300)), this.secret, this.cfg)
        .replace(/\s+/g, ' ').trim();
      throw new ApiReadError(`${httpMessage(res.status, at, initialize)}${snippet ? ` It said: "${snippet.slice(0, 200)}"` : ''}`, res.status);
    }
    return res;
  }

  /** One request, its matching response's `result`. */
  async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const initialize = method === 'initialize';
    const res = await this.post({ jsonrpc: '2.0', id, method, params }, initialize);
    if (initialize) {
      const sid = res.headers['mcp-session-id'];
      if (sid && /^[\x21-\x7e]{1,200}$/.test(sid)) this.sessionId = sid;
    }
    const at = where(this.cfg);
    let messages: unknown[];
    try {
      messages = parseMcpBody(res.body.toString('utf8'), res.headers['content-type'] ?? '');
    } catch {
      throw new ApiReadError(initialize
        ? `The address ${at} did not answer like an MCP server (its answer is not JSON-RPC). Check the address.`
        : `The MCP server at ${at} sent an answer that could not be read.`, res.status);
    }
    const reply = messages.find((m) => isObj(m) && m.id === id) as Record<string, unknown> | undefined;
    if (!reply) {
      throw new ApiReadError(initialize
        ? `The address ${at} did not answer like an MCP server. Check the address (it often ends in /mcp).`
        : `The MCP server at ${at} did not answer the ${method} request.`, res.status);
    }
    if (isObj(reply.error)) {
      const msg = scrubSecret(String(reply.error.message ?? 'an error'), this.secret, this.cfg).slice(0, 300);
      throw new ApiReadError(`The MCP server at ${at} refused ${method}: ${msg}`);
    }
    return isObj(reply.result) ? reply.result : {};
  }

  async open(): Promise<void> {
    const result = await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'Nexeo Integrations', version: '1.0' },
    });
    this.version = typeof result.protocolVersion === 'string' && /^[\w.-]{1,40}$/.test(result.protocolVersion)
      ? result.protocolVersion : MCP_PROTOCOL_VERSION;
    if (!isObj(result.capabilities) || !('tools' in result.capabilities)) {
      throw new ApiReadError(`The MCP server at ${where(this.cfg)} offers no tools, so there is nothing to read records from.`);
    }
    // A notification has no answer; a server that rejects it would reject the
    // calls too, and says so there.
    try { await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }); } catch (err) {
      if (err instanceof ApiReadError && (err.status === 401 || err.status === 403)) throw err;
    }
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_TOOL_PAGES; page++) {
      const result = await this.request('tools/list', cursor ? { cursor } : {});
      for (const t of Array.isArray(result.tools) ? result.tools : []) {
        if (!isObj(t) || typeof t.name !== 'string' || !t.name.trim()) continue;
        tools.push({
          name: t.name.slice(0, 128),
          title: typeof t.title === 'string' ? t.title.slice(0, 200) : null,
          description: typeof t.description === 'string' ? t.description.slice(0, 1000) : '',
          inputSchema: isObj(t.inputSchema) ? t.inputSchema : {},
        });
        if (tools.length >= MAX_TOOLS) return tools;
      }
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request('tools/call', { name, arguments: args });
  }
}

// ── The tool's answer → data → records ────────────────────────────────────

/**
 * The data a tools/call result carries: structuredContent when present,
 * otherwise its text content parsed as JSON (one text part ⇒ that value;
 * several ⇒ the list of them). Prose is refused with what it said. Exported for tests.
 */
export function toolData(result: Record<string, unknown>, tool: string): unknown {
  const texts = (Array.isArray(result.content) ? result.content : [])
    .filter((c): c is Record<string, unknown> => isObj(c) && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string);
  if (result.isError === true) {
    throw new ApiReadError(`The tool "${tool}" reported an error: ${(texts.join(' ') || 'no details').slice(0, 300)}`);
  }
  if (result.structuredContent !== undefined && result.structuredContent !== null) return result.structuredContent;
  if (texts.length === 0) throw new ApiReadError(`The tool "${tool}" answered with no data.`);
  const parsed: unknown[] = [];
  for (const t of texts) {
    try { parsed.push(JSON.parse(t)); } catch {
      throw new ApiReadError(`The tool "${tool}" answered in plain text, not data ("${t.replace(/\s+/g, ' ').slice(0, 120)}…"). `
        + 'Choose a tool that returns the records as JSON, or check its arguments.');
    }
  }
  return parsed.length === 1 ? parsed[0] : parsed;
}

/** What an answer holds, in a few words ("result (text), count (number)"). */
function describeShape(data: unknown): string {
  const kind = (v: unknown): string => (typeof v === 'string' ? 'text' : Array.isArray(v) ? 'list' : v === null ? 'empty' : typeof v === 'object' ? 'group' : typeof v);
  if (!isObj(data)) return kind(data);
  const keys = Object.keys(data);
  return keys.slice(0, 8).map((k) => `${k} (${kind(data[k])})`).join(', ') + (keys.length > 8 ? ', …' : '') || 'nothing';
}

/** The records list at recordsPath, or an error naming where lists are — or, when
 *  there are none, what the answer does hold (a wrapped prose answer is common). */
function recordsIn(data: unknown, cfg: ApiConfig, tool: string): unknown[] {
  const at = lookupPath(data, cfg.recordsPath);
  if (Array.isArray(at)) return at;
  const found = arrayPaths(data);
  const label = cfg.recordsPath ? `at "${cfg.recordsPath}" ` : '';
  if (found.length) {
    throw new ApiReadError(`No list of records was found ${label}in the answer of the tool "${tool}". `
      + `Lists were found at: ${found.join(', ')} — set "Where the records are" to one of them.`);
  }
  const textOnly = typeof data === 'string' || (isObj(data) && Object.values(data).every((v) => typeof v === 'string'));
  throw new ApiReadError(`The tool "${tool}" answered without any list of records — its answer holds: ${describeShape(data)}. `
    + (textOnly ? 'That is a written answer, not data. Choose a tool that returns the records as a list.' : 'Choose a tool that returns the records as a list, or check its settings.'));
}

// ── Secret, session, public functions ─────────────────────────────────────

async function loadSecret(cn: string, ref: McpRef): Promise<string | null> {
  if (ref.apiConfig.authScheme === 'NONE') return null;
  const secret = await getSecret(cn, ref.id);
  if (!secret) throw new CredentialUnreadableError(`This MCP server uses ${ref.apiConfig.authScheme} sign-in but no token has been entered. Enter it in the Connect step.`);
  return secret;
}

const adminReason = (err: unknown): string => {
  if (err instanceof ApiReadError || err instanceof FetchGuardError || err instanceof CredentialUnreadableError) return err.message;
  return 'The MCP server could not be read (unexpected error). Try again in a few minutes.';
};
const safeHost = (u: string): string => { try { return new URL(u).host; } catch { return '?'; } };
const placeholderReason = (host: string): string => `The address is still an example (${host}). Enter the MCP server's real address.`;
const fail = (reason: string): TestResult => ({ ok: false, rows: 0, columns: [], sampleRow: null, reason });

async function openSession(cn: string, cfg: ApiConfig, secret: string | null): Promise<McpSession> {
  const ph = placeholderHost(cfg.baseUrl);
  if (ph) throw new ApiReadError(placeholderReason(ph));
  if (cfg.authScheme !== 'NONE' && !secret) throw new ApiReadError(`This MCP server uses ${cfg.authScheme} sign-in — enter the token first.`);
  const s = new McpSession(cfg, secret, await fetchLimits(cn));
  await s.open();
  return s;
}

/** The server's tools, with a CANDIDATE or the stored token. Throws in admin words. */
export async function listMcpToolsWith(cn: string, cfg: ApiConfig, secret: string | null): Promise<McpTool[]> {
  try {
    const s = await openSession(cn, cfg, secret);
    return await s.listTools();
  } catch (err) {
    log.warn('mcp tools/list failed', { clientNumber: cn, host: safeHost(cfg.baseUrl), reason: adminReason(err) });
    throw new ApiReadError(adminReason(err));
  }
}

export async function listMcpTools(cn: string, ref: McpRef): Promise<McpTool[]> {
  let secret: string | null;
  try { secret = await loadSecret(cn, ref); } catch (err) { throw new ApiReadError(adminReason(err)); }
  return listMcpToolsWith(cn, ref.apiConfig, secret);
}

/**
 * The credential check for PUT /secret: the handshake and tools/list with the
 * CANDIDATE token — the tool may not be chosen yet, so the proof of the token is
 * that the server lets us in and lists its tools. Never throws.
 */
export async function testMcpTokenWith(cn: string, cfg: ApiConfig, secret: string): Promise<TestResult> {
  try {
    const tools = await listMcpToolsWith(cn, cfg, secret);
    return { ok: true, rows: 0, columns: [], sampleRow: null, ...(tools.length ? {} : { reason: 'Signed in, but the server lists no tools.' }) };
  } catch (err) {
    return fail(adminReason(err));
  }
}

/** The Connect test: one real tool call; exactly ONE record shown; 0 records is not ok. */
export async function testMcpWith(cn: string, cfg: ApiConfig, secret: string | null): Promise<TestResult> {
  try {
    if (!cfg.mcpTool) return fail('Choose the tool that returns the records first ("List the tools").');
    const s = await openSession(cn, cfg, secret);
    const data = toolData(await s.callTool(cfg.mcpTool, cfg.body ?? {}), cfg.mcpTool);
    const records = recordsIn(data, cfg, cfg.mcpTool);
    const declaredTotal = cfg.declaredTotalPath ? declaredNumber(lookupPath(data, cfg.declaredTotalPath)) : null;
    if (records.length === 0) {
      return { ...fail(`The tool "${cfg.mcpTool}" answered, but its list is empty — there is nothing to map. Check the tool's arguments.`), pageRecords: 0, declaredTotal };
    }
    const sampleRow = flattenRecord(records[0]);
    const idMissing = measureIdentity(records, cfg.idField);
    return {
      ok: true, rows: records.length, columns: Object.keys(sampleRow), sampleRow,
      pageRecords: records.length, declaredTotal, ...(idMissing ? { idMissing } : {}),
    };
  } catch (err) {
    const reason = adminReason(err);
    log.warn('mcp test failed', { clientNumber: cn, host: safeHost(cfg.baseUrl), reason });
    return fail(reason);
  }
}

export async function testMcp(cn: string, ref: McpRef): Promise<TestResult> {
  let secret: string | null;
  try { secret = await loadSecret(cn, ref); } catch (err) { return fail(adminReason(err)); }
  return testMcpWith(cn, ref.apiConfig, secret);
}

/** Every record the tool returns (one call), flattened like an API's. */
export async function readMcp(cn: string, ref: McpRef): Promise<ReadResult> {
  const cfg = ref.apiConfig;
  const ph = placeholderHost(cfg.baseUrl);
  if (ph) throw new IntegrationInputError(placeholderReason(ph), 'apiConfig');
  if (!cfg.mcpTool) throw new IntegrationInputError('Choose the MCP tool that returns the records first.', 'apiConfig');
  const secret = await loadSecret(cn, ref);
  const maxRows = await getBehaviorValue('integrations.max_rows', { clientNumber: cn });
  const s = await openSession(cn, cfg, secret);
  const data = toolData(await s.callTool(cfg.mcpTool, cfg.body ?? {}), cfg.mcpTool);
  let raw = recordsIn(data, cfg, cfg.mcpTool);
  const anomalies: string[] = [];
  let truncatedReason: string | null = null;
  if (raw.length > maxRows) {
    raw = raw.slice(0, maxRows);
    truncatedReason = `Only the first ${maxRows} records were read (the row limit).`;
  }
  let declaredTotal: number | null = null;
  if (cfg.declaredTotalPath) {
    declaredTotal = declaredNumber(lookupPath(data, cfg.declaredTotalPath));
    if (declaredTotal === null) anomalies.push(`The total at "${cfg.declaredTotalPath}" was not a number, so completeness could not be checked.`);
    else if (raw.length < declaredTotal) {
      const msg = `Read ${raw.length} of a declared ${declaredTotal} records — the tool may page its answer; check its arguments.`;
      truncatedReason = truncatedReason ? `${truncatedReason} ${msg}` : msg;
    } else if (raw.length > declaredTotal) anomalies.push(`Read ${raw.length} records but the tool declared ${declaredTotal}.`);
  }
  const flat = raw.map((r) => flattenRecord(r));
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const r of flat) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); headers.push(k); }
  const records = flat.map((r) => {
    const full: Record<string, string> = {};
    for (const h of headers) full[h] = r[h] ?? '';
    return full;
  });
  log.info('mcp read', { clientNumber: cn, integrationId: ref.id, host: safeHost(cfg.baseUrl), tool: cfg.mcpTool, records: records.length, truncated: !!truncatedReason });
  return {
    records, headers, rowCount: records.length,
    truncated: !!truncatedReason, ...(truncatedReason ? { truncatedReason } : {}),
    anomalies, sourceLabel: `${where(cfg)} › ${cfg.mcpTool}`, declaredTotal, pagesRead: 1,
  };
}
