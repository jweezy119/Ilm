-- A figure named across traditions, and the passages that name them.
--
-- Not another kind of cross_reference. A cross-reference relates two passages; a
-- figure is not a passage, so an edge for every attesting pair would be 26 × 963
-- edges for Jesus alone and almost none of them would mean anything. The relation
-- is passage → figure, which is a different shape.
--
-- `form` is the surface name found in that passage — عيسى, Ἰησοῦς, يسوع, יֵשׁוּעַ —
-- because the fact that one person is named four ways is most of what is
-- interesting about the relation, and a plain edge would have discarded it.
--
-- `stance` distinguishes attestation from polemic. The Talmud names Yeshu in a
-- handful of argumentative passages; that is evidence the name was in use and
-- evidence of a dispute, not a confession of the same figure. Filing those beside
-- the Gospels without the distinction would present a polemic as agreement, so the
-- distinction travels with the row rather than living in the interface.
CREATE TABLE "figures" (
    "id"         TEXT NOT NULL,
    "slug"       TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "basis"      JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "figures_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "figure_mentions" (
    "id"         TEXT NOT NULL,
    "figure_id"  TEXT NOT NULL,
    "passage_id" TEXT NOT NULL,
    "form"       TEXT NOT NULL,
    "stance"     TEXT NOT NULL DEFAULT 'attesting',
    CONSTRAINT "figure_mentions_pkey" PRIMARY KEY ("id")
);

-- One row per passage naming a figure, so a re-run cannot double count.
CREATE UNIQUE INDEX "figure_mentions_figure_id_passage_id_key"
    ON "figure_mentions"("figure_id", "passage_id");

-- The page reads by figure and stance; the passage page reads by passage.
CREATE INDEX "figure_mentions_figure_id_stance_idx" ON "figure_mentions"("figure_id", "stance");
CREATE INDEX "figure_mentions_passage_id_idx" ON "figure_mentions"("passage_id");
CREATE UNIQUE INDEX "figures_slug_key" ON "figures"("slug");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'figure_mentions_figure_id_fkey') THEN
        ALTER TABLE "figure_mentions"
            ADD CONSTRAINT "figure_mentions_figure_id_fkey"
            FOREIGN KEY ("figure_id") REFERENCES "figures"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        ALTER TABLE "figure_mentions"
            ADD CONSTRAINT "figure_mentions_passage_id_fkey"
            FOREIGN KEY ("passage_id") REFERENCES "passages"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
