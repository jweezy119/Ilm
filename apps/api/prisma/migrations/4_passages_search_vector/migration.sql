-- Full-text search in Postgres, so the index stops living in the API's RAM.
--
-- Why this exists: Orama holds every indexed passage in the web process, at a
-- measured ~35 KB per document, which caps a 512 MB instance at roughly 13,000
-- passages. The corpus is 45,453, and the Old Testament alone is 23,145. The
-- limit was the instance, not the data, and the database was already holding
-- everything for free.
--
-- What is indexed, and why each part:
--
--   primary translation text  The scripture itself, in English. Note that the
--                             in-process index never contained this: it indexed
--                             theme names, book slugs and translation names, so
--                             "mercy" matched because passages carry a theme
--                             called mercy, not because the word appears in them.
--   theme names               Preserves that behaviour, so nothing that used to
--                             be findable stops being findable.
--   book slug                 "genesis" finds Genesis.
--
-- A generated column cannot be used here: a passage's text lives in
-- passage_translations and its themes in passage_themes, and a generated column
-- may not reference another table. A trigger is the honest mechanism, and it also
-- means the vector cannot drift from the data the way a build-once index can.
--
-- English config: the indexed text is the English translation, so stemming is
-- right for it. original_text is deliberately left out — the same reason the
-- in-process index left it out is that stemming English rules over Arabic, Hebrew
-- and Aramaic produces nothing useful.

ALTER TABLE passages
  ADD COLUMN search_vector tsvector;

CREATE INDEX passages_search_vector_idx ON passages USING GIN (search_vector);

-- Rebuild the vector for one passage from its translation and its themes.
CREATE OR REPLACE FUNCTION passages_refresh_search_vector(p_passage_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_body text;
  v_themes text;
  v_meta text;
BEGIN
  -- The primary translation is the one marked as such on the passage, falling
  -- back to the first available so a passage is never unsearchable.
  -- `pt.text`, not `t.text`. The alias in this query is pt; `t` is defined by
  -- nothing, so Postgres raised 42P01 "missing FROM-clause entry for table t" the
  -- first time the trigger fired, which is on every insert into passages. It meant
  -- the database silently stopped accepting new passages for as long as this
  -- function existed, and the failure surfaced as Prisma P2021 with the table
  -- reported as "(not available)" — which reads like a missing table and is not.
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

-- Both relations feed the vector, so both have to maintain it.
CREATE OR REPLACE FUNCTION passages_search_vector_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  PERFORM passages_refresh_search_vector(NEW.passage_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER passage_translations_search_vector
  AFTER INSERT OR UPDATE OR DELETE ON passage_translations
  FOR EACH ROW EXECUTE FUNCTION passages_search_vector_trigger();

-- Passage rows themselves carry book_slug, and their theme links change when a
-- theme is re-scored, so those paths refresh the vector too.
CREATE OR REPLACE FUNCTION passages_search_vector_row()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  PERFORM passages_refresh_search_vector(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER passages_search_vector_row
  AFTER INSERT OR UPDATE OF book_slug, text_id, primary_translation ON passages
  FOR EACH ROW EXECUTE FUNCTION passages_search_vector_row();

CREATE TRIGGER passage_themes_search_vector
  AFTER INSERT OR UPDATE OR DELETE ON passage_themes
  FOR EACH ROW EXECUTE FUNCTION passages_search_vector_trigger();

-- Backfill existing rows. Ingestion is idempotent, so this is safe to re-run.
--
-- A single UPDATE, not a batched loop. The loop was there to avoid holding every
-- vector in memory at once, but that limit belongs to the API's 512 MB instance,
-- not to the database, which is a separate machine with its own memory. Trading
-- a simple statement for a loop that raised "query returned more than one row" on
-- the first attempt was the wrong trade.
UPDATE passages p
SET search_vector =
      setweight(to_tsvector('english', coalesce(tr_text.text, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(th.names, '')), 'B') ||
      setweight(to_tsvector('simple', p.book_slug || ' ' || p.text_id || ' ' || p.primary_translation), 'C')
FROM passages p2
LEFT JOIN LATERAL (
  SELECT t2.text
  FROM passage_translations t2
  JOIN translations tr2 ON tr2.id = t2.translation_id
  WHERE t2.passage_id = p2.id
  ORDER BY (tr2.is_primary) DESC NULLS LAST
  LIMIT 1
) tr_text ON true
LEFT JOIN LATERAL (
  SELECT string_agg(DISTINCT pt2.theme_id, ' ') AS names
  FROM passage_themes pt2
  WHERE pt2.passage_id = p2.id
) th ON true
WHERE p2.id = p.id;
