-- Drop the massive JSON embeddings column and recreate as BYTEA (Bytes)
ALTER TABLE "passages" DROP COLUMN "embeddings";
ALTER TABLE "passages" ADD COLUMN "embeddings" BYTEA;
