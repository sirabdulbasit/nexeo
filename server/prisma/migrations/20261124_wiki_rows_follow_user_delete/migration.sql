-- When a user row is deleted, remove that user's Wiki rows (no FK exists, so they were orphaned:
-- 41 rows of deleted users 1, 4, 5 found 19 Nov, deleted 24 Nov after backup). Idempotent.
CREATE OR REPLACE FUNCTION wiki_rows_follow_user_delete() RETURNS trigger AS $$
BEGIN
  DELETE FROM wiki_note_sources
   WHERE note_id IN (SELECT id FROM wiki_pages WHERE user_id = OLD.id)
      OR source_id IN (SELECT id FROM wiki_sources WHERE user_id = OLD.id);
  DELETE FROM wiki_page_links WHERE user_id = OLD.id;
  DELETE FROM wiki_pages WHERE user_id = OLD.id;
  DELETE FROM wiki_sources WHERE user_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_wiki_rows_follow_delete ON users;
CREATE TRIGGER users_wiki_rows_follow_delete
  AFTER DELETE ON users FOR EACH ROW EXECUTE FUNCTION wiki_rows_follow_user_delete();
