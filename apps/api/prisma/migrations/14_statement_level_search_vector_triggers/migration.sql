-- Statement-level search vector triggers and duplicate index cleanup.
--
-- Migration 4 installed FOR EACH ROW triggers on `passage_themes` and
-- `passage_translations`, so a batched `createMany` of 2,500 theme rows fired
-- `passages_refresh_search_vector()` 2,500 times — issuing 10,000 inner queries
-- and 2,500 GIN index updates (multiple times for the same passage when a verse
-- carries 3-5 themes).
--
-- Replacing them with FOR EACH STATEMENT transition-table triggers runs one
-- set-based UPDATE over the distinct affected passage IDs per statement, skips
-- heap/GIN writes when `search_vector` is unchanged, and also refreshes on
-- DELETE (which the old row-level trigger skipped).
--
-- Also drops two redundant B-tree indexes (`passages_passage_key_idx` and
-- `texts_text_id_idx`) whose columns already carry UNIQUE indexes.

CREATE OR REPLACE FUNCTION passages_refresh_search_vector_many(p_passage_ids text[])
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_passage_ids IS NULL OR cardinality(p_passage_ids) = 0 THEN
    RETURN;
  END IF;

  UPDATE passages p
  SET search_vector = next.vec
  FROM (
    SELECT
      target.id,
      setweight(to_tsvector('english', coalesce(tr_text.text, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(th.names, '')), 'B') ||
      setweight(to_tsvector('simple', p2.book_slug || ' ' || p2.text_id || ' ' || p2.primary_translation), 'C') AS vec
    FROM (SELECT DISTINCT unnest(p_passage_ids) AS id) target
    JOIN passages p2 ON p2.id = target.id
    LEFT JOIN LATERAL (
      SELECT t2.text
      FROM passage_translations t2
      JOIN translations tr2 ON tr2.id = t2.translation_id
      WHERE t2.passage_id = target.id
      ORDER BY (tr2.is_primary) DESC NULLS LAST
      LIMIT 1
    ) tr_text ON true
    LEFT JOIN LATERAL (
      SELECT string_agg(DISTINCT pt2.theme_id, ' ') AS names
      FROM passage_themes pt2
      WHERE pt2.passage_id = target.id
    ) th ON true
  ) next
  WHERE p.id = next.id
    AND p.search_vector IS DISTINCT FROM next.vec;
END;
$$;

CREATE OR REPLACE FUNCTION passages_search_vector_stmt_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ids text[];
BEGIN
  SELECT array_agg(DISTINCT passage_id) INTO v_ids FROM new_rows;
  PERFORM passages_refresh_search_vector_many(v_ids);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION passages_search_vector_stmt_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ids text[];
BEGIN
  SELECT array_agg(DISTINCT passage_id) INTO v_ids
  FROM (
    SELECT passage_id FROM new_rows
    UNION
    SELECT passage_id FROM old_rows
  ) affected;
  PERFORM passages_refresh_search_vector_many(v_ids);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION passages_search_vector_stmt_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ids text[];
BEGIN
  SELECT array_agg(DISTINCT passage_id) INTO v_ids FROM old_rows;
  PERFORM passages_refresh_search_vector_many(v_ids);
  RETURN NULL;
END;
$$;

-- Replace row-level triggers on passage_themes with statement-level triggers.
DROP TRIGGER IF EXISTS passage_themes_search_vector ON passage_themes;

CREATE TRIGGER passage_themes_search_vector_ins
  AFTER INSERT ON passage_themes
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION passages_search_vector_stmt_insert();

CREATE TRIGGER passage_themes_search_vector_upd
  AFTER UPDATE ON passage_themes
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION passages_search_vector_stmt_update();

CREATE TRIGGER passage_themes_search_vector_del
  AFTER DELETE ON passage_themes
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION passages_search_vector_stmt_delete();

-- Replace row-level triggers on passage_translations with statement-level triggers.
DROP TRIGGER IF EXISTS passage_translations_search_vector ON passage_translations;

CREATE TRIGGER passage_translations_search_vector_ins
  AFTER INSERT ON passage_translations
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION passages_search_vector_stmt_insert();

CREATE TRIGGER passage_translations_search_vector_upd
  AFTER UPDATE ON passage_translations
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION passages_search_vector_stmt_update();

CREATE TRIGGER passage_translations_search_vector_del
  AFTER DELETE ON passage_translations
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION passages_search_vector_stmt_delete();

-- Redundant with the UNIQUE indexes created by @unique on passages.passage_key
-- and texts.text_id.
DROP INDEX IF EXISTS passages_passage_key_idx;
DROP INDEX IF EXISTS texts_text_id_idx;
