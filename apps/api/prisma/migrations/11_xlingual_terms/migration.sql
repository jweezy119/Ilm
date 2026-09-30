-- Cross-lingual theme terms, so an English concept query can reach the corpora
-- it is not written in.
--
-- The gap this closes. Postgres searches `search_vector` (the English
-- translation, 'english' config) and `search_vector_original` (the source text,
-- 'simple' config). Search widens a recognised theme with that theme's *English*
-- keywords, from themeSearchTerms(). So a reader searching "mercy" is widened to
-- "compassion forgiving gracious" and every one of those is still English: the
-- expansion cannot reach רחמים, ἔλεος or رَحْمَة, and it does not need to, because
-- the English translation of the passage already contains the English word.
--
-- What that means in practice is that the original-language vectors do real work
-- for someone who types Hebrew and nothing at all for everyone else. The claim
-- the homepage makes — that the texts are searchable in the languages they were
-- written in — was true only for readers already able to read those languages,
-- which is the one group for whom the interface is not the point.
--
-- These terms are derived, not authored. scripts/build-xlingual-terms.ts takes the
-- passages that score highest on a theme, reads what is actually in their original
-- text, and keeps only the words whose distribution inside that theme is far more
-- concentrated than it is corpus-wide. No model, no dictionary, no new source.
--
-- `in_passages` and `specificity` are kept rather than discarded, because they are
-- the evidence for why a term is here. A term that appears in twenty themes' top
-- passages tells you nothing about any of them however common it is, and that ratio
-- is what `specificity` is. If a row is ever wrong, these two columns are how you
-- find out why.

CREATE TABLE IF NOT EXISTS xlingual_terms (
  id          TEXT PRIMARY KEY DEFAULT ('xl_' || md5(random()::text))::TEXT,
  -- Theme.name, not Theme.id, for the same reason PassageTheme stores the name:
  -- these are looked up by taxonomy slug from a query string, and a readable
  -- stable key is worth more here than a normalised foreign key.
  theme       TEXT NOT NULL,
  language    TEXT NOT NULL, -- hebrew | greek | arabic | aramaic
  -- The term in the corpus's own orthography, vocalised where the corpus is. It is
  -- folded at query time by the same normaliser the index used, which is the only
  -- reason the two sides cannot drift.
  term        TEXT NOT NULL,
  in_passages INTEGER NOT NULL DEFAULT 0,
  specificity REAL NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Re-running the derivation is idempotent: the same theme and term is one row,
  -- upserted, so a corpus change updates the numbers instead of duplicating them.
  UNIQUE (theme, language, term)
);

-- The search path looks terms up by theme, so that is the index that matters. The
-- read is a single equality on theme for one theme's handful of terms.
CREATE INDEX IF NOT EXISTS xlingual_terms_theme_idx ON xlingual_terms (theme);

COMMENT ON TABLE xlingual_terms IS
  'Original-language terms per theme, derived from the corpus. Used to widen a concept query into the languages it was not typed in. Every result reached this way is labelled as a widened match, never as a literal one.';
