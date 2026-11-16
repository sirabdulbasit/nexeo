-- /v1/changes flags "calendar" after a successful Suzi calendar.cancel / update / create (Suzi Master AGREE, 16 Nov 2026).
-- One row per user: when Nexeo last changed his calendar on Suzi's word. Hand-written and idempotent; additive only.
CREATE TABLE IF NOT EXISTS suzi_calendar_touch (
  client_number TEXT        NOT NULL,
  user_id       INTEGER     NOT NULL,
  touched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_number, user_id)
);
