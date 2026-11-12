/**
 * DEF-447 — Integrations: an outside system's MCP server as a source (inbound).
 * Owner 2026-11-12 (CL-085): "Inbound: receive data from external mcp (we need
 * this)"; "it should be part of existing integration UI/UX with separate source".
 *
 * guardedFetch is replaced by a scripted MCP server (the guard itself is pinned
 * in def362IntegrationFetchGuard); buildAuth is the REAL one, so what this file
 * pins is what the MCP reader hands the guard. Pinned:
 *  1. The wire: initialize (protocol version, Accept json + event-stream) →
 *     notifications/initialized → tools/call; the server's session id and the
 *     negotiated version ride on every later request; JSON and event-stream
 *     answers both read.
 *  2. The token rides only as the guard's auth attachment, never in a header the
 *     reader builds; a scheme with no token is refused before any request; a
 *     token echoed in an error is scrubbed.
 *  3. The tool's answer: structuredContent first, JSON text second, prose and
 *     isError refused in words; recordsPath miss names where lists are.
 *  4. testMcpWith: exactly ONE flattened record, the count, the declared total;
 *     0 records is not ok; no tool chosen is not ok; never throws.
 *  5. readMcp: flattened records, every header on every record; max_rows ⇒
 *     truncated; a declared total not reached ⇒ truncated.
 *  6. tools/list follows nextCursor; a server without tools is refused; a 404 on
 *     initialize says "not an MCP endpoint".
 *  7. The router: 'mcp' rows go to the MCP reader; a missing tool is a setup
 *     problem; the config keeps mcpTool; the migration widens the CHECK.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const caps = vi.hoisted(() => ({ maxRows: 50000 }));
vi.mock('../src/services/behaviorConfig', () => ({
  getBehaviorValue: async (key: string) => ({ 'integrations.max_rows': caps.maxRows } as Record<string, number>)[key],
}));
type Reply = { status?: number; body: unknown; headers?: Record<string, string> };
const net = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; opts: any; msg: any }>,
  handler: null as null | ((msg: any, opts: any) => Reply),
}));
vi.mock('../src/services/integrations/sources/integrationFetch', async () => {
  const real = await vi.importActual<any>('../src/services/integrations/sources/integrationFetch');
  return {
    ...real,
    fetchLimits: async () => ({ maxBytes: 20 * 1024 * 1024, timeoutMs: 60000, maxPages: 50 }),
    guardedFetch: async (url: string | URL, opts: any) => {
      const u = new URL(String(url));
      const msg = JSON.parse(opts.body);
      net.calls.push({ url: u.toString(), opts, msg });
      const r = net.handler!(msg, opts);
      const body = Buffer.from(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
      return { status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'application/json' }, body, finalUrl: u.toString(), redirects: 0 };
    },
  };
});
const secrets = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('../src/services/integrations/store/secretStore', () => ({
  getSecret: async () => secrets.value,
}));
vi.mock('../src/services/integrations/sources/gsheetReader', () => ({
  readGsheet: async () => ({ records: [], headers: [], rowCount: 0, truncated: false, anomalies: [], sourceLabel: 'S' }),
  testGsheet: async () => ({ ok: true, rows: 1, columns: ['a'], sampleRow: { a: '1' } }),
}));

import {
  listMcpTools, parseMcpBody, readMcp, testMcpTokenWith, testMcpWith, toolData, MCP_PROTOCOL_VERSION,
} from '../src/services/integrations/sources/mcpReader';
import { readApiConfig } from '../src/services/integrations/sources/apiReader';
import { readSource, sourceProblem } from '../src/services/integrations/sources';
import { SOURCE_KINDS, usesApiConfig, type ApiConfig } from '../src/services/integrations/types';

const CN = 'TENANT_A';
const TOKEN = 'mcp-Token-For-Tests-Only-98765';
const EMPLOYEES = [
  { personalNo: 'E1', name: 'Asma', unit: { name: 'TMC' } },
  { personalNo: 'E2', name: 'Bilal', unit: { name: 'Xnrel' } },
];

function cfg(over: Partial<ApiConfig> = {}): ApiConfig {
  return {
    baseUrl: 'https://erp.acme.test/mcp', method: 'POST', path: '', query: {}, body: { status: 'active' },
    authScheme: 'BEARER', recordsPath: 'items', idField: 'personalNo', pagination: { kind: 'none' },
    mcpTool: 'list_employees', ...over,
  };
}

/** A well-behaved MCP server; `call` decides the tools/call result. */
function server(call: (msg: any) => unknown, opts: { sse?: boolean; tools?: unknown[][]; noTools?: boolean } = {}) {
  net.handler = (msg) => {
    const wrap = (result: unknown): Reply => {
      const rpc = { jsonrpc: '2.0', id: msg.id, result };
      return opts.sse
        ? { body: `event: message\ndata: ${JSON.stringify(rpc)}\n\n`, headers: { 'content-type': 'text/event-stream' } }
        : { body: rpc };
    };
    if (msg.method === 'initialize') {
      const r = wrap({ protocolVersion: '2025-03-26', capabilities: opts.noTools ? {} : { tools: {} }, serverInfo: { name: 'ERP' } });
      return { ...r, headers: { ...(r.headers ?? { 'content-type': 'application/json' }), 'mcp-session-id': 'sess-42' } };
    }
    if (msg.method === 'notifications/initialized') return { status: 202, body: '' };
    if (msg.method === 'tools/list') {
      const pages = opts.tools ?? [[{ name: 'list_employees', description: 'All employees', inputSchema: { type: 'object' } }]];
      const i = msg.params?.cursor ? Number(msg.params.cursor) : 0;
      return wrap({ tools: pages[i], ...(i + 1 < pages.length ? { nextCursor: String(i + 1) } : {}) });
    }
    if (msg.method === 'tools/call') return wrap(call(msg));
    return { body: { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no such method' } } };
  };
}

beforeEach(() => {
  net.calls = [];
  net.handler = null;
  secrets.value = TOKEN;
  caps.maxRows = 50000;
});

describe('1 — the wire', () => {
  it('initialize → initialized → tools/call, with session id and negotiated version on later requests', async () => {
    server(() => ({ structuredContent: { items: EMPLOYEES } }));
    const r = await testMcpWith(CN, cfg(), TOKEN);
    expect(r.ok).toBe(true);
    expect(net.calls.map((c) => c.msg.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
    const init = net.calls[0];
    expect(init.msg.params.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(init.opts.headers.accept).toBe('application/json, text/event-stream');
    expect(init.opts.method).toBe('POST');
    expect(init.opts.origin).toBe('https://erp.acme.test');
    for (const c of net.calls.slice(1)) {
      expect(c.opts.headers['mcp-session-id']).toBe('sess-42');
      expect(c.opts.headers['mcp-protocol-version']).toBe('2025-03-26');
    }
    expect(net.calls[1].msg.id).toBeUndefined(); // a notification has no id
    expect(net.calls[2].msg.params).toEqual({ name: 'list_employees', arguments: { status: 'active' } });
  });

  it('reads an event-stream answer the same as JSON', async () => {
    server(() => ({ structuredContent: { items: EMPLOYEES } }), { sse: true });
    const r = await testMcpWith(CN, cfg(), TOKEN);
    expect(r.ok).toBe(true);
    expect(r.pageRecords).toBe(2);
  });

  it('parseMcpBody: JSON, batch and multi-event streams', () => {
    expect(parseMcpBody('{"id":1}', 'application/json')).toEqual([{ id: 1 }]);
    expect(parseMcpBody('[{"id":1},{"id":2}]', 'application/json')).toEqual([{ id: 1 }, { id: 2 }]);
    expect(parseMcpBody(': ping\n\nevent: message\ndata: {"id":3}\n\ndata: {"id":4}\n\n', 'text/event-stream'))
      .toEqual([{ id: 3 }, { id: 4 }]);
    expect(parseMcpBody('', 'application/json')).toEqual([]);
  });
});

describe('2 — the token', () => {
  it('rides only as the guard auth attachment, never in a header the reader builds', async () => {
    server(() => ({ structuredContent: { items: EMPLOYEES } }));
    await testMcpWith(CN, cfg(), TOKEN);
    for (const c of net.calls) {
      expect(c.opts.auth.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(JSON.stringify(c.opts.headers)).not.toContain(TOKEN);
      expect(c.opts.body).not.toContain(TOKEN);
    }
  });

  it('a scheme with no token is refused before any request', async () => {
    secrets.value = null;
    server(() => ({}));
    const r = await testMcpWith(CN, cfg(), null);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/enter the token first/);
    expect(net.calls).toHaveLength(0);
  });

  it('a 401 says the token is wrong, with the echoed token scrubbed', async () => {
    net.handler = () => ({ status: 401, body: `invalid token ${TOKEN}` });
    const r = await testMcpWith(CN, cfg(), TOKEN);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/refused the request \(401\).*token/);
    expect(r.reason).not.toContain(TOKEN);
  });

  it('testMcpTokenWith proves a candidate by the handshake and tool list (no tool call)', async () => {
    server(() => { throw new Error('must not call a tool'); });
    const r = await testMcpTokenWith(CN, cfg({ mcpTool: null }), TOKEN);
    expect(r.ok).toBe(true);
    expect(net.calls.map((c) => c.msg.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
  });
});

describe('3 — the tool answer', () => {
  it('structuredContent wins over text', () => {
    expect(toolData({ structuredContent: { a: 1 }, content: [{ type: 'text', text: 'hello' }] }, 't')).toEqual({ a: 1 });
  });
  it('JSON text is data; several text parts are a list', () => {
    expect(toolData({ content: [{ type: 'text', text: '{"items":[1]}' }] }, 't')).toEqual({ items: [1] });
    expect(toolData({ content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text: '{"a":2}' }] }, 't')).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it('prose is refused in words, never turned into a table', () => {
    expect(() => toolData({ content: [{ type: 'text', text: 'There are 2 employees.' }] }, 'list_employees'))
      .toThrow(/answered in plain text, not data.*There are 2 employees/);
  });
  it('isError is reported with what the tool said', () => {
    expect(() => toolData({ isError: true, content: [{ type: 'text', text: 'department required' }] }, 'list_employees'))
      .toThrow(/reported an error: department required/);
  });
  it('a recordsPath miss names where the lists are', async () => {
    server(() => ({ structuredContent: { data: { rows: EMPLOYEES } } }));
    const r = await testMcpWith(CN, cfg(), TOKEN);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/No list of records was found at "items".*data\.rows/);
  });
});

describe('4 — the Connect test', () => {
  it('shows exactly ONE flattened record, the count and the declared total', async () => {
    server(() => ({ content: [{ type: 'text', text: JSON.stringify({ items: EMPLOYEES, total: 2 }) }] }));
    const r = await testMcpWith(CN, cfg({ declaredTotalPath: 'total' }), TOKEN);
    expect(r).toMatchObject({ ok: true, rows: 2, pageRecords: 2, declaredTotal: 2 });
    expect(r.sampleRow).toEqual({ personalNo: 'E1', name: 'Asma', 'unit.name': 'TMC' });
    expect(r.idMissing).toBeUndefined();
  });
  it('measures the id field like an API test', async () => {
    server(() => ({ structuredContent: { items: EMPLOYEES } }));
    const r = await testMcpWith(CN, cfg({ idField: 'id' }), TOKEN);
    expect(r.idMissing).toEqual({ field: 'id', records: 2, candidates: ['personalNo', 'name'] });
  });
  it('0 records is not ok; no tool chosen is not ok; nothing throws', async () => {
    server(() => ({ structuredContent: { items: [] } }));
    expect((await testMcpWith(CN, cfg(), TOKEN)).reason).toMatch(/list is empty/);
    expect((await testMcpWith(CN, cfg({ mcpTool: null }), TOKEN)).reason).toMatch(/Choose the tool/);
    net.handler = () => { throw new Error('socket hang up'); };
    const r = await testMcpWith(CN, cfg(), TOKEN);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unexpected error/);
  });
});

describe('5 — the read', () => {
  it('flattens every record and gives every record every header', async () => {
    server(() => ({ structuredContent: { items: [...EMPLOYEES, { personalNo: 'E3', extra: 'x' }] } }));
    const r = await readMcp(CN, { id: 'i1', apiConfig: cfg() });
    expect(r.headers).toEqual(['personalNo', 'name', 'unit.name', 'extra']);
    expect(r.records[2]).toEqual({ personalNo: 'E3', name: '', 'unit.name': '', extra: 'x' });
    expect(r).toMatchObject({ rowCount: 3, truncated: false, pagesRead: 1, sourceLabel: 'erp.acme.test/mcp › list_employees' });
  });
  it('max_rows cuts and marks the read truncated', async () => {
    caps.maxRows = 1;
    server(() => ({ structuredContent: { items: EMPLOYEES } }));
    const r = await readMcp(CN, { id: 'i1', apiConfig: cfg() });
    expect(r.rowCount).toBe(1);
    expect(r.truncated).toBe(true);
    expect(r.truncatedReason).toMatch(/first 1 records/);
  });
  it('a declared total not reached is truncated', async () => {
    server(() => ({ structuredContent: { items: EMPLOYEES, total: 1111 } }));
    const r = await readMcp(CN, { id: 'i1', apiConfig: cfg({ declaredTotalPath: 'total' }) });
    expect(r.truncated).toBe(true);
    expect(r.truncatedReason).toMatch(/Read 2 of a declared 1111/);
  });
  it('a failed call fails the read (the run records it), never an empty success', async () => {
    server(() => ({ isError: true, content: [{ type: 'text', text: 'down' }] }));
    await expect(readMcp(CN, { id: 'i1', apiConfig: cfg() })).rejects.toThrow(/reported an error: down/);
  });
});

describe('6 — tools and handshake', () => {
  it('tools/list follows nextCursor', async () => {
    server(() => ({}), { tools: [[{ name: 'a', inputSchema: {} }], [{ name: 'b', title: 'B', description: 'bee' }]] });
    const tools = await listMcpTools(CN, { id: 'i1', apiConfig: cfg() });
    expect(tools.map((t) => t.name)).toEqual(['a', 'b']);
    expect(tools[1]).toEqual({ name: 'b', title: 'B', description: 'bee', inputSchema: {} });
    expect(net.calls.filter((c) => c.msg.method === 'tools/list')[1].msg.params).toEqual({ cursor: '1' });
  });
  it('a server that offers no tools is refused', async () => {
    server(() => ({}), { noTools: true });
    await expect(listMcpTools(CN, { id: 'i1', apiConfig: cfg() })).rejects.toThrow(/offers no tools/);
  });
  it('a 404 on initialize says the address is not an MCP endpoint', async () => {
    net.handler = () => ({ status: 404, body: 'Not Found' });
    const r = await testMcpWith(CN, cfg(), TOKEN);
    expect(r.reason).toMatch(/not an MCP endpoint.*\/mcp/);
  });
  it('an address that answers non-JSON-RPC is named', async () => {
    net.handler = () => ({ body: '<html>hello</html>', headers: { 'content-type': 'text/html' } });
    const r = await testMcpWith(CN, cfg(), TOKEN);
    expect(r.reason).toMatch(/did not answer like an MCP server/);
  });
  it('an example address is refused before any request', async () => {
    server(() => ({}));
    const r = await testMcpWith(CN, cfg({ baseUrl: 'https://your-domain.com/mcp' }), TOKEN);
    expect(r.reason).toMatch(/still an example/);
    expect(net.calls).toHaveLength(0);
  });
});

describe('7 — router, config, migration', () => {
  it('mcp is a source kind whose connection lives in api_config', () => {
    expect(SOURCE_KINDS).toContain('mcp');
    expect(usesApiConfig('mcp')).toBe(true);
    expect(usesApiConfig('api')).toBe(true);
    expect(usesApiConfig('file')).toBe(false);
  });
  it('readApiConfig keeps mcpTool, and an API config stays without it', () => {
    expect(readApiConfig({ ...cfg(), mcpTool: 'list_employees' })?.mcpTool).toBe('list_employees');
    const { mcpTool: _drop, ...api } = cfg();
    expect(readApiConfig(api)).not.toHaveProperty('mcpTool');
  });
  it('sourceProblem: no address, then no tool, then nothing', () => {
    expect(sourceProblem({ id: 'i', sourceKind: 'mcp', sourceConfig: {}, apiConfig: null })?.message).toMatch(/MCP server connection/);
    expect(sourceProblem({ id: 'i', sourceKind: 'mcp', sourceConfig: {}, apiConfig: cfg({ mcpTool: null }) })?.message).toMatch(/Choose the MCP tool/);
    expect(sourceProblem({ id: 'i', sourceKind: 'mcp', sourceConfig: {}, apiConfig: cfg() })).toBeNull();
  });
  it('readSource sends an mcp row to the MCP reader', async () => {
    server(() => ({ structuredContent: { items: EMPLOYEES } }));
    const r = await readSource(CN, { id: 'i1', sourceKind: 'mcp', sourceConfig: {}, apiConfig: cfg() });
    expect(r.rowCount).toBe(2);
    expect(net.calls.some((c) => c.msg.method === 'tools/call')).toBe(true);
  });
  it('the migration widens source_kind to mcp, idempotently, keeping every other enum', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20261112_integrations_mcp_source/migration.sql'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS integration_syncs_enums_check;/);
    expect(sql).toMatch(/source_kind IN \('gsheet','api','file','mcp'\)/);
    expect(sql).toMatch(/status IN \('DRAFT','ACTIVE','PAUSED'\)/);
    expect(sql).toMatch(/frequency IN \('daily','weekly','monthly','once'\)/);
    expect(sql).toMatch(/blank_policy IN \('normal','abnormal'\)/);
    expect(sql).toMatch(/last_run_status IN \('RUNNING','SUCCESS','PARTIAL','FAILED','ABORTED'\)/);
    expect(sql).toMatch(/EXCEPTION WHEN duplicate_object THEN NULL/);
    expect(sql).not.toMatch(/CREATE TABLE|ADD COLUMN/i);
  });
});

// ── Client (DEF-447): the same wizard, a separate source ───────────────────
import * as logic from '../../client/src/pages/admin/integrations/integrationLogic.js';

describe('8 — client logic and screens', () => {
  const CLIENT = path.resolve(__dirname, '../../client/src');
  const read = (p: string) => fs.readFileSync(path.join(CLIENT, p), 'utf8');

  it('the MCP form becomes the API-shaped config the server stores, one call, POST, no paging', () => {
    const form = { ...logic.formFromConfig(null), baseUrl: 'https://erp.acme.test/mcp', authScheme: 'BEARER', mcpTool: 'list_employees', body: '{"status":"active"}', recordsPath: 'items', idField: 'personalNo' };
    const { config, errors } = logic.configFromForm(form, 'mcp');
    expect(errors).toEqual([]);
    expect(config).toMatchObject({
      baseUrl: 'https://erp.acme.test/mcp', method: 'POST', path: '', query: {}, body: { status: 'active' },
      authScheme: 'BEARER', recordsPath: 'items', idField: 'personalNo', pagination: { kind: 'none' }, mcpTool: 'list_employees',
    });
    // The server's normaliser reads it back unchanged in meaning.
    expect(readApiConfig(config)?.mcpTool).toBe('list_employees');
  });
  it('refuses http, a non-object settings JSON and a bad tool name; an empty tool is allowed (to list tools first)', () => {
    const base = logic.formFromConfig(null);
    expect(logic.configFromForm({ ...base, baseUrl: 'http://x.test/mcp' }, 'mcp').errors.join(' ')).toMatch(/https/);
    expect(logic.configFromForm({ ...base, baseUrl: 'https://x.test/mcp', body: '[1]' }, 'mcp').errors.join(' ')).toMatch(/JSON object/);
    expect(logic.configFromForm({ ...base, baseUrl: 'https://x.test/mcp', mcpTool: 'bad tool!' }, 'mcp').errors.join(' ')).toMatch(/tool name/);
    expect(logic.configFromForm({ ...base, baseUrl: 'https://x.test/mcp' }, 'mcp').config?.mcpTool).toBeNull();
  });
  it('the saved MCP config is not "dirty" against its own form; a changed tool is', () => {
    const saved = cfg();
    const form = logic.formFromConfig(saved);
    expect(logic.isConfigDirty(form, saved, 'mcp')).toBe(false);
    expect(logic.isConfigDirty({ ...form, mcpTool: 'other' }, saved, 'mcp')).toBe(true);
  });
  it('a tool’s settings start from its schema defaults only, and its settings are described', () => {
    const schema = { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['active', 'left'], default: 'active', description: 'Which employees' }, limit: { type: 'integer' } } };
    expect(JSON.parse(logic.mcpArgsFromSchema(schema))).toEqual({ status: 'active' });
    expect(logic.mcpArgsFromSchema({})).toBe('{}');
    expect(logic.mcpSchemaRows(schema)).toEqual([
      { name: 'status', type: 'active | left', required: true, description: 'Which employees' },
      { name: 'limit', type: 'integer', required: false, description: '' },
    ]);
  });
  it('Basics offers "MCP server" as its own source in the same wizard', () => {
    const src = read('pages/admin/integrations/StepBasics.jsx');
    expect(src).toMatch(/kind: 'mcp', label: 'MCP server'/);
  });
  it('Connect has the MCP form: list the tools, pick one, its settings, then the same test and token box', () => {
    const src = read('pages/admin/integrations/StepConnect.jsx');
    expect(src).toMatch(/function McpConnectionForm/);
    expect(src).toMatch(/listMcpTools\(integ\.id\)/);
    expect(src).toMatch(/isConn && needsSecret\(form\.authScheme\)/);
    expect(src).toMatch(/configFromForm\(form, kind\)/);
    expect(read('services/integrationsApi.js')).toMatch(/\/mcp\/tools/);
  });
});

describe('9 — a wrapped written answer (seen live 11-12 on a public MCP server)', () => {
  it('says the answer holds text, not data, instead of a bare "no list"', async () => {
    server(() => ({ structuredContent: { result: 'Available pages: 1 Introduction …' }, content: [{ type: 'text', text: 'Available pages…' }] }));
    const r = await testMcpWith(CN, cfg({ recordsPath: '' }), TOKEN);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/answered without any list of records — its answer holds: result \(text\)\. That is a written answer, not data/);
  });
});
