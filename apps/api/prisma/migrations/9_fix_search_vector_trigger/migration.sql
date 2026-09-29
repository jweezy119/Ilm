-- Repair a trigger function that made every insert into passages fail.
--
-- Migration 4 defined passages_refresh_search_vector with this line:
--
--     SELECT t.text INTO v_body
--     FROM passage_translations pt
--     JOIN translations tr ON tr.id = pt.translation_id
--     WHERE pt.passage_id = p_passage_id
--
-- The alias in that query is `pt`. `t` is defined by nothing, so the first
-- statement in the function raised:
--
--     42P01  missing FROM-clause entry for table "t"
--
-- The function is called by passages_search_vector_row on every insert, and on any
-- update of book_slug, text_id or primary_translation. So every INSERT into
-- passages has failed since migration 4 was applied, in every environment built from
-- this repository.
--
-- The 45,453 existing passages are unaffected: they predate the trigger, and
-- migration 4 backfilled their vectors with a separate statement that used the
-- correct alias. But no new passage could be written at all — which is what
-- blocked the hadith ingestion, and what made the failure so misleading: Prisma
-- surfaced the raw Postgres error as P2021 with the table reported as
-- "(not available)", which reads as a missing table rather than a broken trigger.
--
-- Migration 4 is corrected in place as well, so a fresh environment never installs
-- a broken function, and this one repairs the environments that already have it.
CREATE OR REPLACE FUNCTION passages_refresh_search_vector(p_passage_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_body text;
  v_themes text;
  v_meta text;
BEGIN
  -- The primary translation is the one marked as such on the passage, falling
  -- back to the first available so a passage is never unsearchable.
  SELECT pt.text INTO v_body
  FROM passage_translations pt
  JOIN translations tr ON tr.id = pt.translation_id
  WHERE pt.passage_id = p_passage_id
  ORDER BY (tr.is_primary) DESC NULLS LAST
  LIMIT 1;

  SELECT string_agg(DISTINCT pt.theme_id, ' ') INTO v_themes
  FROM passage_themes pt
  WHERE pt.passage_id = p_passage_id;

  SELECT p.book_slug || ' ' || p.text_id || ' ' || p.primary_translation INTO v_meta
  FROM passages p
  WHERE p.id = p_passage_id;

  UPDATE passages
  SET search_vector =
        setweight(to_tsvector('english', coalesce(v_body, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(v_themes, '')), 'B') ||
        setweight(to_tsvector('simple',   coalesce(v_meta,  '')), 'C')
  WHERE id = p_passage_id;
END;
$$;
