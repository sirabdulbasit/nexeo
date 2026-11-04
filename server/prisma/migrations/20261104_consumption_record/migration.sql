-- Costing Charter, the consumption record (founder approved 2026-11-04). Nexeo keeps the one record
-- of what Suzi's server and the desktop app used. Nexeo's own use stays in llm_spend and is read
-- alongside this. Counts only: never speech, transcripts, prompts or any content.
--
-- Also: llm_spend gains cached_tokens now that Nexeo records Google's real counts; suzi_act_log gains
-- device_id (Functional Charter, row 18: "from which device").
-- Hand-written and idempotent.
CREATE TABLE IF NOT EXISTS consumption_events (
  id               BIGSERIAL      PRIMARY KEY,
  client_number    VARCHAR(20)    NOT NULL,
  user_id          INTEGER,
  part             VARCHAR(20)    NOT NULL,
  service          VARCHAR(60)    NOT NULL,
  model            VARCHAR(80),
  unit             VARCHAR(20)    NOT NULL,
  units            NUMERIC(18,3)  NOT NULL DEFAULT 0,
  input_tokens     INTEGER        NOT NULL DEFAULT 0,
  cached_tokens    INTEGER        NOT NULL DEFAULT 0,
  output_tokens    INTEGER        NOT NULL DEFAULT 0,
  thinking_tokens  INTEGER        NOT NULL DEFAULT 0,
  est_usd          NUMERIC(14,6)  NOT NULL DEFAULT 0,
  measured         BOOLEAN        NOT NULL DEFAULT true,
  day              DATE           NOT NULL,
  device_id        VARCHAR(60),
  os               VARCHAR(20),
  source_key       VARCHAR(260),
  created_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS consumption_events_source_key_key ON consumption_events (client_number, source_key);
CREATE INDEX IF NOT EXISTS consumption_events_tenant_day_idx ON consumption_events (client_number, day);
CREATE INDEX IF NOT EXISTS consumption_events_tenant_user_day_idx ON consumption_events (client_number, user_id, day);

ALTER TABLE llm_spend ADD COLUMN IF NOT EXISTS cached_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suzi_act_log ADD COLUMN IF NOT EXISTS device_id VARCHAR(60);
