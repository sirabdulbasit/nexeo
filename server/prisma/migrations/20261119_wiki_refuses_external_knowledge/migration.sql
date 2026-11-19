-- Client Owned Data, the last door (founder, 19 Nov 2026; docs/Wiki-Knowledge.md §0.6).
-- The Wiki's code doors (saveSource, writeNote) refuse a Client Owned Data user's data, but a review the
-- same day found a dozen older writers that insert into wiki_pages directly (feed hooks, scribe, backfill,
-- the cognitive worker, contacts, mirrors). Closing each caller is how a class gets a thirteenth member.
-- So the tables themselves refuse: no row is inserted for a user whose knowledge model is not 'nexeo',
-- whoever the writer is. What stays in Nexeo passes: his identity and profile records, the learned rows,
-- his "How to work with" note and learned notes (the same rule as services/wiki/knowledgeModel.ts).
-- A user that does not exist is refused too (fails closed).
-- Hand-written and idempotent. No existing row is touched.
CREATE OR REPLACE FUNCTION wiki_refuse_external_knowledge() RETURNS trigger AS $$
DECLARE
  model TEXT;
BEGIN
  SELECT knowledge_model INTO model FROM users WHERE id = NEW.user_id AND client_number = NEW.client_number;
  IF model = 'nexeo' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'wiki_sources' THEN
    IF NEW.kind = 'record' AND (
         NEW.details->>'type' IN ('identity', 'profile')
      OR NEW.details->>'store' IN ('governed_brain_memories', 'user_memories', 'user_learning', 'pattern_insights', 'thought_entries')
    ) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'wiki_pages' THEN
    IF NEW.page_type = 'learned'
       OR (NEW.page_type = 'person' AND NEW.metadata->'ids' = jsonb_build_array('profile:user:' || NEW.user_id)) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'external_knowledge: nothing is stored in the Nexeo wiki for user % of % (%)', NEW.user_id, NEW.client_number, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wiki_pages_refuse_external_knowledge ON wiki_pages;
CREATE TRIGGER wiki_pages_refuse_external_knowledge
  BEFORE INSERT OR UPDATE OF user_id, client_number, page_type ON wiki_pages
  FOR EACH ROW EXECUTE FUNCTION wiki_refuse_external_knowledge();

DROP TRIGGER IF EXISTS wiki_sources_refuse_external_knowledge ON wiki_sources;
CREATE TRIGGER wiki_sources_refuse_external_knowledge
  BEFORE INSERT OR UPDATE OF user_id, client_number, kind ON wiki_sources
  FOR EACH ROW EXECUTE FUNCTION wiki_refuse_external_knowledge();
