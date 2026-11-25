-- Wiki standard structure (founder, 25 Nov 2026; Wiki-Knowledge §0.31). Idempotent.
-- Run AFTER src/scripts/wikiLandIntegrationSources.ts has landed every integration row as a source.

-- 1. Integration rows stop being notes: their Wiki links go, the marker goes. The engine keeps the row
--    for its own diff; the data is in wiki_sources (kind 'record', store 'integration').
DELETE FROM wiki_page_links l USING wiki_pages p
 WHERE (l.from_page_id = p.id OR l.to_page_id = p.id)
   AND p.page_type NOT IN ('person','company','group','meeting','project','topic','decision','commitment',
                           'document','conversation','rule','learned','system','kpi','business_unit')
   AND p.metadata->>'wiki' = '2';
UPDATE wiki_pages
   SET metadata = metadata - 'wiki' - 'unresolvedLinks' - 'ambiguousLinks', inbound_links = 0, outbound_links = 0
 WHERE metadata->>'wiki' = '2'
   AND page_type NOT IN ('person','company','group','meeting','project','topic','decision','commitment',
                         'document','conversation','rule','learned','system','kpi','business_unit');

-- 2. The last door: no Wiki note of a type outside the standard structure, whoever writes it.
--    The same list is NOTE_TYPES in src/services/wiki/wikiStructure.ts (tests/wikiStructure.test.ts keeps them equal).
CREATE OR REPLACE FUNCTION wiki_notes_standard_types() RETURNS trigger AS $$
BEGIN
  IF NEW.metadata->>'wiki' = '2' AND NEW.page_type NOT IN
     ('person','company','group','meeting','project','topic','decision','commitment',
      'document','conversation','rule','learned','system','kpi','business_unit') THEN
    RAISE EXCEPTION 'wiki_structure: "%" is not a Wiki note type; land the data as a source (Wiki-Knowledge §0.31)', NEW.page_type
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wiki_pages_standard_types ON wiki_pages;
CREATE TRIGGER wiki_pages_standard_types
  BEFORE INSERT OR UPDATE ON wiki_pages FOR EACH ROW EXECUTE FUNCTION wiki_notes_standard_types();
