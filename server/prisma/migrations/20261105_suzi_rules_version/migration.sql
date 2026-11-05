-- Link T12, P1: the number on a user's rules for Suzi. It goes up only when the content's hash changes.
-- Idempotent by project rule.

CREATE TABLE IF NOT EXISTS suzi_rules_version (
  client_number TEXT        NOT NULL,
  user_id       INTEGER     NOT NULL,
  content_hash  TEXT        NOT NULL,
  version       INTEGER     NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_number, user_id)
);
