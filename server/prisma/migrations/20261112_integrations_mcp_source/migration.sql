-- DEF-447 — Integrations: an outside system's MCP server as a source (inbound only).
-- Owner 2026-11-12 (CL-085): "there are 2 type of MCP integration — Inbound: receive data from
-- external mcp (we need this) — Outbound: send data through mcp (hold this)"; "it should be part
-- of existing integration UI/UX with separate source".
--
-- ADDITIVE on top of 20261031_integrations_file_source. Hand-written and idempotent: the widened
-- CHECK is DROP CONSTRAINT IF EXISTS followed by a guarded ADD inside one DO $$ block, so a
-- re-apply drops and re-adds the SAME wider rule and every existing 'gsheet' / 'api' / 'file'
-- row still satisfies it. No new column: an MCP connection lives in api_config (address,
-- sign-in, records path, id field, mcpTool, body = the tool's arguments) and its token in the
-- existing encrypted secret_enc.

DO $$ BEGIN
  ALTER TABLE integration_syncs DROP CONSTRAINT IF EXISTS integration_syncs_enums_check;
  BEGIN
    ALTER TABLE integration_syncs ADD CONSTRAINT integration_syncs_enums_check CHECK (
          status IN ('DRAFT','ACTIVE','PAUSED')
      AND frequency IN ('daily','weekly','monthly','once')
      AND source_kind IN ('gsheet','api','file','mcp')
      AND blank_policy IN ('normal','abnormal')
      AND (last_run_status IS NULL OR last_run_status IN ('RUNNING','SUCCESS','PARTIAL','FAILED','ABORTED'))
    );
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
