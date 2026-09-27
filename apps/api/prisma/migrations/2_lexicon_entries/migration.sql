-- Lexicon entries from published dictionaries, cached per word.
--
-- The lookup key has its pointing stripped so every vocalisation of a root shares
-- one row, while the dictionary's own headword is kept for display.
CREATE TABLE "lexicon_entries" (
    "id" TEXT NOT NULL,
    "lookup_word" TEXT NOT NULL,
    "headword" TEXT NOT NULL,
    "lexicon" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'hebrew',
    "transliteration" TEXT,
    "strong_number" TEXT,
    "morphology" TEXT,
    "senses" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lexicon_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lexicon_entries_lookup_word_lexicon_headword_key"
    ON "lexicon_entries"("lookup_word", "lexicon", "headword");

CREATE INDEX "lexicon_entries_lookup_word_idx" ON "lexicon_entries"("lookup_word");
