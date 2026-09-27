/**
 * Orama search index
 *
 * Full-text retrieval runs in-process, so the app needs no Meilisearch or Qdrant.
 * Orama returns ranked passage ids; hydration from Postgres happens in
 * services/search.ts, which keeps the index cheap to build and rebuild.
 */

import { create, getByID, insertMultiple, load, remove, save, search, upsert } from '@orama/orama';
import type { Orama, Results, WhereCondition } from '@orama/orama';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TextId } from '@ilm/shared';

const prisma = new PrismaClient();

// ============================================================================
// SCHEMA
// ============================================================================

// `originalText` is deliberately NOT indexed. Orama's default tokenizer returns
// zero matches for Arabic, Hebrew and Aramaic, so the field cost ~36 MB of a
// 512 MB budget to provide no working search. The original text is still served
// from Postgres in passage responses; only full-text search over it is absent.
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
  language: string;
  verseOrder: number;
  themes: string[];
  density: number;
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
  hits: IndexHit[];
  count: number;
  elapsedMs: number;
}

// ============================================================================
// LIFECYCLE
// ============================================================================

const DATA_DIR = path.join(process.cwd(), 'data', 'search-index');
const INDEX_FILE = path.join(DATA_DIR, 'orama.json');

let index: IndexDB | null = null;
let initPromise: Promise<IndexDB> | null = null;

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
    })().catch((error) => {
      throw error;
    });
    initPromise = pending;
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
  const total = await prisma.passage.count();
  console.log(`[search] indexing ${total} passages`);

  let cursor: string | undefined;
  let inserted = 0;

  for (;;) {
    const passages = await prisma.passage.findMany({
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
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
      language: p.language,
      verseOrder: p.verseOrder,
      themes: p.themes.map((t) => t.theme.name),
      density: readDensity(p.metadata),
    }));

    await insertMultiple(db, documents);
    inserted += documents.length;
    cursor = passages[passages.length - 1].id;

    if (inserted % 10000 === 0) console.log(`[search]   ${inserted}/${total}`);
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

  return { hits, count: results.count, elapsedMs: Date.now() - startedAt };
}

/** Fetch a single indexed document by its canonical key. */
export async function getIndexedPassage(passageKey: string): Promise<PassageDoc | null> {
  const db = await initializeOramaIndex();
  const results = await search(db, { term: '', where: { passageKey }, limit: 1, threshold: 0 });
  const hit = results.hits[0];
  return hit ? (hit.document as unknown as PassageDoc) : null;
}

export async function getIndexedThemes(): Promise<string[]> {
  const db = await initializeOramaIndex();
  const results = await search(db, { term: '', limit: 0, threshold: 0 });
  const themes = new Set<string>();
  for (const hit of results.hits) {
    for (const theme of (hit.document as unknown as PassageDoc).themes) themes.add(theme);
  }
  return [...themes].sort();
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
