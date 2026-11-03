-- DEF-386 — the screen operator (Suzi does the clicking).
-- Owner request 2026-11-03 (CL-062): a central computer operator in Nexeo after Suzi
-- claimed "I clicked Download" eight times on Mixamo and downloaded nothing.
--
-- Hand-written and idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Matches the OperatorSettings / OperatorRun models in schema.prisma column for column.
--
--   * operator_settings: one row per tenant. No row = defaults: OFF, no consent. The
--     operator never runs without consent_at set by a tenant admin.
--   * operator_runs: usage and outcome per run (steps, tokens, cost). No screenshots and
--     no typed text are ever stored: screenshots live in memory for the run only.

CREATE TABLE IF NOT EXISTS operator_settings (
  client_number       VARCHAR(20)  PRIMARY KEY,
  enabled             BOOLEAN      NOT NULL DEFAULT false,
  model               VARCHAR(20)  NOT NULL DEFAULT 'claude',
  claude_model        VARCHAR(60)  NOT NULL DEFAULT 'claude-opus-5-5',
  uitars_base_url     VARCHAR(300),
  uitars_model        VARCHAR(100) NOT NULL DEFAULT 'ui-tars-1.5-7b',
  consent_at          TIMESTAMPTZ(6),
  consent_by          INTEGER,
  private_mode        BOOLEAN      NOT NULL DEFAULT false,
  blank_apps          TEXT[]       NOT NULL DEFAULT '{}',
  retention           VARCHAR(20)  NOT NULL DEFAULT 'none',
  monthly_task_limit  INTEGER      NOT NULL DEFAULT 100,
  monthly_step_limit  INTEGER      NOT NULL DEFAULT 3000,
  max_steps           INTEGER      NOT NULL DEFAULT 30,
  updated_by          INTEGER,
  updated_at          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT operator_settings_model_check CHECK (model IN ('claude','uitars')),
  CONSTRAINT operator_settings_retention_check CHECK (retention IN ('none'))
);

CREATE TABLE IF NOT EXISTS operator_runs (
  id                  TEXT         PRIMARY KEY,
  client_number       VARCHAR(20)  NOT NULL,
  user_id             INTEGER      NOT NULL,
  goal                VARCHAR(1000) NOT NULL,
  model               VARCHAR(100) NOT NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'running',
  steps               INTEGER      NOT NULL DEFAULT 0,
  actions             INTEGER      NOT NULL DEFAULT 0,
  input_tokens        INTEGER      NOT NULL DEFAULT 0,
  output_tokens       INTEGER      NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER      NOT NULL DEFAULT 0,
  cache_write_tokens  INTEGER      NOT NULL DEFAULT 0,
  cost_usd            DECIMAL(10,4) NOT NULL DEFAULT 0,
  verified            BOOLEAN,
  summary             VARCHAR(2000),
  started_at          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  ended_at            TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS operator_runs_tenant_started_idx ON operator_runs (client_number, started_at);
CREATE INDEX IF NOT EXISTS operator_runs_tenant_user_status_idx ON operator_runs (client_number, user_id, status);
