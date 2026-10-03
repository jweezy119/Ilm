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
import { normalizeForSearch } from '../lib/script-normalize';
import { stemGreekTokens } from '../lib/greek-stem';
import { TextId } from '@ilm/shared';
import { prisma } from '../lib/db';


export type PassageDoc = {
  passageKey: string;
  textId: TextId;
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  /**
   * The original-language text, carried so a hit on it can be shown and labelled.
   * Present for every passage that has one — 45,306 of 45,453 — and empty for the
   * rest, which is the English-only remainder.
   */
  originalText: string;
  language: string;
  verseOrder: number;
  themes: string[];
  density: number;
  /**
   * Which fields earned the hit, as `original`, `translation` or both.
   *
   * A reader who searches a Hebrew or Arabic word and is shown an English
   * translation with no explanation has been given something other than what they
   * asked for. This is what lets the result say which it was.
   */
  matchedIn: string;
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

/**
 * Which pass produced the results.
 *
 * Reported rather than applied silently: a result set from the typo pass is a
 * guess, and the reader should be able to see that it was relaxed to find
 * anything at all. Surfaced on the response as `matchMode`.
 */
export type MatchMode = 'exact' | 'relaxed' | 'filters-only';

export interface IndexSearchResult {
  /**
   * Set only by the theme-widening pass, never by a literal search.
   *
   * Which term reached each passage, and the full list of terms used, so a result
   * that was not found by the words the reader typed can say so. A literal search
   * leaves both empty, which is the common case and needs no explanation.
   */
  provenance?: Map<string, { kind: 'theme' | 'xlingual'; term: string; language?: string }>;
  widenedTerms?: Array<{ kind: 'theme' | 'xlingual'; term: string; language?: string; hits: number; novel: number }>;
  hits: IndexHit[];
  count: number;
  elapsedMs: number;
  matchMode: MatchMode;
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

/**
 * Trigram similarity, for a misspelled or half-typed term.
 *
 * pg_trgm's `word_similarity` asks "does this long text contain a word resembling
 * the query", which is the right shape for verses. `%>>` is the index-assisted
 * form of `word_similarity(...) > pg_trgm.word_similarity_threshold` (0.6 by
 * default), so the match uses passages_trgm_idx instead of scanning the corpus.
 *
 * This replaces an earlier prefix pass (`to_tsquery('...:*')`). Prefixes do not
 * work here: the English stemmer rewrites "merce:*" to 'merc':*, so a typo is
 * silently stemmed into a different word's prefix and the results rank like
 * noise. Trigram also covers the mid-typing case that motivated the prefix pass
 * — "forgiv" is a near-match for "forgive" — so one pass does both jobs.
 */
const trigramRank = (term: string) => Prisma.sql`word_similarity(${term}, p.primary_translation)`;

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

  /*
   * The same query again, for the original-language text.
   *
   * The corpus is 23% non-English by verse count and `search_vector` is built with
   * the 'english' configuration over the translation, so until this existed a
   * reader searching الرحمن, מזמור or ηγαπησεν matched nothing and was shown the
   * empty state — which reads as "the corpus does not discuss this" rather than
   * "the app cannot search that language".
   *
   * 'simple', not a language configuration: there is no `hebrew` configuration in
   * this database, and stemming is actively harmful for Arabic, where the prefixes
   * and suffixes carry the meaning. And the term is normalised first, because the
   * corpus is vocalised and الرحمن does not match ٱلرَّحْمَٰنِ as stored. The
   * normaliser is the same function the backfill used, which is the only reason
   * the two sides cannot drift.
   */
  /*
   * The original-language query, carrying both the surface form and the stem.
   *
   * The index holds surface forms at weight A and Greek stems at weight D, so a
   * query has to offer both or it will only ever match one of them. The pipe is the
   * disjunction: a query for θεοῦ has to find θεός, and a query for θεός has to find
   * θεοῦ, and ANDing them would require every passage to contain both.
   *
   * `|`, not `||`. The Snowball documentation writes the or as `||` because that is
   * the stemmer's own syntax; tsquery spells it with a single pipe, and `||` is a
   * syntax error on every PostgreSQL version. That one character took Greek search
   * down entirely, and it presented as a query error rather than as an indexing
   * problem, which is why it is written down here.
   *
   * Greek tokens are stemmed exactly once. The algorithm is not idempotent — 39% of
   * the New Testament's tokens stem to something that stems to something else — so
   * this is not a detail. A query stemmed twice simply stops matching the index,
   * which presents as a language the app cannot search rather than as a bug.
   *
   * Only Greek is stemmed. Arabic and Hebrew keep surface forms alone because their
   * prefixes carry the meaning, and both already measure 100% reachable.
   *
   * plainto_tsquery, not to_tsquery. to_tsquery parses its argument as tsquery
   * *syntax*, so ordinary English breaks it: the words OR, AND, NOT and EXCEPT are
   * operators, and any punctuation is too. This is not only a reader-typed query
   * either — the recommendation path builds one from words sampled out of a
   * passage's own translation, so "except whatever heavens" reached the database and
   * came back 42601, which surfaced as a 500 on the passage page rather than as an
   * empty sidebar. plainto_tsquery treats its argument as plain text and ANDs the
   * tokens, so it cannot fail on any input.
   */
  const origSurface = query ? normalizeForSearch(query) : '';
  const origStemmed = query ? stemGreekTokens(origSurface) : '';
  // The disjunction is now expressed by SQL's || between two tsquery values, so
  // there is no single tsquery string to mis-parse.
  const origQ = query
    ? origStemmed && origStemmed !== origSurface
      ? Prisma.sql`(plainto_tsquery('simple', ${origSurface}) || plainto_tsquery('simple', ${origStemmed}))`
      : Prisma.sql`plainto_tsquery('simple', ${origSurface})`
    : Prisma.sql`plainto_tsquery('simple', '')`;

  /*
   * Two passes, strictest first, the second run only if the first found nothing.
   * A reader gets forgiving matching without paying for it on the searches that
   * already work — the trigram pass is a separate indexed lookup, not a
   * re-ranking of the first result set.
   *
   *   1. websearch_to_tsquery  — the query as typed
   *   2. pg_trgm word_similarity — "merce" finds "mercy", "forgiv" finds "forgive"
   */
  const base = filterConditions(options);
  const sortSql =
    sortBy === 'verseOrder'
      ? Prisma.sql`ORDER BY p.verse_order ${Prisma.raw(sortOrder === 'asc' ? 'ASC' : 'DESC')}`
      : query
        ? Prisma.sql`ORDER BY relevance DESC, p.verse_order ASC`
        : Prisma.sql`ORDER BY p.verse_order ASC`;

  /**
   * Conditions are collected first and wrapped in WHERE exactly once.
   *
   * The keyword used to live inside the filters fragment, so a search with no
   * filters — which is every ordinary search — appended the text predicate bare
   * and Postgres rejected it with "syntax error at or near p". A term-only search
   * was the case that broke, and the case most likely to be tried.
   */
  const run = async (match: { rank: Prisma.Sql; condition: Prisma.Sql } | null) => {
    const conditions = [...base];
    if (match) conditions.push(match.condition);
    const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    // Aliased `relevance`, not `rank`: RANK is reserved in PostgreSQL as a window
    // function, so `ORDER BY rank` is a syntax error (42601).
    const rank = match?.rank ?? Prisma.sql`0`;

    return prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT
        p.id, p.passage_key, p.text_id, p.book_slug, p.chapter_num, p.verse_num,
        p.primary_translation, p.original_text, p.language, p.verse_order, p.metadata,
        ${rank} AS relevance,
        -- Whether this row matched in the original text, the English translation,
        -- or both. Reported rather than inferred from the rank, because a reader
        -- who searched a Hebrew or Arabic word and got a hit on an English
        -- translation has been given something other than what they asked for.
        (p.search_vector_original @@ ${origQ}) AS matched_original,
        (p.search_vector @@ ${tsq}) AS matched_translation,
        count(*) OVER () AS total
      FROM passages p
      ${where}
      ${sortSql}
      LIMIT ${limit} OFFSET ${offset}
    `);
  };

  /*
   * Two queries rather than one.
   *
   * The obvious single statement joins a LATERAL that aggregates each passage's
   * themes, which looks harmless and is not: a join is evaluated before LIMIT, so
   * it runs for every matching row in the corpus and not for the forty on the
   * page. "nitre" measured 1,087 ms that way. Ranking first and then fetching
   * themes for the page keys costs one extra round trip and none of that.
   */
  const passes: Array<{ label: string; match: { rank: Prisma.Sql; condition: Prisma.Sql } | null }> = [];

  if (tsq) {
    passes.push({
      label: 'exact',
      match: {
        // Both ranks, summed. A passage that matches the term in its original and
        // in its translation is a better answer than one that matches in either,
        // and adding them is the only honest way to say so — picking the larger
        // would discard the evidence for half the corpus.
        rank: Prisma.sql`ts_rank_cd(p.search_vector, ${tsq}) + ts_rank_cd(p.search_vector_original, ${origQ})`,
        condition: Prisma.sql`(p.search_vector @@ ${tsq} OR p.search_vector_original @@ ${origQ})`,
      },
    });
  }

  // A one- or two-letter term matches nearly everything by trigram, so require
  // enough characters for the comparison to mean something.
  if (query && query.length >= 4) {
    passes.push({
      label: 'relaxed',
      match: { rank: trigramRank(query), condition: Prisma.sql`p.primary_translation %>> ${query}` },
    });
  }

  // No text at all: filters only, one pass.
  if (passes.length === 0) passes.push({ label: 'filters-only', match: null });

  let rows: Array<Record<string, unknown>> = [];
  // Defaults to the most forgiving pass so a search that found nothing is
  // reported as having tried everything, rather than claiming an exact match it
  // did not have. Overwritten as soon as a pass returns rows.
  let usedPass = passes[passes.length - 1].label;

  for (const pass of passes) {
    rows = await run(pass.match);
    if (rows.length > 0) {
      usedPass = pass.label;
      break;
    }
  }

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
      originalText: String(row.original_text ?? ''),
      language: String(row.language),
      verseOrder: Number(row.verse_order),
      themes: themesById.get(String(row.id)) ?? [],
      density: readDensity(row.metadata),
      // Which field earned the hit, so the UI can say so rather than leaving a
      // reader who searched Hebrew looking at an English translation with no
      // explanation of why it matched.
      matchedIn: (row.matched_original ? 'original' : '') + (row.matched_translation ? 'translation' : ''),
    },
    score: query ? (topRank > 0 ? (Number(row.relevance) || 0) / topRank : 0) : 0,
  }));

  return {
    hits,
    matchMode: usedPass as MatchMode,
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
           p.primary_translation, p.original_text, p.language, p.verse_order, p.metadata,
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
    // A single passage is fetched by key, not by a query, so it matched nothing
    // and must not claim otherwise.
    originalText: String(row.original_text ?? ''),
    matchedIn: '',
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
