-- Per-dimension affinity between two passages, judged once and reused.
--
-- The five dimension scores are stored without a composite because only the
-- composite depends on the reader's weights. Storing dimensions alone lets the
-- weight sliders re-rank without asking the model again.
CREATE TABLE "passage_affinities" (
    "id" TEXT NOT NULL,
    "source_passage_id" TEXT NOT NULL,
    "target_passage_id" TEXT NOT NULL,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'jev',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passage_affinities_pkey" PRIMARY KEY ("id")
);

-- One row per ordered pair: the relation is directional, because asking "what is
-- close to this passage" and its reverse are different questions.
CREATE UNIQUE INDEX "passage_affinities_source_passage_id_target_passage_id_key"
    ON "passage_affinities"("source_passage_id", "target_passage_id");

CREATE INDEX "passage_affinities_source_passage_id_idx" ON "passage_affinities"("source_passage_id");

ALTER TABLE "passage_affinities"
    ADD CONSTRAINT "passage_affinities_source_passage_id_fkey"
    FOREIGN KEY ("source_passage_id") REFERENCES "passages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "passage_affinities"
    ADD CONSTRAINT "passage_affinities_target_passage_id_fkey"
    FOREIGN KEY ("target_passage_id") REFERENCES "passages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
