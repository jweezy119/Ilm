-- A library: what a reader kept, keyed by an anonymous cookie id.
--
-- There is no account and no signup. A tool people open to check a reference
-- cannot put an email wall in front of "save this verse", so identity is a UUID
-- in a cookie and the cost of that decision is that clearing cookies loses the
-- library. The `email` column exists so that "claim this library" can be a later
-- migration rather than a rewrite; it is null and unread until then.
--
-- A passage key, not a copy of the text. The passage is already in `passages`
-- and can be corrected, re-translated or re-ingested; a duplicate copy here would
-- be a second thing to keep in step, and it could disagree with the first.
--
-- Applied by hand. The API's Render build step is `prisma generate && tsc
-- --noEmit`, which does not migrate — fine for schema-neutral deploys, not fine
-- for this one.

-- Collections first: saved_passages references it.
CREATE TABLE IF NOT EXISTS collections (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS saved_passages (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  passage_key   TEXT NOT NULL,
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One save per passage, so a double click cannot produce two rows and the unsave
-- endpoint has something unambiguous to delete.
CREATE UNIQUE INDEX IF NOT EXISTS saved_passages_user_passage_key ON saved_passages(user_id, passage_key);

-- The library page is "my saves, newest first" for one user. Without this it is a
-- sequential scan of a table that only ever grows.
CREATE INDEX IF NOT EXISTS saved_passages_user_created ON saved_passages(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS collections_user_name ON collections(user_id, name);
