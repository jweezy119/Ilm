/**
 * Orama search index
 *
 * Full-text retrieval runs in-process, so the app needs no Meilisearch or Qdrant.
 * Orama returns ranked passage ids; hydration from Postgres happens in
 * services/search.ts, which keeps the index cheap to build and rebuild.
 */

import { create, getByID, insertMultiple, load, remove, save, search, upsert } from '@orama/orama';
import type { Orama, Results, WhereCondition } from '@orama/orama';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TextId } from '@ilm/shared';
import { prisma } from '../lib/db';



// ============================================================================
// SCHEMA
// ============================================================================

// `originalText` is deliberately NOT indexed. Orama's default tokenizer returns
// zero matches for Arabic, Hebrew and Aramaic, so the field cost ~36 MB of a
// 512 MB budget to provide no working search. The original text is still served
// from Postgres in passage responses; only full-text search over it is absent.
//
// `textId` and `language` are `string` and must stay that way, even though they
// are only ever equality filters and an `enum` would store them without an
// inverted index (~70 MB across the corpus). Orama rejects `where` clauses on
// enum properties outright — "You can only use one operation per filter" — and
// filtering by text is the most-used filter in the app. Correctness wins; the
// memory is found by narrowing the corpus instead. See SEARCH_INDEX_TEXTS.
const passageSchema = {
  passageKey: 'string',
  textId: 'string',
  book: 'string',
  chapter: 'number',
  verse: 'number',
  translation: 'string',
  language: 'string',
  verseOrder: 'number',
  themes: 'string[]',
  // Semantic density, scored once at index time. Used only as a tie-breaker.
  density: 'number',
} as const;


/**
 * Density is stored in passage metadata by the indexing run. A missing value
 * means "not scored", which is different from "not dense", so it reads as 0.
 */
function readDensity(metadata: unknown): number {
  if (typeof metadata !== 'object' || metadata === null) return 0;
  const value = (metadata as { density?: unknown }).density;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export type PassageDoc = {
  passageKey: string;
  textId: TextId;
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  /**
   * Not indexed by Orama — the rollback engine reads the English translation only,
   * so it can never match the original text. Present so the two engines return the
   * same shape; the Orama path leaves it empty and the UI shows no "matched in the
   * original" claim, which is accurate.
   */
  originalText: string;
  language: string;
  verseOrder: number;
  themes: string[];
  density: number;
  matchedIn: string;
};

type IndexDB = Orama<typeof passageSchema>;

type SearchProps = 'translation' | 'book' | 'themes';

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
  properties?: SearchProps[];
  sortBy?: 'relevance' | 'verseOrder';
  sortOrder?: 'asc' | 'desc';
}

export interface IndexHit {
  document: PassageDoc;
  score: number;
}

export interface IndexSearchResult {
  /**
   * Set only by the theme-widening pass, never by a literal search.
   *
   * Which term reached each passage, and the full list used, so a result that was
   * not found by the words the reader typed can say so. Declared here so the two
   * engines satisfy the same shape; this engine never populates it, because it is
   * not the engine that widens a query.
   */
  provenance?: Map<string, { kind: 'theme' | 'xlingual'; term: string; language?: string }>;
  widenedTerms?: Array<{ kind: 'theme' | 'xlingual'; term: string; language?: string; hits: number; novel: number }>;
  hits: IndexHit[];
  count: number;
  elapsedMs: number;
  /**
   * Which pass matched. Orama has no relaxed fallback, so it only ever reports
   * 'exact'; the Postgres engine can return 'relaxed'. Declared here so the two
   * engines satisfy the same shape.
   */
  matchMode: 'exact' | 'relaxed' | 'filters-only';
}

// ============================================================================
// LIFECYCLE
// ============================================================================

const DATA_DIR = path.join(process.cwd(), 'data', 'search-index');
const INDEX_FILE = path.join(DATA_DIR, 'orama.json');

let index: IndexDB | null = null;
let initPromise: Promise<IndexDB> | null = null;

/**
 * Which texts go into the index.
 *
 * The index is held in memory, so its size is bounded by the instance, not by the
 * corpus. Measured on the 45,453-passage corpus, a one-property index already
 * needed 745 MB, so no amount of schema trimming fits a 512 MB instance: the
 * document count is the floor. The whole corpus cannot be indexed there, so the
 * index holds a subset and the app says so rather than pretending the other texts
 * do not exist.
 *
 * Selection is whole-text rather than a truncated slice, so a text is either
 * searchable or absent, and results within an indexed text stay complete.
 *
 *   SEARCH_INDEX_TEXTS=quran,torah   the default: 12,082 passages, measured ~420 MB
 *   SEARCH_INDEX_TEXTS=all           every text; needs roughly 1.5 GB of headroom
 *
 * `all` is the right setting on a larger instance, and requires no code change.
 * The budget is a property of the host, so the choice belongs in configuration.
 */
const INDEX_TEXTS_SETTING = (process.env.SEARCH_INDEX_TEXTS ?? 'quran,torah').trim();
const INDEX_ALL_TEXTS = INDEX_TEXTS_SETTING.toLowerCase() === 'all';

/** The text ids this process indexes, or null when it indexes all of them. */
export function indexedTextIds(): string[] | null {
  if (INDEX_ALL_TEXTS) return null;
  return INDEX_TEXTS_SETTING.split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}


function buildSchema() {
  return passageSchema;
}

/** Load the persisted index, or build one from Postgres. Safe to call repeatedly. */
export function initializeOramaIndex(): Promise<IndexDB> {
  if (index) return Promise.resolve(index);
  if (!initPromise) {
    const pending: Promise<IndexDB> = (async () => {
      try {
        const raw = await fs.readFile(INDEX_FILE, 'utf-8');
        const db: IndexDB = create({ schema: buildSchema() });
        load(db, JSON.parse(raw));
        index = db;
        console.log(`[search] index loaded from disk (${count(db)} passages)`);
        return db;
      } catch {
        console.log('[search] no persisted index, building from database');
      }

      const db: IndexDB = await buildOramaIndex();
      index = db;
      await persistOramaIndex();
      return db;
    })();
    initPromise = pending;
    /*
     * Clear the memo when the build fails.
     *
     * Without this, `index` stays null so the fast path above never
     * short-circuits, and every later caller is handed this same rejected
     * promise for the life of the process — search stays broken until a restart,
     * even though the failure (an unwritable data dir, a transient database
     * error) may not recur. Clearing it lets the next search try again.
     */
    pending.catch(() => {
      if (initPromise === pending) initPromise = null;
    });
  }
  return initPromise;
}

function count(db: IndexDB): number {
  return (search(db, { term: '', limit: 0, threshold: 0 }) as Results<unknown>).count;
}

/**
 * Build a fresh index from Postgres and adopt it as the live one.
 * Assigning `index` here (rather than only in initializeOramaIndex) is what lets
 * the indexing script rebuild and persist without going through the loader.
 */
export async function buildOramaIndex(batchSize = 2000): Promise<IndexDB> {
  initPromise = null;
  const db: IndexDB = create({ schema: buildSchema() });
  const textIds = indexedTextIds();
  const total = await prisma.passage.count();
  const corpus = textIds
    ? await prisma.passage.count({ where: { textId: { in: textIds as never[] } } })
    : total;

  if (textIds) {
    console.log(
      `[search] indexing ${corpus} of ${total} passages (SEARCH_INDEX_TEXTS=${INDEX_TEXTS_SETTING})`,
    );
  } else {
    console.log(`[search] indexing ${total} passages (all texts)`);
  }

  let cursor: string | undefined;
  let inserted = 0;

  for (;;) {
    const passages = await prisma.passage.findMany({
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      where: textIds ? { textId: { in: textIds as never[] } } : undefined,
      include: { themes: { include: { theme: true } } },
    });
    if (passages.length === 0) break;

    const documents: PassageDoc[] = passages.map((p) => ({
      passageKey: p.passageKey,
      textId: p.textId as TextId,
      book: p.bookSlug,
      chapter: p.chapterNum,
      verse: p.verseNum,
      translation: p.primaryTranslation,
      // Orama reads the English translation only. The field exists so both
      // engines return the same shape, and it is honestly empty here: the
      // rollback engine cannot match original text and must not imply that it can.
      originalText: '',
      matchedIn: '',
      language: p.language,
      verseOrder: p.verseOrder,
      themes: p.themes.map((t) => t.theme.name),
      density: readDensity(p.metadata),
    }));

    await insertMultiple(db, documents);
    inserted += documents.length;
    cursor = passages[passages.length - 1].id;

    if (inserted % 10000 === 0) console.log(`[search]   ${inserted}/${corpus}`);
  }

  console.log(`[search] index built with ${inserted} passages`);
  index = db;
  return db;
}

export async function persistOramaIndex(): Promise<void> {
  if (!index) return;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(INDEX_FILE, JSON.stringify(save(index)));
    console.log('[search] index persisted');
  } catch (error) {
    console.error('[search] could not persist index:', (error as Error).message);
  }
}

/** Drop the on-disk index so the next boot rebuilds it. */
export async function invalidateOramaIndex(): Promise<void> {
  index = null;
  initPromise = null;
  await fs.rm(DATA_DIR, { recursive: true, force: true });
}

// ============================================================================
// SEARCH
// ============================================================================

function buildWhere(filters: IndexFilters): Partial<WhereCondition<IndexDB['schema']>> {
  const where: Record<string, unknown> = {};
  if (filters.textIds?.length) where.textId = filters.textIds;
  if (filters.books?.length) where.book = filters.books;
  if (filters.chapters?.length) where.chapter = filters.chapters;
  if (filters.languages?.length) where.language = filters.languages;
  if (filters.themes?.length) where.themes = filters.themes;
  return where as Partial<WhereCondition<IndexDB['schema']>>;
}

export async function searchIndex(options: IndexSearchOptions): Promise<IndexSearchResult> {
  const db = await initializeOramaIndex();
  const startedAt = Date.now();

  const {
    term,
    limit = 20,
    offset = 0,
    properties = ['translation', 'book', 'themes'],
    sortBy = 'relevance',
    sortOrder = 'desc',
  } = options;

  const where = buildWhere(options);
  const hasTerm = term.trim().length > 0;

  const results = await search(db, {
    term: hasTerm ? term : '',
    where: Object.keys(where).length > 0 ? where : undefined,
    properties: hasTerm ? properties : ['translation'],
    limit: hasTerm ? limit + offset : limit + offset,
    ...(sortBy === 'verseOrder'
      ? { sortBy: { property: 'verseOrder' as const, order: (sortOrder === 'asc' ? 'ASC' : 'DESC') as 'ASC' | 'DESC' } }
      : {}),
    // A blank term only matches documents when the where-clause does the filtering.
    ...(hasTerm ? {} : { threshold: 0 }),
  });

  const hits = results.hits.slice(offset, offset + limit).map((hit) => ({
    document: hit.document as unknown as PassageDoc,
    score: hit.score,
  }));

  return {
    hits,
    count: results.count,
    elapsedMs: Date.now() - startedAt,
    // Orama has no relaxed fallback, so its results are always an exact match.
    matchMode: 'exact' as const,
  };
}

/** Fetch a single indexed document by its canonical key. */
export async function getIndexedPassage(passageKey: string): Promise<PassageDoc | null> {
  const db = await initializeOramaIndex();
  const results = await search(db, { term: '', where: { passageKey }, limit: 1, threshold: 0 });
  const hit = results.hits[0];
  return hit ? (hit.document as unknown as PassageDoc) : null;
}

/**
 * Every theme in the corpus, not just the indexed ones.
 *
 * This reads Postgres rather than walking the index. The index holds a subset of
 * the texts (see SEARCH_INDEX_TEXTS), so enumerating themes from it would report
 * an incomplete vocabulary, and a full scan of 45k documents to collect them was
 * slow besides. Theme relations belong to Postgres; the index only ranks.
 */
export async function getIndexedThemes(): Promise<string[]> {
  const rows = await prisma.theme.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
  return rows.map((r) => r.name);
}

// ============================================================================
// MAINTENANCE
// ============================================================================

export async function upsertIndexedPassage(document: PassageDoc): Promise<void> {
  const db = await initializeOramaIndex();
  upsert(db, document as unknown as Record<string, unknown>);
}

export async function removeIndexedPassage(passageKey: string): Promise<void> {
  const db = await initializeOramaIndex();
  remove(db, passageKey);
}

export function isIndexReady(): boolean {
  return index !== null;
}

/** Exposed for diagnostics. */
export function getIndexInstance(): IndexDB | null {
  return index;
}

export { getByID as getIndexedById };
