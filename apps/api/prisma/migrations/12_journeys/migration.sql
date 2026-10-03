-- Journeys: a reader's own path through the corpora, as a set of chosen passages.
--
-- A journey is a node set and an ordering, not an edge set. The edges are read at
-- query time from relations the app already computes and stores —
-- cross_references, alignments and passage_themes — so every edge on the graph
-- already carries the provenance that made Ilm trustworthy in the first place: a
-- quotation is labelled a quotation because something detected a quotation, not
-- because a reader or a model said the two passages are related.
--
-- That is the whole reason there is no `journey_edges` table. A user-authored
-- edge would be the reader's assertion wearing the same visual weight as a
-- detected quotation, and nothing in the UI could tell the two apart afterwards.
-- If a reader wants to record their own connection between two passages, that is
-- a note on the node, which is this reader's writing about their own reading and
-- is already marked as such.
--
-- It is also not written into `passage_affinities`. Those rows are the
-- read-through cache for recommendation ranking, keyed on the ordered pair;
-- user edges in there would silently change what every other reader is shown.
--
-- Keyed by the same anonymous cookie as the library. There is still no account,
-- and this table inherits that trade: clearing cookies loses the journey.

CREATE TABLE IF NOT EXISTS journeys (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Two names per reader would make "which one did I mean" a question the data
-- should never produce. Capped in the service rather than here, because a limit
-- in SQL has to be re-explained every time it is read.
CREATE UNIQUE INDEX IF NOT EXISTS journeys_user_id_name_key
  ON journeys (user_id, name);

CREATE INDEX IF NOT EXISTS journeys_user_id_updated_at_idx
  ON journeys (user_id, updated_at DESC);

-- A passage, once, in a given journey. The same passage may sit in several
-- journeys, which is the point: two readings of one verse are two journeys.
CREATE TABLE IF NOT EXISTS journey_nodes (
  id          TEXT PRIMARY KEY,
  journey_id  TEXT NOT NULL REFERENCES journeys (id) ON DELETE CASCADE,
  passage_key TEXT NOT NULL,

  -- The reader's own ordering. Not chronological and not the corpus order: the
  -- order they put the passages in is the argument they are making, and it is
  -- the one thing here that cannot be derived.
  position INTEGER NOT NULL,

  -- The reader's own words about this node. Null for most.
  note TEXT,

  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The @@ directives live in schema.prisma and have no SQL equivalent; the
-- constraints they describe are these indexes. Writing them here as if they were
-- DDL is a syntax error at or near "@@", which the migration runner reports only
-- as a code, so it is written out properly.
CREATE UNIQUE INDEX IF NOT EXISTS journey_nodes_journey_id_passage_key_key
  ON journey_nodes (journey_id, passage_key);

CREATE INDEX IF NOT EXISTS journey_nodes_journey_id_position_idx
  ON journey_nodes (journey_id, position);
