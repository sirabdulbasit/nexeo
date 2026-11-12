# Integrations — design (Admin → Integrations)

**Status:** LIVE (Admin → Integrations). Last updated 2026-11-12 with DEF-447 (MCP server source).
Owner rule 2026-11-12: *"Integration should be documented properly and updated after every build"* —
every integrations build updates §0 and its own section here, in the same commit.
Original scope (owner 2026-10-23): core wizard first; map targets KPI numbers, people/contacts, feed
events, Brain knowledge; sources Google Sheet first, then REST, Odoo, Qlik; UI under Admin.
**Ported from:** vm `Documentations/06_INTEGRATION.md` (§7 screens, §8 failure rules, §9
invariants). Draft + adversarial critique against both codebases: 2026-10-26 workflow
`integration-port-understand`. Every critique correction is applied below.

## 0. What it does now (current state — read this first)

| | |
|---|---|
| **Sources** (Basics → "Where the data comes from") | **Google Sheet** (link; public or via the designated Google account) · **API (with its document)** (the AI reads the attached document and fills the connection; keys printed in it are tried and kept encrypted) · **Excel or CSV file** (uploaded copy, read every run) · **MCP server** (inbound: an outside system's MCP endpoint; one of its tools is called and its answer read as records — §2d). Outbound MCP (Nexeo's own `/api/v1/mcp`) is **held** (owner 11-12). |
| **Five steps** | Basics · Connect (test reads the source for real; exactly one record shown; "Records cannot be identified" names the fields that could identify one) · Review the mapping (instructions box + **Re-generate the proposal** at the top) · Schedule · Test & turn on (dry run: KPI figures to write / proposal rows set aside / existing figures changed; a KPI × month table whose figures open the records behind them; every record read, in the source's own fields, mapped fields first ●). |
| **Destinations** | **KPI figures** → `kpi_readings` (one slot = KPI + month + breakdown), definitions in `kpi_definitions`; **knowledge pages** → Wiki `org_doc` pages, one per record (tenant-wide); **filter** rows narrow what is read. |
| **Data already there** | Same value → nothing written; different value → replaced, old → new kept in the run's change log; a KPI fed by another integration → the run stops; a blank never overwrites; a page whose title already exists (written by hand) is not overwritten; a record gone from a complete read → its page is marked stale, never deleted. |
| **Safety** | Every outside request through the fetch guard (https, pinned vetted address, same origin, byte and time caps); secrets encrypted, write-only, sent only to the configured origin, dropped when the origin moves; the AI works only at design time, never on a run; a scheduled run changing more than the change limit (default 25 %) of what it holds stops before writing; one transaction per run for the figures. |
| **Known gaps** | KPI figures are not yet Wiki pages (handed to the "wiki" session, 11-12); no screen to browse stored KPI figures outside the Test step; MCP: one tool call per read (no paging), Streamable HTTP only. |

## 1. What it does

An admin opens **Admin → Integrations** and connects an outside system in five steps —
**Basics · Connect · Review the mapping · Schedule · Test & turn on** — after which Nexeo keeps
Brain's data current from it. A run writes only what the admin approved, field by field, on one
mapping version; a blank never overwrites; identity fields are never written; what was written is
recorded in the same transaction as the write; nothing crosses a tenant.

The model works at **design time only** (proposing what each source field means). Every run is
deterministic code. `services/integrations/engine/**` imports no AI provider (test-pinned).

## 2. Stage 1 — Google Sheet → five steps → KPI numbers → Brain

Shippable on its own. Later stages add writers and readers to the same skeleton (§6).

### 2.1 Data model (migration `20261026_integrations_core`, hand-written, idempotent)

All tables: `client_number VARCHAR(20) NOT NULL`, every timestamp `TIMESTAMPTZ`, children
`ON DELETE CASCADE`, composite indexes lead with `client_number`, models added to
`TENANT_SCOPED_MODELS` (`src/db/prisma.ts`). Raw SQL always carries `client_number` explicitly.

| Table | Purpose |
|---|---|
| `integration_syncs` | One integration: name, purpose, admin brief, `source_kind` (`gsheet` in Stage 1), `source_config` (sheet id, gid, tab label), `status` DRAFT/ACTIVE/PAUSED, schedule (`frequency` daily/weekly/monthly/once, `run_time`, `day_of_week`, `day_of_month`, `timezone` taken from the creator via `resolveUserTimezone`, validated), `change_cap_pct`, `blank_policy`, `connection_tested_at` + `connection_fingerprint` (sha256 of the route config at the last OK test), `activated_at`, `approved_version_id`, `last_slot_at`, `next_run_at`, `last_run_at`, `last_run_status`. DB CHECK: ACTIVE ⇒ activated_at and approved_version_id set. |
| `integration_mapping_versions` | Numbered proposals; `spec` (filter, coverage, provider), `ai_summary`, admin prompt. Partial unique: one APPROVED per integration. |
| `integration_suggestions` | One row per FIELD decision (never per record): `target_kind`, `source_field`, `target_key`, `transform`, `coverage`, `samples`, `reason` (blast radius / set-aside arithmetic), status PENDING/APPROVED/REJECTED/SET_ASIDE/BLANK, `carried_from_id`. |
| `integration_runs` | One run: dry_run, trigger manual/scheduled, triggered_by, status RUNNING/SUCCESS/PARTIAL/FAILED/ABORTED, counts (read, filtered, subjects, writes, set aside, blanks, change %), `result` JSON, `connection_fingerprint` + `mapping_version_id` tested. Partial unique: one RUNNING per integration (the run mutex). |
| `integration_run_changes` | OUTCOME rows (`cuid` id — a BigInt id cannot be JSON-serialised): subject, target, before → after. Live runs: written in the same transaction as the data. Dry runs: preview rows. |
| `kpi_definitions` | Tenant KPI catalogue: `kpi_key` (unique per tenant), label, unit, direction, grain, `source_integration_id` (one owner), is_active. |
| `kpi_readings` | Dated measurements: unique `(client_number, kpi_key, period_start, dimension_key)`, `value NUMERIC`, `integration_id`, `run_id`. A missing reading is no row, never 0. |

`kpi_values` (Steering Wheel ops metrics, no unique key) is left untouched. Deleting an
integration removes its versions, suggestions and run history (cascade); KPI readings it wrote stay.

### 2.2 Source: Google Sheet

- Link parsing ported from vm `integrationSheetLink.ts`: the export URL is **rebuilt from the
  sheet id and gid alone** (`https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=<gid>`),
  so a pasted link can never send the server anywhere else. A tab is never silently swapped.
- **Private sheets read through the tenant's designated Google account** —
  `system_config.google_drive_org_user_id`, the same admin-chosen account the org Drive scribe uses
  (`folderScribeService.pickTenantScribeUser`). No new consent, no new GCP redirect URI, no
  per-integration token. Public "anyone with the link" sheets need no account.
- **CSV, not xlsx.** Nexeo's `xlsx@0.18.5` has published CVEs and must not parse untrusted
  workbooks; the CSV export is parsed by a small RFC 4180 parser. Excel upload is deferred until a
  safe parser is pinned.
- Caps (behaviorConfig): 10 MB, 60 s, 50k rows. An HTML answer = "not shared / sign-in needed".
- **Test before anything else:** Connect reads the sheet for real; a 200 with 0 rows is not OK.
  "Suggest the mapping" stays disabled until the test passed, and editing the link clears it.

### 2.3 Mapping (design time)

- **Field inventory** from ALL rows: fill rate, inferred type, 2–3 real values, distinct values
  when few (ported vm `discoverSourceFields`/`buildFieldCoverage`).
- **KPI target shapes** (both are common in sheets of monthly numbers):
  - *long*: one value column + a period column (+ optional dimension column, e.g. Region);
  - *wide*: one column per period — transform `{unpivot: {columns, periodFrom: 'header'}}`.
- **Proposer** (`callLLM` via `llmRouter`, `purpose: 'integration_mapping'`) gets the brief, the
  admin's prompt, the inventory with samples, the active KPI catalogue, approved rows (kept) and
  rejected pairs (settled). It may propose **new KPI definitions** (key, label, unit); approving
  the row creates the definition. It returns field-wise rows plus "could not be done" notices.
  Output keys outside the catalogue are dropped; arithmetic risk checks (never populated, value
  not numeric) turn a row into SET_ASIDE with the numbers in `reason`.
- A new proposal is a new version that **carries every approved row** and proposes only the rest.
  The approved version keeps running until the new one is approved.

### 2.4 Run engine (execution time)

`runIntegration(cn, id, {dryRun, trigger, triggeredBy, versionId?})`:
1. Load `{id, clientNumber}`; live runs need `approved_version_id`; dry runs use the on-screen version.
2. Insert the run row — the partial unique index is the mutex (`RunBusyError` → 409 / skip).
3. Read the sheet; header check — a column the approved mapping reads is missing ⇒ FAILED.
4. Plan per record from the APPROVED rows of that version only (computed now, never stored).
   Blank ⇒ skip + count (never overwrite). Non-numeric ⇒ skip + count.
   An approved row whose KPI definition is inactive/deleted ⇒ **the run FAILS** (vm §9).
5. Change cap: a **scheduled** run changing more than `change_cap_pct` of the readings this
   integration already owns ⇒ ABORTED, nothing written. Manual runs are never capped; a first load
   (owns 0) never trips. **Dry runs report the cap verdict as a scheduled run would.**
6. Dry run: store preview change rows, SUCCESS, write nothing else.
7. Live: ONE transaction — all KPI upserts (`ON CONFLICT … DO UPDATE … WHERE value IS DISTINCT
   FROM EXCLUDED.value`) + their change rows. Any failure ⇒ nothing written, FAILED.
   (vm §9 "a failed run records no measurement"; AGENTS §2.6 "no mutation without its ledger".)
8. Counts are distinct subjects; "Updated" only when something was written, else "No changes".

### 2.5 Schedule and turn-on

- `integration_sync_dispatcher`: `protectedJob(..., 'maintenance')` every 60 s in `server.ts`, plus
  the missed-run list and `docs/background_jobs_inventory.md`. Reads ACTIVE integrations (the only
  cross-tenant read, explicit `runWithoutTenant`), claims each due slot atomically
  (`UPDATE … SET last_slot_at = $slot WHERE … AND activated_at <= $slot AND (last_slot_at IS NULL
  OR last_slot_at < $slot)`), then starts the run. Max 2 concurrent (behaviorConfig).
- **Boot sweep:** every RUNNING row at startup becomes FAILED "interrupted by server restart".
- **Turn on** = one transaction: the version has ≥1 approved row, **a SUCCESS dry run exists for
  that same version with the current connection fingerprint**, schedule valid; approve the version,
  set `ACTIVE`, set `activated_at = now()` only if not already active, compute `next_run_at`.
  **Turning on never runs anything**, and no slot before `activated_at` is ever owed.

### 2.6 API

`server/src/routes/admin/integrationAdminRoutes.ts`, mounted at `/api/v1/admin/integrations`
**before** the generic `/admin` router (`app.ts:186`), whose 30 req/min `adminLimiter` would 429
the wizard's polling. Own limiter (behaviorConfig, default 240/min). `requireAuth` + admin role;
tenant = `req.user.clientNumber` (SuperAdmin may name another tenant explicitly).

`GET /` · `POST /` · `GET/PUT/DELETE /:id` (PUT is a closed whitelist — never status, approval,
activation) · `GET /:id/connection-check` · `POST /:id/propose/start` + `GET /:id/propose/status`
· `GET /:id/suggestions` · `POST /:id/suggestions/approve|reject` · `POST /:id/run/start` +
`GET /:id/run/status` · `GET /:id/runs` · `GET /:id/runs/:runId/changes` · `POST /:id/activate` ·
`POST /:id/pause` · `GET/POST /kpi-definitions`.

### 2.7 Client

`client/src/pages/admin/integrations/` — `IntegrationsTab` (list grouped **Working · Paused · Being
set up**, each headed with its count, empty groups hidden, stage derived from facts, never a stored
pointer), `IntegrationWizard` + one component per step, `RunHistory`, `WorkingOverlay` (elapsed
time while the AI proposes or a run executes). Added as a client sub-tab of `AdminPage.jsx`, using
its `msg/setMsg` props and the ConnectorsPage visual tokens.

### 2.8 Brain sees the numbers

New read-only Brain tool **`fetch_kpis`** in `services/knowledge/brainTools.ts` (tenant-scoped;
optional KPI key / period range; latest readings by default). The model decides when to call it
— no keyword regex. Reaches the reasoning compose path; the legacy composer is not extended (one
implementation, not two).

## 2b. Stage 1b — API document → REST connection; remarks, filters, instructions; KPI or Context (DEF-362)

Owner, 2026-10-26: *"attach any API document which can be read through AI to understand and build
connection, where I can ask for any filter or can give remarks … Connect: test connection and see
the data (1 row only), and give instruction how to map … Review & Mapping: analyze the current
structure as per Basic and Connect including all remarks — how this data can be mapped, or can
become Context."*

**Basics**
- Source kind: Google Sheet (Stage 1) **or API** (new).
- **API document** (API only): upload PDF / DOCX / TXT / MD / JSON (OpenAPI) or paste text, ≤ 5 MB.
  Text is extracted (`pdf-parse`, `mammoth`), **credential-looking strings redacted before it is
  stored or sent to the model**, stored on the integration (`api_doc_text`, `api_doc_name`).
  Addresses are never redacted: a URL is judged segment by segment, so
  `https://erp.tmcltd.com:5004/taql/api/employee/directory` reaches the model whole while a token
  sitting in one segment is still removed (DEF-436). Keys are recognised as `name: value`, in
  `Authorization`, bearer, JWT and vendor formats, in a header-table row (`x-api-key  KEY  …`) and
  in Postman steps (`Key: x-api-key  Value: KEY`).
  The address is settled in code, not by the model (DEF-438): when the AI drafts an example host
  and the document prints exactly one real origin for the drafted endpoint, that origin is used
  and the example-address gaps become one note (zero or several real origins: unchanged). On
  Connect a saved config wins over the reading, except a saved **example** address, which a real
  address from the reading replaces; Test then saves it.
- **Remarks for the AI** (`admin_brief`, existing) and **Filters** in plain words
  (`filter_instructions`, e.g. "only active customers, 2025 onwards").

**AI reads the document** (design time, `llmRouter`, `purpose: 'integration_doc_read'`) and drafts
the connection: base URL, auth scheme (NONE / BEARER / API_KEY header|query / BASIC), endpoint
path + method, records path in the JSON, pagination (none / page / offset / next-URL), the field
that identifies a record, a declared-total path if any — **plus the list of what the document did
not say**. Every value is editable. The model never chooses or stores a secret: the admin types it
into a secret field; it is encrypted (AES-256-GCM, key HKDF-derived from `ENCRYPTION_KEY` via the
strict `decodeMEK`, own `v1:` prefix — not `configService`, see DEF-356) and never returned.

**Connect**
- **Test the connection** = one real request through the guarded fetcher; shows **exactly one
  record** (flattened field → value) plus "N records on this page (declared total M)".
  A 200 with no records is a failure. A secret that fails is not stored over one that works.
- **"How should this data be mapped?"** — instruction box (`connect_instructions`) under the row.
- Editing any connection field clears the test (fingerprint, as Stage 1).

**Review & Mapping** — the proposer gets, in order: the AI's reading of the document, remarks,
filter words, connect instructions, field inventory over the read records (fill, type, samples),
per-field notes, the KPI catalogue, approved rows kept, rejected pairs settled. For every field it
proposes one of:
- **KPI** (Stage 1 shapes), or
- **Context** — Brain knowledge: `per_record` (title field + body fields → one tenant-wide
  knowledge page per record, ≤ `integrations.max_context_pages`, default 500) or `table` (chosen
  columns → one page for the whole set), or
- **Not used**, with the reason.
It also turns the filter words into a **proposed structured filter** (field / op / value rows) that
the admin approves like any other row; nothing filters until approved. Every row says which remark
or instruction it followed.

**Context writer** — `org_doc` wiki pages, `scope='tenant'`, through ONE helper extracted from
`folderScribeService` (`upsertTenantOrgDoc`) that both the folder scribe and integrations call — not
a second knowledge writer. Page title `"<integration name> · <record title>"`; key by record id
in metadata; unchanged content (hash) is skipped; changed pages re-embedded; a blank never
overwrites a section; records that disappear are marked `stale` (kept in page metadata, which the hourly wiki linter does
not rewrite), never deleted. **Table mode is a full snapshot** of the chosen columns at each run —
a blank source cell shows as blank; "a blank never overwrites" applies to per-record sections.
**Not in 1b:** KPI rows copy numbers the source already holds; a KPI that COUNTS or SUMS records
(e.g. headcount per department) needs an aggregate transform — named next increment.

**REST fetch guard** (`sources/integrationFetch.ts`): https only; the host is resolved once and
**private, loopback, link-local and metadata addresses are refused**, and the connection is pinned
to the resolved address (no DNS rebinding); same-origin for every page and redirect; ≤ 3 redirects;
size / time / page caps from behaviorConfig; the secret is attached only to the configured origin.
Qlik and Odoo stay Stage 4.

**Screens (owner 10-30: "Basic, Connect both UI/UX should be the same — same as Vision Metric",
"because Vision Metric integration is working fine for Basic and Connect"):** Basics and Connect
follow vm's `IntegrationSyncTab` layout, questions, wording and order, wired to Nexeo's API. vm
fields Nexeo has no place for are not shown (what it updates — Review decides that; create/leave
people; blank-alert recipients; per-integration Google consent — Nexeo uses the designated account).
The main Basics button sends pasted document text and reads it before continuing; a failed reading
still continues to Connect. A token typed in Connect is stored before the test runs with it.

**Keys in the document, as Vision Metric does (DEF-367, owner 10-30: "see how vision metric
work").** vm reads the key out of the API document and TESTS it before storing it
(`integrationDocReader.pickWorkingSecret`) — vm's own ESS document prints two different keys. Nexeo
gets the same result without letting the model see a key: when a document is attached, the values
redaction removes are kept as ciphertext (`api_doc_keys_enc`, same `v1:` envelope as the secret, a
DB CHECK refuses anything else). When **Test the connection** fails or no key is stored, the Connect
test tries the printed keys in document order and stores the first that returns records through
the normal secret path; a working stored key is never replaced; nothing is tried on an ACTIVE
integration. **Example addresses** in documents (`your-domain.com`, `*.example.com`, …) are named as a
gap in the AI's reading and refused by the test and the run with a plain message — documents are
written for every customer; the real address is the one the system's admin gives (vm's ESS:
`https://erp.tmcltd.com:5004`).

**Third source: Excel or CSV file (DEF-368, owner 10-31: "there should be integration source that can
be Googlesheet / API documentation file / Excel file with data").** Basics offers Google Sheet · API
(with its document) · Excel or CSV file. A file is uploaded in Connect (choosing it uploads it), kept
in `integration_source_files` (one per integration, replaced on re-upload, cascade on delete), and
every run reads that stored copy — vm's rule. Type is decided by magic bytes, not the browser's
mime. CSV goes through `csv.ts`. `.xlsx`/`.xls` go through the installed `xlsx@0.18.5` **only inside a
worker thread** (`sources/xlsxWorker.ts`, the one file allowed to import it — test-pinned): V8 heap
limit, hard timeout, at most 2 at once, plain string rows out. Before any worker, `zipSize.xlsxInflateBudget`
walks the zip the way xlsx does and inflates each part with Node zlib capped at the remaining budget
(60 MB), so a lying header (zip bomb) is refused before xlsx ever inflates it — verified with a
200 MB bomb: refused in 0.6 s, ~60 MB transient. The tab is chosen by name; a missing chosen tab fails
loudly. The connection fingerprint covers the file's sha256 + tab, so a new upload or tab needs a new
test; uploads and tab changes are refused on an ACTIVE integration (pause first).

## 2c. Shared framework `@tmc/ai-integration` (DEF-365)

Owner, 2026-10-30: *"adopt in Nexeo under integration — only adopt till mapping (further mapping
should be as per Nexeo) and then Schedule and run"*. The framework
(github.com/sirabdulbasit/ai-integration, commit `c0a6ebe`) is **vendored unchanged** in
`server/src/vendor/ai-integration/` (see `VENDORED.md` there; prod deploys run no `npm install`).
A thin tenant-bound adapter lives in `services/integrations/framework/`.

| Up to mapping — framework, composed with Nexeo's stricter guard | Nexeo's own |
|---|---|
| sheet-link parsing (second check), field inventory, API-document text for DOCX/text, outbound-URL check on every hop, **recipes + periods** (KPI figures computed as count / sum / ratio per month, optional dimension) | destinations (KPI, Context, filter), approval and versions, the run engine, schedule and dispatcher, designated-account Google access, PDF caps, redaction, DNS pinning, proposal jobs |

Recipe KPIs: stored as a KPI suggestion transform `{mode:'recipe', recipe, dimensionField?}`, checked
with the framework's `validateRecipe`, evaluated by Nexeo's engine with its pure `evaluateRecipe` —
same dry-run / change-cap / one-transaction rules. Monthly only; the running month is not counted.
**Not adopted:** the xlsx workbook readers (CVEs; a test fails if Nexeo imports them), per-integration
Drive OAuth (would bypass the designated account), the process-wide network policy, goal-specific
prompts.

## 2d. Fourth source: an MCP server, inbound (DEF-447, 2026-11-12)

Owner (CL-085): *"there are 2 type of MCP integration — Inbound: receive data from external mcp (we
need this) — Outbound: send data through mcp (hold this)"*, *"it should be part of existing
integration UI/UX with separate source"*.

**What the admin does.** Basics: choose **MCP server**. Connect: the server's address (https, often
ending in `/mcp`), how Nexeo signs in (None · Bearer token · API key header · username:password) and
the token (write-only box) → **List the tools** → pick the tool that returns the records (its name,
title and description are shown, and what it takes, from its own input schema) → its settings as JSON
(pre-filled only with the defaults its schema declares) → where the records are in its answer, how a
record is identified, where a total count is → **Test the connection**. Review, Schedule and Test &
turn on are unchanged.

**How it is kept.** `source_kind = 'mcp'` (migration `20261112_integrations_mcp_source`, widened
CHECK, no new column). The connection lives in `api_config` in the API connection's shape: `baseUrl` =
the MCP endpoint, `mcpTool` = the tool, `body` = its arguments, `recordsPath`, `idField`,
`declaredTotalPath`; `method` POST and no paging. The token is the same encrypted `secret_enc`, bound to
the address's origin. So the store's validation (credential-named settings refused), the fingerprint
(a changed tool, setting or token needs a new test), pause-before-edit and the Wiki/KPI writers are
the API's, unchanged.

**What Nexeo speaks** (`sources/mcpReader.ts`): MCP Streamable HTTP — JSON-RPC 2.0 POSTed to the
one endpoint, answered as JSON or as an event stream: `initialize` (protocol `2025-06-18`, the
server's answer is used after) → `notifications/initialized` → `tools/list` (follows `nextCursor`,
≤ 5 pages, ≤ 200 tools) or `tools/call`. The server's `Mcp-Session-Id` and the negotiated version
ride on every later request. Every request goes through the fetch guard; the token is attached only
by it; text the server sends back is scrubbed of the token before it reaches a screen or a log.

**Reading the answer.** `structuredContent` first; otherwise the text content, accepted only when it
IS JSON (several parts ⇒ a list of them). Prose is refused with what it said; `isError` is reported
with the tool's own words; an answer with no list says what it holds ("result (text) — a written
answer, not data"). The records are flattened exactly like an API's (dotted fields), so the field
inventory, proposer, filter, planner, records view and Context writer see one record shape. One call
per read: over `integrations.max_rows` ⇒ truncated (run PARTIAL); a declared total not reached ⇒
truncated.

**Checking a token.** The tool may not be chosen yet, so a new token is proven by the handshake and
the tool list (`testMcpTokenWith`), never by calling a tool; a failing token is not stored over a
working one.

**Not supported (said in words on the screen).** Servers that run only on a computer (stdio) and the
older SSE-only transport; OAuth sign-in flows (a token is pasted); a tool that pages its answer
(one call reads the first page — the declared-total check reports it).

**Verified.** 36 tests (`tests/def447IntegrationMcpSource.test.ts`, mutation-checked: session id,
structuredContent, row cap, auth attachment, JSON-only text). Live 11-12 against a public MCP server
(`mcp.deepwiki.com/mcp`, no sign-in): handshake over an event stream, 3 tools listed, tool called;
its answer was prose, and the message now says so.

## 3. Rules carried from vm §8/§9 (each pinned by a test that fails when weakened)

Blank never overwrites · identity/account fields unwritable · proposable ≠ writable (approval is
the only write permission, version-scoped) · permissions never accepted from the client (closed
PUT) · a new proposal keeps what is approved · one field, one owner (`kpi_definitions.source_integration_id`)
· field-wise approval, never per record · distinct-subject counts · change cap on scheduled runs
only · dry run and aborted run write nothing · audit = outcome, same transaction · unconfigured
target fails the run · failed run records no measurement · enabling never triggers a run · test
before turn-on, bound to version + connection fingerprint · the tested connection is the one runs
use · timestamptz everywhere · no model on the execution path · tenant scoping on every query.

## 4. Pre-existing defects found while designing (logged, not fixed in Stage 1)

DEF-355 global `WEBHOOK_SECRET` with tenant from URL (`webhookRoutes.ts`) · DEF-356 `configService`
key `slice(0,32)` truncation · DEF-357 `entitySweepService` tenant-less `person:*` primary key
(blocks the contacts writer) · DEF-358 `connectorService` plaintext fallback + unsigned OAuth state ·
DEF-359 `clientConnectorRoutes.pickTenant` cross-tenant override.

## 5. Owner questions — answered by default (say if you want otherwise)

1. Private sheets are read through the tenant's designated Google account (the one Admin → Client
   Connectors already uses). No new consent.
2. KPI numbers are tenant-wide business data (an admin set them up). Contacts, in Stage 2, follow
   the existing ruling: only the user decides a contact becomes tenant-wide.
3. Deleting an integration removes its history; the KPI readings it wrote stay.

## 6. Later stages

2a people/contacts (after DEF-357) · 2b feed events (needs recipient users — `FeedEvent` reads are
user-scoped — and an `ingest()` guard for publish/scribe/sentiment/propagation) · 2c knowledge
pages (through the existing `org_doc` upsert, not a second wiki writer) · 3 generic REST
(SSRF guard with pinned DNS, same-origin paging, declared-total completeness, test-before-store
credentials, DEF-356 fix first) · 4 Qlik (loopback only for `source_kind='qlik'` behind a
SuperAdmin-set per-tenant flag — the bridge has no tenant concept) and Odoo (reuse the per-tenant
`odoo_*` config). ~~Excel upload once a safe parser is pinned~~ — done (DEF-368, §2b). MCP server
inbound — done (DEF-447, §2d); outbound MCP held (owner 11-12).
