-- F-4 Meeting Assistant (Functional Charter, agreed 12 Nov 2026): one meeting record per meeting, per user.
-- Hand-written and idempotent. No sound is ever stored (F-4.4).

CREATE TABLE IF NOT EXISTS meeting_records (
  id               TEXT PRIMARY KEY,
  client_number    VARCHAR(50) NOT NULL,
  user_id          INT NOT NULL,
  -- 'event:<calendar event id>' or 'conf:<meet space>@<start ISO>': never the way it arrived (F-4.5)
  meeting_key      TEXT NOT NULL,
  event_id         TEXT,
  conference_record TEXT,
  space            TEXT,
  title            TEXT,
  platform         TEXT NOT NULL DEFAULT 'meet',
  start_at         TIMESTAMPTZ,
  end_at           TIMESTAMPTZ,
  way              TEXT NOT NULL,
  sources          JSONB NOT NULL DEFAULT '[]'::jsonb,
  participants     JSONB NOT NULL DEFAULT '[]'::jsonb,
  transcript       JSONB NOT NULL DEFAULT '[]'::jsonb,
  minutes          TEXT,
  minutes_offered  TEXT,
  minutes_edited   BOOLEAN NOT NULL DEFAULT FALSE,
  decisions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_items     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL,
  status_reason    TEXT,
  updated_flag     BOOLEAN NOT NULL DEFAULT FALSE,
  reread_due_at    TIMESTAMPTZ,
  trimmed_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_records_user_key_uidx ON meeting_records (client_number, user_id, meeting_key);
CREATE INDEX IF NOT EXISTS meeting_records_user_start_idx ON meeting_records (client_number, user_id, start_at DESC);
CREATE INDEX IF NOT EXISTS meeting_records_reread_idx ON meeting_records (reread_due_at) WHERE reread_due_at IS NOT NULL;

-- Workspace Events push deliveries, by CloudEvent id: a retry is acknowledged and not processed twice.
CREATE TABLE IF NOT EXISTS meet_event_receipts (
  event_id     TEXT PRIMARY KEY,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL DEFAULT 'received',
  detail       TEXT
);

-- One Workspace Events subscription per enabled user, renewed before it expires.
CREATE TABLE IF NOT EXISTS meet_event_subscriptions (
  name          TEXT PRIMARY KEY,
  client_number VARCHAR(50) NOT NULL,
  user_id       INT NOT NULL,
  expire_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meet_event_subscriptions_user_idx ON meet_event_subscriptions (client_number, user_id);
