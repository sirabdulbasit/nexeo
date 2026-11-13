-- Wiki structure part 8 (docs/Wiki-Knowledge.md §0.13, §0.11 item 4): a source knows which
-- version of its text it holds.
--
-- Until now a source kept its text and a fingerprint, but not WHEN that text was fetched nor
-- whether it was only a preview. So a corrected text of the same length could not be told from
-- the old one, and an older text arriving late could replace a newer one.
--
--   body_as_of       when the text the source holds was fetched
--   body_is_preview  the text is a preview (an email snippet): any full text replaces it
--
-- Hand-written and idempotent. Additive: two columns, and two fills that only set what is unset.

ALTER TABLE wiki_sources ADD COLUMN IF NOT EXISTS body_as_of TIMESTAMPTZ;
ALTER TABLE wiki_sources ADD COLUMN IF NOT EXISTS body_is_preview BOOLEAN NOT NULL DEFAULT FALSE;

-- Text landed before this column existed is dated by the row's last change.
UPDATE wiki_sources
   SET body_as_of = updated_at
 WHERE body_as_of IS NULL AND content_hash IS NOT NULL;

-- An email source whose text is exactly its feed item's snippet holds a preview, not the email.
UPDATE wiki_sources s
   SET body_is_preview = TRUE
  FROM feed_events f
 WHERE f.id = s.feed_event_id
   AND s.kind = 'email' AND s.body_is_preview = FALSE AND s.body_enc IS NULL
   AND btrim(coalesce(f.raw_payload->>'snippet', '')) <> ''
   AND s.body_text = btrim(f.raw_payload->>'snippet');
