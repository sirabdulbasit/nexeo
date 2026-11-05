-- CN-011: the user is in a meeting. They count as alive, but what would be spoken waits until it ends.
-- Idempotent by project rule.

ALTER TABLE suzi_presence ADD COLUMN IF NOT EXISTS meeting BOOLEAN NOT NULL DEFAULT FALSE;
