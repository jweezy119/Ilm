/**
 * Full-text retrieval in Postgres.
 *
 * This replaces the in-process Orama index, which held every passage in the API's
 * own memory at a measured ~35 KB per document. That capped a 512 MB instance at
 * roughly 13,000 passages against a corpus of 45,453 — the Old Testament alone is
 * 23,145. The limit was the instance, not the data.
 *
 * The same interface as the Orama module, deliberately, so this could be swapped
 * in behind `SEARCH_ENGINE` and taken back out again.
 *
 * One behavioural difference worth stating plainly, because it is a gain and not a
 * refactor: the in-process index never contained the scripture. It held theme
 * names, book slugs and translation names, so "mercy" matched because passages
 * carry a theme called mercy, not because the word appears in them — a word
 * absent from the theme vocabulary returned nothing however common it was in the
 * text. This searches the English translation, and still indexes themes, so
 * everything that used to be findable remains findable.
 */

import { Prisma } from '@prisma/client';
import { TextId } from '@ilm/shared';
import { prisma } from '../lib/db';


export type PassageDoc = {
  passageKey: string;
  textId: TextId;
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  language: string;
  verseOrder: number;
  themes: string[];
  density: number;
};

export interface IndexFilters {
  textIds?: TextId[];
  books?: string[];
  chapters?: number[];
  languages?: string[];
  themes?: string[];
}

export interface IndexSearchOptions extends IndexFilters {
  term: string;
  limit?: number;
  offset?: number;
  /**
   * Accepted for compatibility with the Orama module and ignored: the vector is
   * weighted, so the whole document is searched at once rather than a chosen set
   * of properties. Weights stand in for the old `properties` argument — text is
   * weight A, themes B, book and translation C.
   */
  properties?: ('translation' | 'book' | 'themes')[];
  sortBy?: 'relevance' | 'verseOrder';
  sortOrder?: 'asc' | 'desc';
}

export interface IndexHit {
  document: PassageDoc;
  score: number;
}

export interface IndexSearchResult {
  hits: IndexHit[];
  count: number;
  elapsedMs: number;
}

const DEFAULT_LIMIT = 20;

/**
 * Weight C carries no stemming, so "genesis" matches "Genesis" and a book slug
 * survives case. The text query uses `websearch_to_tsquery`, which tolerates the
 * quoted phrases and `-exclusions` a reader will type without erroring the way
 * `plainto_tsquery` does not.
 */
function toQuery(term: string): string | null {
  const trimmed = term.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function filterConditions(filters: IndexFilters): Prisma.Sql[] {
  const clauses: Prisma.Sql[] = [];

  if (filters.textIds?.length) {
    clauses.push(Prisma.sql`p.text_id = ANY(${filters.textIds}::text[])`);
  }
  if (filters.books?.length) {
    clauses.push(Prisma.sql`p.book_slug = ANY(${filters.books}::text[])`);
  }
  if (filters.languages?.length) {
    clauses.push(Prisma.sql`p.language = ANY(${filters.languages}::text[])`);
  }
  if (filters.chapters?.length) {
    clauses.push(Prisma.sql`p.chapter_num = ANY(${filters.chapters}::int[])`);
  }
  if (filters.themes?.length) {
    // Theme membership is a relation, so this is an EXISTS rather than a column
    // match. Relations are queried here rather than in the index, which is also
    // why the themes table does not have to be denormalised onto every passage.
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM passage_themes pt
      WHERE pt.passage_id = p.id AND pt.theme_id = ANY(${filters.themes}::text[])
    )`);
  }

  return clauses;
}

export async function searchIndex(options: IndexSearchOptions): Promise<IndexSearchResult> {
  const startedAt = Date.now();
  const {
    term,
    limit = DEFAULT_LIMIT,
    offset = 0,
    sortBy = 'relevance',
    sortOrder = 'desc',
  } = options;

  const query = toQuery(term);
  /*
   * The tsquery is built once and interpolated in both the rank and the predicate.
   * Calling websearch_to_tsquery twice passed the same term as two parameters and
   * parsed it twice for no reason.
   */
  const tsq = query ? Prisma.sql`websearch_to_tsquery('english', ${query})` : null;

  // Aliased `relevance`, not `rank`: RANK is reserved in PostgreSQL as a window
  // function, so `ORDER BY rank` is a syntax error (42601).
  const rank = tsq ? Prisma.sql`ts_rank_cd(p.search_vector, ${tsq})` : Prisma.sql`0`;

  /*
   * Conditions are collected first and wrapped in WHERE exactly once.
   *
   * The keyword used to live inside the filters fragment, so a search with no
   * filters — which is every ordinary search — appended the text predicate bare
   * and Postgres rejected it with "syntax error at or near p". A term-only
   * search was the case that broke, and the case most likely to be tried.
   */
  const conditions = filterConditions(options);
  if (tsq) conditions.push(Prisma.sql`p.search_vector @@ ${tsq}`);
  const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

  const order =
    sortBy === 'verseOrder'
      ? Prisma.sql`ORDER BY p.verse_order ${Prisma.raw(sortOrder === 'asc' ? 'ASC' : 'DESC')}`
      : query
        ? Prisma.sql`ORDER BY relevance DESC, p.verse_order ASC`
        : Prisma.sql`ORDER BY p.verse_order ASC`;

  /*
   * Two queries rather than one.
   *
   * The obvious single statement joins a LATERAL that aggregates each passage's
   * themes, which looks harmless and is not: a join is evaluated before LIMIT, so
   * it runs for every matching row in the corpus and not for the forty on the
   * page. "nitre" measured 1,087 ms that way. Ranking first and then fetching
   * themes for the page keys costs one extra round trip and none of that.
   */
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        p.id, p.passage_key, p.text_id, p.book_slug, p.chapter_num, p.verse_num,
        p.primary_translation, p.language, p.verse_order, p.metadata,
        ${rank} AS relevance,
        count(*) OVER () AS total
      FROM passages p
      ${where}
      ${order}
      LIMIT ${limit} OFFSET ${offset}
    `
  );

  const themeRows =
    rows.length === 0
      ? []
      : await prisma.$queryRaw<Array<{ passage_id: string; name: string }>>(Prisma.sql`
          SELECT pt.passage_id, pt.theme_id AS name
          FROM passage_themes pt
          WHERE pt.passage_id IN (${Prisma.join(rows.map((r) => Prisma.sql`${String(r.id)}`))})
        `);

  const themesById = new Map<string, string[]>();
  for (const row of themeRows) {
    const list = themesById.get(row.passage_id) ?? [];
    list.push(row.name);
    themesById.set(row.passage_id, list);
  }

  /*
   * Normalising by the best rank in the page keeps the 0..1 range the downstream
   * scoring expects. ts_rank_cd is an unbounded float — typically 0.001 to 0.05 —
   * and `scoreCandidate` multiplies it by coverage and clamps to 1, so returning
   * it raw would make every result look like a near-zero match while preserving
   * only the ordering. The top hit becomes 1.0, as it did under Orama.
   */
  const topRank = rows.reduce((max, row) => Math.max(max, Number(row.relevance) || 0), 0);

  const hits: IndexHit[] = rows.map((row) => ({
    document: {
      passageKey: String(row.passage_key),
      textId: String(row.text_id) as TextId,
      book: String(row.book_slug),
      chapter: Number(row.chapter_num),
      verse: Number(row.verse_num),
      translation: String(row.primary_translation),
      language: String(row.language),
      verseOrder: Number(row.verse_order),
      themes: themesById.get(String(row.id)) ?? [],
      density: readDensity(row.metadata),
    },
    score: query ? (topRank > 0 ? (Number(row.relevance) || 0) / topRank : 0) : 0,
  }));

  return {
    hits,
    // The window count is the total matching the filters, which is what the
    // header reports. Falls back to the page size when offset pushed the window
    // out of view, which cannot happen for count(*) OVER (), but is guarded anyway.
    count: rows.length > 0 ? Number(rows[0].total ?? rows.length) : 0,
    elapsedMs: Date.now() - startedAt,
  };
}

/** Density is scoring metadata, and a missing value means "not scored". */
function readDensity(metadata: unknown): number {
  if (typeof metadata !== 'object' || metadata === null) return 0;
  const value = (metadata as { density?: unknown }).density;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** One passage by its canonical key, with its themes. */
export async function getIndexedPassage(passageKey: string): Promise<PassageDoc | null> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT p.passage_key, p.text_id, p.book_slug, p.chapter_num, p.verse_num,
           p.primary_translation, p.language, p.verse_order, p.metadata,
           COALESCE(th.names, ARRAY[]::text[]) AS theme_names
    FROM passages p
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT pt.theme_id) AS names
      FROM passage_themes pt
      WHERE pt.passage_id = p.id
    ) th ON true
    WHERE p.passage_key = ${passageKey}
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    passageKey: String(row.passage_key),
    textId: String(row.text_id) as TextId,
    book: String(row.book_slug),
    chapter: Number(row.chapter_num),
    verse: Number(row.verse_num),
    translation: String(row.primary_translation),
    language: String(row.language),
    verseOrder: Number(row.verse_order),
    themes: (row.theme_names as string[]) ?? [],
    density: readDensity(row.metadata),
  };
}

/** Every theme in the corpus, read from Postgres rather than from an index. */
export async function getIndexedThemes(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT name FROM themes ORDER BY name`;
  return rows.map((r) => r.name);
}

/**
 * No index to warm, so this is a no-op kept for interface parity: the server
 * calls it on boot and there is nothing to build.
 */
export async function initializeOramaIndex(): Promise<null> {
  return null;
}

/** Always true. The vector is maintained by triggers, not built in memory. */
export function isIndexReady(): boolean {
  return true;
}

/** Nothing to build, so nothing to drop. */
export async function invalidateOramaIndex(): Promise<void> {
  return;
}
