-- When a Sefaria-derived translation was last checked against Sefaria itself.
--
-- Some Torah rows were written by a markup stripper that untagged inline
-- footnotes instead of removing them, so a translator's note runs into the middle
-- of the verse: Genesis 1:1 as "When God began to createaWhen God began to create
-- In contrast to others "In the beginning God created." heaven and earth—". The
-- stripper was fixed and tested; the rows were not, because the writing script
-- only inserted what was missing and so could not carry a correction.
--
-- Repairing by pattern was tried and abandoned. The damage has no reliable
-- signature: "createaWhen" is caught by a letter welded to a capital, but
-- "wasawithout" is not, and any pattern loose enough to catch that also matches
-- ordinary words like "and". So the row itself records whether it has been
-- compared with Sefaria's current text, and the repair is a difference rather
-- than a guess.
--
-- NULL means "not yet checked", which is every existing row — so the first boot
-- after this migration walks the Sefaria corpora once and later boots find
-- nothing to do. It is per row rather than per translation so an interrupted run
-- resumes exactly where it stopped instead of re-fetching whole chapters.
--
-- Nullable and ignored by everything except this repair. Nothing else reads it,
-- so it can be dropped without touching a query.

ALTER TABLE passage_translations
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP(3);

-- The repair's only access path: unverified rows, for these corpora, oldest
-- first so the worst corpus is dealt with before a time budget runs out.
CREATE INDEX IF NOT EXISTS passage_translations_unverified_idx
  ON passage_translations (verified_at)
  WHERE verified_at IS NULL;
