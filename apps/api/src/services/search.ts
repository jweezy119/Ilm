/**
 * Search Service - OramaJS full-text search
 * Replaces Meilisearch + Qdrant with in-memory Orama
 */

import { PrismaClient } from '@prisma/client';
import { SearchQuery, SearchResponse, SearchResult, Passage, TextId, SearchIntent } from '@ilm/shared';
import { classifySearchIntent } from './typesafe';
import { 
  searchPassages as oramaSearch, 
  searchByPassageKey as oramaSearchByKey,
  getRandomPassage as oramaRandomPassage,
  searchByTheme as oramaSearchByTheme,
  initializeOramaIndex,
  getIndexStats,
} from '../search/orama';

const prisma = new PrismaClient();

// Initialize index on module load
let indexInitialized = false;

async function ensureIndex(): Promise<void> {
  if (!indexInitialized) {
    await initializeOramaIndex();
    indexInitialized = true;
  }
}

// ============================================================================
// SEARCH EXECUTION
// ============================================================================

export async function searchPassages(query: SearchQuery): Promise<SearchResponse> {
  await ensureIndex();
  const startTime = Date.now();
  
  // Classify intent
  const intentResult = await classifySearchIntent(query.query);
  
  // Build Orama search options
  const searchOptions: any = {
    term: query.query,
    textIds: query.filters?.texts,
    books: query.filters?.books,
    chapters: query.filters?.chapters,
    languages: query.filters?.languages,
    themes: query.filters?.themes,
    limit: query.limit,
    offset: query.offset,
    properties: ['translation', 'originalText', 'book', 'themes'],
    sortBy: 'relevance',
  };
  
  // Execute search
  const oramaResult = await oramaSearch(searchOptions);
  
  // Map results to SearchResponse format
  const results: SearchResult[] = oramaResult.hits.map(hit => ({
    passage: {
      id: hit.document.id,
      passageKey: hit.document.passageKey,
      textId: hit.document.textId,
      book: hit.document.book,
      chapter: parseInt(hit.document.chapter, 10),
      verse: parseInt(hit.document.verse, 10),
      originalText: hit.document.originalText,
      translation: hit.document.translation,
      alternativeTranslations: [],
      metadata: { verseOrder: hit.document.verseOrder, language: hit.document.language },
      embeddings: [],
      themes: hit.document.themes.map(theme => ({
        theme,
        score: 0.8,
        confidence: 0.8,
        evidence: [],
        source: 'jev' as const,
      })),
      crossReferences: [],
    } as Passage,
    score: hit.score,
    matchedFields: ['translation', 'originalText'],
    highlights: {
      translation: [hit.document.translation],
      originalText: [hit.document.originalText],
    },
    intentConfidence: intentResult.confidence,
  }));
  
  // Generate suggestions
  const suggestions = await generateSuggestions(query.query, intentResult.intent);
  
  return {
    results,
    total: oramaResult.count,
    query,
    tookMs: Date.now() - startTime,
    suggestions,
  };
}

export async function searchByPassageKey(key: string): Promise<Passage | null> {
  await ensureIndex();
  
  const doc = await oramaSearchByKey(key);
  if (!doc) return null;
  
  return {
    id: doc.id,
    passageKey: doc.passageKey,
    textId: doc.textId,
    book: doc.book,
    chapter: parseInt(doc.chapter, 10),
    verse: parseInt(doc.verse, 10),
    originalText: doc.originalText,
    translation: doc.translation,
    alternativeTranslations: [],
    metadata: { verseOrder: doc.verseOrder, language: doc.language },
    embeddings: [],
    themes: doc.themes.map(theme => ({
      theme,
      score: 0.8,
      confidence: 0.8,
      evidence: [],
      source: 'jev' as const,
    })),
crossReferences: [],
  } as Passage
}

export async function getRandomPassage(textId?: TextId): Promise<Passage | null> {
  await ensureIndex();
  
  const doc = await oramaRandomPassage(textId);
  if (!doc) return null;
  
  const passage = {
    id: doc.id,
    passageKey: doc.passageKey,
    textId: doc.textId,
    book: doc.book,
    chapter: parseInt(doc.chapter, 10),
    verse: parseInt(doc.verse, 10),
    originalText: doc.originalText,
    translation: doc.translation,
    alternativeTranslations: [],
    metadata: { verseOrder: doc.verseOrder, language: doc.language },
    embeddings: [],
    themes: doc.themes.map(theme => ({
      theme,
      score: 0.8,
      confidence: 0.8,
      evidence: [],
      source: 'jev' as const,
    })),
    crossReferences: [],
  } as Passage;
  
  return passage;
}

export async function searchByTheme(theme: string, options: SearchQuery = { query: '', limit: 20 }): Promise<SearchResult[]> {
  await ensureIndex();
  
  const oramaResult = await oramaSearchByTheme(theme, {
    limit: options.limit,
    textIds: options.filters?.texts,
  });
  
  return oramaResult.hits.map(hit => ({
    passage: {
      id: hit.document.id,
      passageKey: hit.document.passageKey,
      textId: hit.document.textId,
      book: hit.document.book,
      chapter: parseInt(hit.document.chapter, 10),
      verse: parseInt(hit.document.verse, 10),
      originalText: hit.document.originalText,
      translation: hit.document.translation,
      alternativeTranslations: [],
      metadata: { verseOrder: hit.document.verseOrder, language: hit.document.language },
      embeddings: [],
      themes: hit.document.themes.map(t => ({
        theme: t,
        score: 0.8,
        confidence: 0.8,
        evidence: [],
        source: 'jev' as const,
      })),
      crossReferences: [],
    } as Passage,
    score: hit.score,
    matchedFields: ['themes'],
    highlights: {},
  }));
}

export async function getSearchStats(): Promise<{
  totalDocuments: number;
  byText: Record<string, number>;
  byLanguage: Record<string, number>;
}> {
  await ensureIndex();
  return getIndexStats();
}

// ============================================================================
// SUGGESTIONS
// ============================================================================

async function generateSuggestions(query: string, intent: SearchIntent): Promise<string[]> {
  const intentSuggestions: Record<SearchIntent, string[]> = {
    comparison: [
      `${query} compare`,
      `${query} side by side`,
      `${query} parallel passages`,
    ],
    explanation: [
      `${query} meaning`,
      `${query} commentary`,
      `${query} tafsir`,
    ],
    thematic_study: [
      `${query} theme`,
      `${query} across texts`,
      `${query} in quran and bible`,
    ],
    linguistic_analysis: [
      `${query} etymology`,
      `${query} root word`,
      `${query} grammar`,
    ],
    cross_reference: [
      `${query} referenced in`,
      `${query} quoted in`,
      `${query} parallel`,
    ],
    reading: [
      `${query} full text`,
      `${query} chapter`,
      `${query} audio`,
    ],
    unknown: [],
  };
  
  return intentSuggestions[intent] || [];
}

// ============================================================================
// ANALYTICS
// ============================================================================

export async function logSearch(
  query: string,
  intent: SearchIntent | undefined,
  filters: SearchQuery['filters'],
  resultCount: number,
  tookMs: number,
  userId?: string,
  sessionId?: string
): Promise<void> {
  await prisma.searchLog.create({
    data: {
      query,
      intent: intent || 'unknown',
      filters: filters || {},
      resultCount,
      tookMs,
      userId,
      sessionId,
      ipHash: '',
    },
  });
}

// ============================================================================
// VECTOR SEARCH (placeholder - embeddings in Postgres)
// ============================================================================

export async function vectorSearch(
  embedding: number[],
  limit: number = 10,
  filter?: Record<string, unknown>
): Promise<Array<{ id: string; score: number; payload: Record<string, unknown> }>> {
  // Vector search would fetch embeddings from Postgres and compute cosine similarity
  // For now, return empty - can be implemented later
  return [];
}

export async function hybridSearch(
  query: string,
  embedding: number[],
  limit: number = 10,
  filters?: SearchQuery['filters']
): Promise<SearchResult[]> {
  // Run text search (Orama handles this well)
  const textResults = await searchPassages({ query, limit: limit * 2, filters });
  
  // Vector search would be added here
  return textResults.results;
}