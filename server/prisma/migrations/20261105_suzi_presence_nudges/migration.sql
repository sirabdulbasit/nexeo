-- Link T11, N1: the user has turned nudges off in Suzi's Settings. A critical item is then a silent card.
-- Idempotent by project rule.

ALTER TABLE suzi_presence ADD COLUMN IF NOT EXISTS nudges_off BOOLEAN NOT NULL DEFAULT FALSE;
