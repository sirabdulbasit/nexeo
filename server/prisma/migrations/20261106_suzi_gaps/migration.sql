-- Link T28 items 1-3 (both AGREE, 6 Nov 2026): build control. Gaps the user reports by voice to any Suzi,
-- approved by him, sorted by Nexeo's builder and handed to the builder who fixes them. No AI anywhere.
-- His words stay here; only a cleaned description leaves (written by the builder, not stored by this table).
-- Idempotent by project rule.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS suzi_gaps (
  gap_no        BIGSERIAL   PRIMARY KEY,                 -- the stable id, shown as G-<gap_no>
  client_number TEXT        NOT NULL,
  user_id       INTEGER     NOT NULL,
  said          TEXT        NOT NULL,                    -- his words, as said (latest report)
  what          TEXT        NOT NULL,                    -- what should have happened / what was wrong
  seen_on       TEXT,                                    -- where: a screen, a board, a device
  source        TEXT        NOT NULL DEFAULT 'training', -- training | live
  norm          TEXT        NOT NULL,                    -- normalised `what`, for merging duplicates
  count         INTEGER     NOT NULL DEFAULT 1,
  reports       JSONB       NOT NULL DEFAULT '[]'::jsonb,-- the last 10 {at, said, seen_on, device_id}
  state         TEXT        NOT NULL DEFAULT 'new',
  owner         TEXT,                                    -- nexeo | suzi | factory, set when sorted
  handover      TEXT,                                    -- the link file it was handed over in
  built_version TEXT,
  approved_at   TIMESTAMPTZ,
  approved_by   TEXT,
  first_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE suzi_gaps ADD CONSTRAINT suzi_gaps_state_chk CHECK (state IN ('new', 'approved', 'sorted', 'in_build', 'live', 'declined'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE suzi_gaps ADD CONSTRAINT suzi_gaps_owner_chk CHECK (owner IS NULL OR owner IN ('nexeo', 'suzi', 'factory'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE suzi_gaps ADD CONSTRAINT suzi_gaps_source_chk CHECK (source IN ('training', 'live'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS suzi_gaps_user_last_ix ON suzi_gaps (client_number, user_id, last_at DESC);
CREATE INDEX IF NOT EXISTS suzi_gaps_state_ix ON suzi_gaps (state, last_at DESC);
