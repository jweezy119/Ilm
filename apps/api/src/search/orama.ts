/**
 * OramaJS Search Service
 * In-memory full-text + vector search for religious texts
 * No external service required - runs inside the API process
 */

import { 
  create, 
  insertMultiple, 
  search, 
  remove, 
  save, 
  load,
  type Orama,
  type Schema,
  type SearchParams,
  type SearchResult as OramaSearchResult
} from '@orama/orama';
import { PrismaClient } from '@prisma/client';
import { Passage, TextId } from '@ilm/shared';
import * as fs from 'fs/promises';
import * as path from 'path';

const prisma = new PrismaClient();

// Orama index type
type PassageDoc = {
  id: string;
  passageKey: string;
  textId: TextId;
  book: string;
  chapter: string;
  verse: string;
  originalText: string;
  translation: string;
  language: string;
  verseOrder: number;
  themes: string[];
  themeScores: Record<string, number>;
};

type OramaDB = Orama<{
  id: string;
  passageKey: string;
  textId: string;
  book: string;
  chapter: string;
  verse: string;
  originalText: string;
  translation: string;
  language: string;
  verseOrder: number;
  themes: string[];
}>;

// In-memory index instance
let oramaDB: OramaDB | null = null;

// Index file path for persistence
const INDEX_DIR = path.join(process.cwd(), 'data', 'orama-index');
const INDEX_FILE = path.join(INDEX_DIR, 'index.json');

// ============================================================================
// SCHEMA DEFINITION
// ============================================================================

function createOramaSchema(): Schema<{
  id: string;
  passageKey: string;
  textId: string;
  book: string;
  chapter: string;
  verse: string;
  originalText: string;
  translation: string;
  language: string;
  verseOrder: number;
  themes: string[];
}> {
  return {
    id: 'string',
    passageKey: 'string',
    textId: 'string',
    book: 'string',
    chapter: 'string',
    verse: 'string',
    originalText: 'string',
    translation: 'string',
    language: 'string',
    verseOrder: 'number',
    themes: 'string[]',
  };
}

// ============================================================================
// INDEX LIFECYCLE
// ============================================================================

/**
 * Initialize Orama index - load from disk or build from database
 */
export async function initializeOramaIndex(): Promise<OramaDB> {
  if (oramaDB) return oramaDB;

  // Try to load existing index
  try {
    const indexData = await fs.readFile(INDEX_FILE, 'utf-8');
    oramaDB = await load(createOramaSchema(), indexData);
    console.log('✅ Orama index loaded from disk');
    return oramaDB;
  } catch {
    console.log('📦 No existing Orama index found, building from database...');
  }

  // Build from database
  oramaDB = await buildOramaIndex();
  await persistOramaIndex();
  return oramaDB;
}

/**
 * Build Orama index from PostgreSQL passages
 */
export async function buildOramaIndex(batchSize = 1000): Promise<OramaDB> {
  const db = await create({
    schema: createOramaSchema(),
  });
  let totalInserted = 0;

  // Get total count
  const totalPassages = await prisma.passage.count();
  console.log(`📊 Indexing ${totalPassages} passages...`);

  // Process in batches
  for (let offset = 0; offset < totalPassages; offset += batchSize) {
    const passages = await prisma.passage.findMany({
      take: batchSize,
      skip: offset,
      orderBy: { verseOrder: 'asc' },
      include: {
        themes: { include: { theme: true } },
      },
    });

    if (passages.length === 0) break;

    const documents = passages.map(p => ({
      id: p.id,
      passageKey: p.passageKey,
      textId: p.textId,
      book: p.bookId,
      chapter: p.chapterNum.toString(),
      verse: p.verseNum.toString(),
      originalText: p.originalText,
      translation: p.primaryTranslation,
      language: p.language,
      verseOrder: p.verseOrder,
      themes: p.themes.map(t => t.theme.name),
    }));

    await insertMultiple(db, documents);
    totalInserted += documents.length;
    console.log(`  ✓ Inserted ${totalInserted}/${totalPassages} passages`);
  }

  oramaDB = db;
  console.log(`✅ Orama index built with ${totalInserted} documents`);
  return db;
}

/**
 * Persist Orama index to disk
 */
export async function persistOramaIndex(): Promise<void> {
  if (!oramaDB) return;

  try {
    await fs.mkdir(INDEX_DIR, { recursive: true });
    const indexData = await save(oramaDB);
    await fs.writeFile(INDEX_FILE, indexData);
    console.log('💾 Orama index persisted to disk');
  } catch (error) {
    console.error('❌ Failed to persist Orama index:', error);
  }
}

/**
 * Add a single passage to the index
 */
export async function addPassageToIndex(passage: Passage): Promise<void> {
  if (!oramaDB) {
    oramaDB = await initializeOramaIndex();
  }

  const document = {
    id: passage.id,
    passageKey: passage.passageKey,
    textId: passage.textId,
    book: passage.book,
    chapter: passage.chapter.toString(),
    verse: passage.verse.toString(),
    originalText: passage.originalText,
    translation: passage.translation,
    language: passage.language || 'english',
    verseOrder: passage.metadata?.verseOrder || 0,
    themes: passage.themes?.map(t => t.theme) || [],
  };

  await insertMultiple(oramaDB, [document]);
  await persistOramaIndex();
}

/**
 * Remove a passage from the index
 */
export async function removePassageFromIndex(passageId: string): Promise<void> {
  if (!oramaDB) return;
  await remove(oramaDB, passageId);
  await persistOramaIndex();
}

/**
 * Update a passage in the index (remove + add)
 */
export async function updatePassageInIndex(passage: Passage): Promise<void> {
  await removePassageFromIndex(passage.id);
  await addPassageToIndex(passage);
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

export interface SearchOptions {
  term: string;
  textIds?: TextId[];
  books?: string[];
  chapters?: number[];
  languages?: string[];
  themes?: string[];
  limit?: number;
  offset?: number;
  properties?: ('originalText' | 'translation' | 'book' | 'themes')[];
  sortBy?: 'relevance' | 'verseOrder';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchHit {
  document: PassageDoc;
  score: number;
}

export interface SearchResult {
  hits: SearchHit[];
  count: number;
  elapsed: { raw: number; formatted: string };
}

/**
 * Search passages using Orama
 */
export async function searchPassages(options: SearchOptions): Promise<SearchResult> {
  if (!oramaDB) {
    oramaDB = await initializeOramaIndex();
  }

  const {
    term,
    textIds,
    books,
    chapters,
    languages,
    themes,
    limit = 20,
    offset = 0,
    properties = ['translation', 'originalText', 'book', 'themes'],
    sortBy = 'relevance',
    sortOrder = 'desc',
  } = options;

  // Build where filter
  const where: Record<string, any> = {};
  if (textIds?.length) where.textId = textIds.length === 1 ? textIds[0] : textIds;
  if (books?.length) where.book = books.length === 1 ? books[0] : books;
  if (chapters?.length) where.chapter = chapters.length === 1 ? chapters[0].toString() : chapters.map(c => c.toString());
  if (languages?.length) where.language = languages.length === 1 ? languages[0] : languages;
  if (themes?.length) where.themes = themes.length === 1 ? themes[0] : themes;

  const searchParams: SearchParams<typeof oramaDB> = {
    term,
    where: Object.keys(where).length > 0 ? where : undefined,
    properties,
    limit: limit + offset,
    sortBy: sortBy === 'verseOrder' ? { property: 'verseOrder', order: sortOrder.toUpperCase() as 'ASC' | 'DESC' } : undefined,
  };

  const results = await search(oramaDB, searchParams);

  // Apply offset manually
  const hits = results.hits.slice(offset, offset + limit).map(hit => ({
    document: {
      id: hit.document.id,
      passageKey: hit.document.passageKey,
      textId: hit.document.textId as TextId,
      book: hit.document.book,
      chapter: hit.document.chapter,
      verse: hit.document.verse,
      originalText: hit.document.originalText,
      translation: hit.document.translation,
      language: hit.document.language,
      verseOrder: hit.document.verseOrder,
      themes: hit.document.themes,
      themeScores: {}, // Not stored in Orama, would need separate lookup
    },
    score: hit.score,
  }));

  return {
    hits,
    count: results.count,
    elapsed: results.elapsed,
  };
}

/**
 * Search by exact passage key
 */
export async function searchByPassageKey(key: string): Promise<PassageDoc | null> {
  if (!oramaDB) {
    oramaDB = await initializeOramaIndex();
  }

  const results = await search(oramaDB, {
    term: '',
    where: { passageKey: key },
    limit: 1,
  });

  if (results.hits.length === 0) return null;
  
  const hit = results.hits[0];
  return {
    id: hit.document.id,
    passageKey: hit.document.passageKey,
    textId: hit.document.textId as TextId,
    book: hit.document.book,
    chapter: hit.document.chapter,
    verse: hit.document.verse,
    originalText: hit.document.originalText,
    translation: hit.document.translation,
    language: hit.document.language,
    verseOrder: hit.document.verseOrder,
    themes: hit.document.themes,
    themeScores: {},
  };
}

/**
 * Get random passage (for discovery)
 */
export async function getRandomPassage(textId?: TextId): Promise<PassageDoc | null> {
  if (!oramaDB) {
    oramaDB = await initializeOramaIndex();
  }

  const where = textId ? { textId } : undefined;
  const results = await search(oramaDB, {
    term: '',
    where,
    limit: 1000,
  });

  if (results.hits.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * results.hits.length);
  const hit = results.hits[randomIndex];
  return {
    id: hit.document.id,
    passageKey: hit.document.passageKey,
    textId: hit.document.textId as TextId,
    book: hit.document.book,
    chapter: hit.document.chapter,
    verse: hit.document.verse,
    originalText: hit.document.originalText,
    translation: hit.document.translation,
    language: hit.document.language,
    verseOrder: hit.document.verseOrder,
    themes: hit.document.themes,
    themeScores: {},
  };
}

/**
 * Get passages for a book (for chapter view)
 */
export async function getPassagesByBook(textId: TextId, book: string, limit = 100, offset = 0): Promise<PassageDoc[]> {
  if (!oramaDB) {
    oramaDB = await initializeOramaIndex();
  }

  const results = await search(oramaDB, {
    term: '',
    where: { textId, book },
    limit: limit + offset,
    sortBy: { property: 'verseOrder', order: 'ASC' },
  });

  return results.hits.slice(offset, offset + limit).map(hit => ({
    id: hit.document.id,
    passageKey: hit.document.passageKey,
    textId: hit.document.textId as TextId,
    book: hit.document.book,
    chapter: hit.document.chapter,
    verse: hit.document.verse,
    originalText: hit.document.originalText,
    translation: hit.document.translation,
    language: hit.document.language,
    verseOrder: hit.document.verseOrder,
    themes: hit.document.themes,
    themeScores: {},
  }));
}

/**
 * Get passages for a chapter
 */
export async function getPassagesByChapter(textId: TextId, book: string, chapter: number): Promise<PassageDoc[]> {
  if (!oramaDB) {
    oramaDB = await initializeOramaIndex();
  }

  const results = await search(oramaDB, {
    term: '',
    where: { textId, book, chapter: chapter.toString() },
    limit: 500,
    sortBy: { property: 'verseOrder', order: 'ASC' },
  });

  return results.hits.map(hit => ({
    id: hit.document.id,
    passageKey: hit.document.passageKey,
    textId: hit.document.textId as TextId,
    book: hit.document.book,
    chapter: hit.document.chapter,
    verse: hit.document.verse,
    originalText: hit.document.originalText,
    translation: hit.document.translation,
    language: hit.document.language,
    verseOrder: hit.document.verseOrder,
    themes: hit.document.themes,
    themeScores: {},
  }));
}

// ============================================================================
// THEMATIC SEARCH
// ============================================================================

/**
 * Search by theme across texts
 */
export async function searchByTheme(
  theme: string,
  options: Omit<SearchOptions, 'themes' | 'term'> = {}
): Promise<SearchResult> {
  return searchPassages({
    ...options,
    term: '',
    themes: [theme],
    properties: ['themes', 'translation', 'originalText'],
  });
}

/**
 * Get all unique themes in index
 */
export async function getAllThemes(): Promise<string[]> {
  if (!oramaDB) {
    oramaDB = await initializeOramaIndex();
  }

  const results = await search(oramaDB, { term: '', limit: 10000 });
  const themeSet = new Set<string>();
  results.hits.forEach(hit => {
    (hit.document.themes || []).forEach(t => themeSet.add(t));
  });
  return Array.from(themeSet).sort();
}

// ============================================================================
// STATISTICS
// ============================================================================

export async function getIndexStats(): Promise<{
  totalDocuments: number;
  byText: Record<string, number>;
  byLanguage: Record<string, number>;
}> {
  if (!oramaDB) {
    oramaDB = await initializeOramaIndex();
  }

  const results = await search(oramaDB, { term: '', limit: 100000 });
  const docs = results.hits.map(h => h.document);

  const byText: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};

  for (const doc of docs) {
    byText[doc.textId] = (byText[doc.textId] || 0) + 1;
    byLanguage[doc.language] = (byLanguage[doc.language] || 0) + 1;
  }

  return {
    totalDocuments: docs.length,
    byText,
    byLanguage,
  };
}

// ============================================================================
// UTILITY: Get Orama DB instance
// ============================================================================

export function getOramaDB(): OramaDB | null {
  return oramaDB;
}

export function isIndexReady(): boolean {
  return oramaDB !== null;
}