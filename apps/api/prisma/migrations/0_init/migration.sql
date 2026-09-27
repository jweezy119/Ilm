-- CreateTable
CREATE TABLE "texts" (
    "id" TEXT NOT NULL,
    "text_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "original_lang" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'ltr',
    "book_count" INTEGER NOT NULL DEFAULT 0,
    "verse_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" TEXT NOT NULL,
    "text_id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_original" TEXT,
    "name_translit" TEXT,
    "chapter_count" INTEGER NOT NULL DEFAULT 0,
    "verse_count" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL,
    "testament" TEXT,
    "category" TEXT,
    "description" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" TEXT NOT NULL,
    "book_ref" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "name_original" TEXT,
    "verse_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passages" (
    "id" TEXT NOT NULL,
    "passage_key" TEXT NOT NULL,
    "text_id" TEXT NOT NULL,
    "book_ref" TEXT NOT NULL,
    "book_slug" TEXT NOT NULL,
    "chapter_ref" TEXT NOT NULL,
    "chapter_num" INTEGER NOT NULL,
    "verse_num" INTEGER NOT NULL,
    "original_text" TEXT NOT NULL,
    "primary_translation" TEXT NOT NULL,
    "primary_translation_id" TEXT,
    "language" TEXT NOT NULL DEFAULT 'english',
    "verse_order" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embeddings" JSONB DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" TEXT NOT NULL,
    "text_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'english',
    "translator" TEXT,
    "year" INTEGER,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "license" TEXT,
    "source_url" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passage_translations" (
    "id" TEXT NOT NULL,
    "passage_id" TEXT NOT NULL,
    "translation_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passage_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "themes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "taxonomy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passage_themes" (
    "id" TEXT NOT NULL,
    "passage_id" TEXT NOT NULL,
    "theme_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'jev',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passage_themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_references" (
    "id" TEXT NOT NULL,
    "source_passage_id" TEXT NOT NULL,
    "target_passage_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "direction" TEXT NOT NULL DEFAULT 'bidirectional',
    "notes" TEXT,
    "detected_by" TEXT NOT NULL DEFAULT 'jev',
    "matchedSegments" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cross_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alignments" (
    "id" TEXT NOT NULL,
    "source_passage_id" TEXT NOT NULL,
    "target_passage_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "matchedSegments" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_logs" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "intent" TEXT,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "result_count" INTEGER NOT NULL,
    "took_ms" INTEGER NOT NULL,
    "user_id" TEXT,
    "session_id" TEXT,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "weights" JSONB NOT NULL DEFAULT '{}',
    "preferred_texts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferred_translations" JSONB NOT NULL DEFAULT '{}',
    "ui_settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indexing_jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "processed_items" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "texts_text_id_key" ON "texts"("text_id");

-- CreateIndex
CREATE INDEX "texts_text_id_idx" ON "texts"("text_id");

-- CreateIndex
CREATE INDEX "books_text_id_order_idx" ON "books"("text_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "books_text_id_book_id_key" ON "books"("text_id", "book_id");

-- CreateIndex
CREATE INDEX "chapters_book_ref_idx" ON "chapters"("book_ref");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_book_ref_number_key" ON "chapters"("book_ref", "number");

-- CreateIndex
CREATE UNIQUE INDEX "passages_passage_key_key" ON "passages"("passage_key");

-- CreateIndex
CREATE INDEX "passages_text_id_verse_order_idx" ON "passages"("text_id", "verse_order");

-- CreateIndex
CREATE INDEX "passages_text_id_book_slug_chapter_num_verse_num_idx" ON "passages"("text_id", "book_slug", "chapter_num", "verse_num");

-- CreateIndex
CREATE INDEX "passages_passage_key_idx" ON "passages"("passage_key");

-- CreateIndex
CREATE UNIQUE INDEX "translations_text_id_name_language_key" ON "translations"("text_id", "name", "language");

-- CreateIndex
CREATE INDEX "passage_translations_passage_id_idx" ON "passage_translations"("passage_id");

-- CreateIndex
CREATE UNIQUE INDEX "passage_translations_passage_id_translation_id_key" ON "passage_translations"("passage_id", "translation_id");

-- CreateIndex
CREATE UNIQUE INDEX "themes_name_key" ON "themes"("name");

-- CreateIndex
CREATE INDEX "themes_category_idx" ON "themes"("category");

-- CreateIndex
CREATE INDEX "passage_themes_passage_id_idx" ON "passage_themes"("passage_id");

-- CreateIndex
CREATE INDEX "passage_themes_theme_id_score_idx" ON "passage_themes"("theme_id", "score");

-- CreateIndex
CREATE UNIQUE INDEX "passage_themes_passage_id_theme_id_key" ON "passage_themes"("passage_id", "theme_id");

-- CreateIndex
CREATE INDEX "cross_references_source_passage_id_idx" ON "cross_references"("source_passage_id");

-- CreateIndex
CREATE INDEX "cross_references_target_passage_id_idx" ON "cross_references"("target_passage_id");

-- CreateIndex
CREATE INDEX "cross_references_type_strength_idx" ON "cross_references"("type", "strength");

-- CreateIndex
CREATE UNIQUE INDEX "cross_references_source_passage_id_target_passage_id_type_key" ON "cross_references"("source_passage_id", "target_passage_id", "type");

-- CreateIndex
CREATE INDEX "alignments_source_passage_id_idx" ON "alignments"("source_passage_id");

-- CreateIndex
CREATE INDEX "alignments_target_passage_id_idx" ON "alignments"("target_passage_id");

-- CreateIndex
CREATE UNIQUE INDEX "alignments_source_passage_id_target_passage_id_key" ON "alignments"("source_passage_id", "target_passage_id");

-- CreateIndex
CREATE INDEX "search_logs_created_at_idx" ON "search_logs"("created_at");

-- CreateIndex
CREATE INDEX "search_logs_user_id_idx" ON "search_logs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");

-- CreateIndex
CREATE INDEX "indexing_jobs_status_idx" ON "indexing_jobs"("status");

-- CreateIndex
CREATE INDEX "indexing_jobs_type_status_idx" ON "indexing_jobs"("type", "status");

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_text_id_fkey" FOREIGN KEY ("text_id") REFERENCES "texts"("text_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_book_ref_fkey" FOREIGN KEY ("book_ref") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passages" ADD CONSTRAINT "passages_text_id_fkey" FOREIGN KEY ("text_id") REFERENCES "texts"("text_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passages" ADD CONSTRAINT "passages_book_ref_fkey" FOREIGN KEY ("book_ref") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passages" ADD CONSTRAINT "passages_chapter_ref_fkey" FOREIGN KEY ("chapter_ref") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_text_id_fkey" FOREIGN KEY ("text_id") REFERENCES "texts"("text_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passage_translations" ADD CONSTRAINT "passage_translations_passage_id_fkey" FOREIGN KEY ("passage_id") REFERENCES "passages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passage_translations" ADD CONSTRAINT "passage_translations_translation_id_fkey" FOREIGN KEY ("translation_id") REFERENCES "translations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passage_themes" ADD CONSTRAINT "passage_themes_passage_id_fkey" FOREIGN KEY ("passage_id") REFERENCES "passages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passage_themes" ADD CONSTRAINT "passage_themes_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_references" ADD CONSTRAINT "cross_references_source_passage_id_fkey" FOREIGN KEY ("source_passage_id") REFERENCES "passages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_references" ADD CONSTRAINT "cross_references_target_passage_id_fkey" FOREIGN KEY ("target_passage_id") REFERENCES "passages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alignments" ADD CONSTRAINT "alignments_source_passage_id_fkey" FOREIGN KEY ("source_passage_id") REFERENCES "passages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alignments" ADD CONSTRAINT "alignments_target_passage_id_fkey" FOREIGN KEY ("target_passage_id") REFERENCES "passages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

