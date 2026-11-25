-- Meeting record standard (founder 24 Nov 2026, via Suzi-Builder 13:28; Nexeo AGREE 25 Nov): minutes are the main page.
-- Structured fields beside the minutes text, the English transcript beside the original, and a history of transcript
-- corrections. Idempotent: safe to run more than once.
ALTER TABLE meeting_records ADD COLUMN IF NOT EXISTS record_fields    JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE meeting_records ADD COLUMN IF NOT EXISTS transcript_en    JSONB;
ALTER TABLE meeting_records ADD COLUMN IF NOT EXISTS transcript_edits JSONB NOT NULL DEFAULT '[]'::jsonb;
