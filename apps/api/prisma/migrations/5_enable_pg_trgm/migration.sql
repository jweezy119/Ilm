-- pg_trgm backs the typo-tolerant third search pass in src/search/postgres.ts.
--
-- Enabled here rather than by hand so a fresh database gets the same search
-- behaviour as production. The extension is what provides word_similarity; without
-- it that pass fails with SQLSTATE 42883 instead of degrading.
--
-- No trgm index is created deliberately. An index over 45,453 verses is a large
-- object to carry for a pass that only runs when full-text and prefix search both
-- found nothing, and the pass is rare enough that the scan does not show.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Index for the relaxed second search pass. `%>>` (word_similarity greater than,
-- at pg_trgm.word_similarity_threshold) is the one operator that can use this;
-- spelling the comparison as `word_similarity(a, b) > 0.4` instead is a plain
-- filter and silently degrades to a scan of all 45k rows.
--
-- 13 MB on the current corpus, which is the point: the alternative is a
-- multi-second search for every term nobody types correctly.
CREATE INDEX IF NOT EXISTS passages_trgm_idx ON passages USING gin (primary_translation gin_trgm_ops);
