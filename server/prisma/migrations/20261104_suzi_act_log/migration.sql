-- Day contract, Phase 1 (spec 2026-11-04): POST /suzi/gateway/act, the one way Suzi writes to Nexeo.
-- One row per idempotency key: it claims the key BEFORE the work runs, stores the answer for
-- replays, and is the audit entry (its id is the audit_id returned to Suzi).
--
-- Hand-written and idempotent. Matches the SuziActLog model in schema.prisma column for column.
CREATE TABLE IF NOT EXISTS suzi_act_log (
  id                 TEXT          PRIMARY KEY,
  client_number      VARCHAR(20)   NOT NULL,
  user_id            INTEGER       NOT NULL,
  op                 VARCHAR(60)   NOT NULL,
  idempotency_key    VARCHAR(200)  NOT NULL,
  args_hash          CHAR(64)      NOT NULL,
  args               JSONB         NOT NULL DEFAULT '{}',
  confirmed_by_user  BOOLEAN       NOT NULL DEFAULT false,
  voice_score        DOUBLE PRECISION,
  status             VARCHAR(20)   NOT NULL DEFAULT 'running',
  result             JSONB,
  created_at         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ(6)
);
CREATE UNIQUE INDEX IF NOT EXISTS suzi_act_log_tenant_user_key_key ON suzi_act_log (client_number, user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS suzi_act_log_tenant_user_created_idx ON suzi_act_log (client_number, user_id, created_at);
