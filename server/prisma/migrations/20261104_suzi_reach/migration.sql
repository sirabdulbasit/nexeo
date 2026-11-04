-- Functional Charter, "Reminders and presence".
--
-- suzi_presence: the last presence frame per device, forwarded by Suzi's server. A user with no row
-- has not adopted Suzi's reach and is contacted exactly as before.
-- suzi_outbox: what Nexeo has for that user while it waits for the right moment. The ledger
-- (brain_user_messages) still gets its row, so caps and dedup keep working.
-- Idempotent by project rule.

CREATE TABLE IF NOT EXISTS suzi_presence (
  client_number      TEXT        NOT NULL,
  user_id            INTEGER     NOT NULL,
  device_id          TEXT        NOT NULL,
  state              TEXT        NOT NULL CHECK (state IN ('active', 'away', 'locked', 'asleep', 'paused')),
  state_since        TIMESTAMPTZ NOT NULL,
  last_frame_at      TIMESTAMPTZ NOT NULL,
  last_alive_at      TIMESTAMPTZ,
  brief_handover_at  TIMESTAMPTZ,
  PRIMARY KEY (client_number, user_id, device_id)
);

CREATE TABLE IF NOT EXISTS suzi_outbox (
  id            BIGSERIAL   PRIMARY KEY,
  client_number TEXT        NOT NULL,
  user_id       INTEGER     NOT NULL,
  kind          TEXT        NOT NULL,
  summary       TEXT        NOT NULL,
  body          TEXT,
  urgency       TEXT        NOT NULL,
  provenance    TEXT,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  state         TEXT        NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'delivered', 'expired')),
  delivered_how TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  carded_at     TIMESTAMPTZ,
  emailed_at    TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS suzi_outbox_held_idx ON suzi_outbox (client_number, user_id, created_at) WHERE state = 'held';

ALTER TABLE brain_user_messages DROP CONSTRAINT IF EXISTS brain_user_messages_channel_check;
ALTER TABLE brain_user_messages
  ADD CONSTRAINT brain_user_messages_channel_check
  CHECK (channel IN ('text', 'voicenote', 'call_cta', 'call_business', 'auto', 'email', 'suzi'));
