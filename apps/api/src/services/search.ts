/**
 * Search Service - Unified semantic + full-text search across all texts
 */

import { PrismaClient } from '@prisma/client';
import { SearchQuery, SearchResponse, SearchResult, Passage, TextId, SearchIntent } from '@ilm/shared';
import { classifySearchIntent } from './typesafe';
import MeiliSearch from 'meilisearch';

const prisma = new PrismaClient();

// Meilisearch client
const meiliClient = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
  apiKey: process.env.MEILISEARCH_API_KEY,
});

const PASSAGE_INDEX = 'passages';

// ============================================================================
// INDEX MANAGEMENT
// ============================================================================

export async function ensureIndex(): Promise<void> {
  try {
    await meiliClient.getIndex(PASSAGE_INDEX);
  } catch {
    await meiliClient.createIndex(PASSAGE_INDEX, { primaryKey: 'id' });
    const index = meiliClient.index(PASSAGE_INDEX);
    
    await index.updateSearchableAttributes([
      'originalText',
      'translation',
      'book',
      'textId',
      'themes',
    ]);
    
    await index.updateFilterableAttributes([
      'textId',
      'book',
      'chapter',
      'language',
      'verseNum',
    ]);
    
    await index.updateSortableAttributes(['verseOrder']);
    
    await index.updateRankingRules([
      'words',
      'typo',
      'proximity',
      'attribute',
      'sort',
      'exactness',
      'semanticScore:desc', // Custom ranking rule
    ]);
  }
}

export async function indexPassage(passage: Passage): Promise<void> {
  const index = meiliClient.index(PASSAGE_INDEX);
  
  const doc = {
    id: passage.id,
    passageKey: passage.passageKey,
    textId: passage.textId,
    book: passage.book,
    chapter: passage.chapterNum,
    verse: passage.verseNum,
    originalText: passage.originalText,
    translation: passage.primaryTranslation,
    language: passage.language,
    verseOrder: passage.verseOrder,
    themes: passage.themes?.map(t => t.theme) || [],
    themeScores: passage.themes?.reduce((acc, t) => ({ ...acc, [t.theme]: t.score }), {}) || {},
    embeddings: passage.embeddings || [],
    metadata: passage.metadata,
  };
  
  await index.addDocuments([doc]);
}

export async function indexPassagesBatch(passages: Passage[]): Promise<void> {
  const index = meiliClient.index(PASSAGE_INDEX);
  const docs = passages.map(p => ({
    id: p.id,
    passageKey: p.passageKey,
    textId: p.textId,
    book: p.book,
    chapter: p.chapterNum,
    verse: p.verseNum,
    originalText: p.originalText,
    translation: p.primaryTranslation,
    language: p.language,
    verseOrder: p.verseOrder,
    themes: p.themes?.map(t => t.theme) || [],
    themeScores: p.themes?.reduce((acc, t) => ({ ...acc, [t.theme]: t.score }), {}) || {},
    embeddings: p.embeddings || [],
    metadata: p.metadata,
  }));
  
  // Meilisearch handles batches efficiently
  await index.addDocumentsInBatches(docs, 1000);
}

export async function removeFromIndex(passageId: string): Promise<void> {
  const index = meiliClient.index(PASSAGE_INDEX);
  await index.deleteDocument(passageId);
}

// ============================================================================
// SEARCH EXECUTION
// ============================================================================

export async function searchPassages(query: SearchQuery): Promise<SearchResponse> {
  const startTime = Date.now();
  const index = meiliClient.index(PASSAGE_INDEX);
  
  // Classify intent
  const intentResult = await classifySearchIntent(query.query);
  
  // Build filter
  const filterParts: string[] = [];
  if (query.filters?.texts?.length) {
    filterParts.push(`textId IN [${query.filters.texts.map(t => `"${t}"`).join(', ')}]`);
  }
  if (query.filters?.books?.length) {
    filterParts.push(`book IN [${query.filters.books.map(b => `"${b}"`).join(', ')}]`);
  }
  if (query.filters?.chapters?.length) {
    filterParts.push(`chapter IN [${query.filters.chapters.join(', ')}]`);
  }
  if (query.filters?.languages?.length) {
    filterParts.push(`language IN [${query.filters.languages.map(l => `"${l}"`).join(', ')}]`);
  }
  
  const filter = filterParts.length > 0 ? filterParts.join(' AND ') : undefined;
  
  // Execute search
  const searchResult = await index.search(query.query, {
    filter,
    limit: query.limit,
    offset: query.offset,
    attributesToRetrieve: [
      'id', 'passageKey', 'textId', 'book', 'chapter', 'verse',
      'originalText', 'translation', 'language', 'themes', 'themeScores'
    ],
    attributesToHighlight: ['originalText', 'translation'],
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',
    showMatchesPosition: true,
    showRankingScore: true,
    rankingScoreThreshold: 0.1,
  });
  
  // Map results
  const results: SearchResult[] = searchResult.hits.map((hit: any) => ({
    passage: {
      id: hit.id,
      passageKey: hit.passageKey,
      textId: hit.textId,
      book: hit.book,
      chapter: hit.chapter,
      verse: hit.verse,
      originalText: hit.originalText,
      translation: hit.translation,
      alternativeTranslations: [],
      metadata: hit.metadata,
      embeddings: hit.embeddings,
      themes: Object.entries(hit.themeScores || {}).map(([theme, score]) => ({
        theme,
        score: score as number,
        confidence: 0.8,
        evidence: [],
        source: 'jev' as const,
      })),
      crossReferences: [],
    } as Passage,
    score: hit.rankingScore || 0.5,
    matchedFields: Object.keys(hit._matchesPosition || {}),
    highlights: hit._formatted ? {
      originalText: hit._formatted.originalText ? [hit._formatted.originalText] : [],
      translation: hit._formatted.translation ? [hit._formatted.translation] : [],
    } : {},
    intentConfidence: intentResult.confidence,
  }));
  
  // Generate suggestions
  const suggestions = await generateSuggestions(query.query, intentResult.intent);
  
  return {
    results,
    total: searchResult.estimatedTotalHits || results.length,
    query,
    tookMs: Date.now() - startTime,
    suggestions,
  };
}

export async function searchByPassageKey(key: string): Promise<Passage | null> {
  const index = meiliClient.index(PASSAGE_INDEX);
  const result = await index.search('', {
    filter: `passageKey = "${key}"`,
    limit: 1,
  });
  
  if (result.hits.length === 0) return null;
  
  const hit = result.hits[0];
  return {
    id: hit.id,
    passageKey: hit.passageKey,
    textId: hit.textId,
    book: hit.book,
    chapter: hit.chapter,
    verse: hit.verse,
    originalText: hit.originalText,
    translation: hit.translation,
    alternativeTranslations: [],
    metadata: hit.metadata,
    embeddings: hit.embeddings,
    themes: Object.entries(hit.themeScores || {}).map(([theme, score]) => ({
      theme,
      score: score as number,
      confidence: 0.8,
      evidence: [],
      source: 'jev' as const,
    })),
    crossReferences: [],
  } as Passage;
}

export async function getRandomPassage(textId?: TextId): Promise<Passage | null> {
  const index = meiliClient.index(PASSAGE_INDEX);
  const filter = textId ? `textId = "${textId}"` : undefined;
  
  const result = await index.search('', {
    filter,
    limit: 1,
    sort: ['verseOrder:asc'], // Will need random sort - use offset
  });
  
  // For true random, use random offset
  const stats = await index.getStats();
  const randomOffset = Math.floor(Math.random() * (stats.numberOfDocuments || 1));
  
  const randomResult = await index.search('', {
    filter,
    limit: 1,
    offset: randomOffset,
  });
  
  if (randomResult.hits.length === 0) return null;
  
  const hit = randomResult.hits[0];
  return {
    id: hit.id,
    passageKey: hit.passageKey,
    textId: hit.textId,
    book: hit.book,
    chapter: hit.chapter,
    verse: hit.verse,
    originalText: hit.originalText,
    translation: hit.translation,
    alternativeTranslations: [],
    metadata: hit.metadata,
    embeddings: hit.embeddings,
    themes: Object.entries(hit.themeScores || {}).map(([theme, score]) => ({
      theme,
      score: score as number,
      confidence: 0.8,
      evidence: [],
      source: 'jev' as const,
    })),
    crossReferences: [],
  } as Passage;
}

// ============================================================================
// VECTOR SEARCH (Qdrant)
// ============================================================================

interface VectorSearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export async function vectorSearch(
  embedding: number[],
  limit: number = 10,
  filter?: Record<string, unknown>
): Promise<VectorSearchResult[]> {
  // Use Qdrant REST API
  const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
  const collection = 'passages';
  
  const response = await fetch(`${qdrantUrl}/collections/${collection}/points/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {}),
    },
    body: JSON.stringify({
      vector: embedding,
      limit,
      filter: filter ? { must: Object.entries(filter).map(([key, value]) => ({
        key,
        match: { value },
      })) } : undefined,
      with_payload: true,
      with_vectors: false,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Vector search failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.result || [];
}

export async function hybridSearch(
  query: string,
  embedding: number[],
  limit: number = 10,
  filters?: SearchQuery['filters']
): Promise<SearchResult[]> {
  // Run both searches in parallel
  const [textResults, vectorResults] = await Promise.all([
    searchPassages({ query, limit: limit * 2, filters }),
    vectorSearch(embedding, limit * 2, filters as Record<string, unknown>),
  ]);
  
  // Merge and re-rank (reciprocal rank fusion)
  const merged = new Map<string, SearchResult>();
  
  textResults.results.forEach((r, i) => {
    merged.set(r.passage.id, { ...r, score: r.score * 0.6 + (1 / (i + 1)) * 0.4 });
  });
  
  vectorResults.forEach((v, i) => {
    const existing = merged.get(v.id);
    const vectorScore = v.score * 0.4 + (1 / (i + 1)) * 0.6;
    if (existing) {
      existing.score = Math.max(existing.score, vectorScore);
    } else {
      // Fetch full passage from Meili
      const passage = await searchByPassageKey(v.payload.passageKey as string);
      if (passage) {
        merged.set(v.id, {
          passage,
          score: vectorScore,
          matchedFields: [],
          highlights: {},
        });
      }
    }
  });
  
  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ============================================================================
// SUGGESTIONS
// ============================================================================

async function generateSuggestions(query: string, intent: SearchIntent): Promise<string[]> {
  // In production, use MeiliSearch's autocomplete or a dedicated suggestions index
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
      ipHash: '', // Hash in production
    },
  });
}