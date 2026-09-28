-- Counting embedded passages.
--
-- The question is "which passages have a real vector", and the honest answer
-- needs jsonb_array_length. Two things made that expensive or unsafe:
--
--   jsonb_array_length(...) > 0        correct, but a full scan of 45,453 rows
--   embeddings IS NOT NULL             instant, and wrong: it is true for an empty
--                                       array, so it reported every row as embedded
--
-- The second is worse than a slow answer. It reported 45,453 of 45,453 on a
-- corpus where 16,853 passages held '[]', and the interface repeated it.
--
-- jsonb_array_length raises 22023 on a JSON null, so the indexed expression is
-- only safe if no row can hold one. This constraint is what makes it safe: a
-- passage is either SQL NULL (not embedded) or a real array. SQL NULL returns
-- NULL from jsonb_array_length, which the comparison drops, so the fast form is
-- exact rather than merely convenient.
--
-- The writer already only ever stores a vector or leaves the column unset, so
-- this changes no behaviour — it makes the invariant explicit and enforces it.
ALTER TABLE passages
  ADD CONSTRAINT passages_embeddings_is_array
  CHECK (embeddings IS NULL OR jsonb_typeof(embeddings) = 'array');

-- jsonb_array_length is immutable, so the expression can be indexed. This is
-- what turns a 4.3 s scan into a 33 ms index lookup, and it also serves any
-- future query that asks what is still missing.
CREATE INDEX passages_embedding_length_idx ON passages ((jsonb_array_length(embeddings)));
