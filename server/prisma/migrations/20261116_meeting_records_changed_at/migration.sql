-- /v1/changes flags "calendar" when one of his meeting records really changed (suzi-b5 AGREE, 16 Nov 2026):
-- status or reason, or its notes/items. updated_at moves on every write, so it cannot be the test.
-- Hand-written and idempotent; additive only.
ALTER TABLE meeting_records ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ;
UPDATE meeting_records SET changed_at = updated_at WHERE changed_at IS NULL;
ALTER TABLE meeting_records ALTER COLUMN changed_at SET DEFAULT now();
ALTER TABLE meeting_records ALTER COLUMN changed_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS meeting_records_changed_idx ON meeting_records (client_number, user_id, changed_at);
