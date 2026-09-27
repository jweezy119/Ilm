/**
 * Embeddings Service
 * Supports OpenRouter (multiple models) and OpenAI
 * Generates vector embeddings for semantic search
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface EmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function getEmbeddingConfig(): EmbeddingConfig {
  // Prefer OpenRouter if configured
  if (process.env.OPENROUTER_API_KEY) {
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    };
  }
  
  // Fallback to OpenAI
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    };
  }
  
  throw new Error('No embedding API key configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY');
}

/**
 * Generate embeddings for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const config = getEmbeddingConfig();
  
  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'HTTP-Referer': 'https://ilm.app',
      'X-Title': 'Ilm Sacred Text Platform',
    },
    body: JSON.stringify({
      model: config.model,
      input: text,
      encoding_format: 'float',
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API error: ${response.status} ${error}`);
  }
  
  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in batches
 */
export async function generateEmbeddingsBatch(texts: string[], batchSize = 100): Promise<number[][]> {
  const config = getEmbeddingConfig();
  const allEmbeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    const response = await fetch(`${config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'HTTP-Referer': 'https://ilm.app',
        'X-Title': 'Ilm Sacred Text Platform',
      },
      body: JSON.stringify({
        model: config.model,
        input: batch,
        encoding_format: 'float',
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embedding API error: ${response.status} ${error}`);
    }
    
    const data = await response.json();
    const embeddings = data.data.map((d: any) => d.embedding);
    allEmbeddings.push(...embeddings);
    
    // Rate limiting
    if (i + batchSize < texts.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  return allEmbeddings;
}

/**
 * Generate and store embeddings for passages missing them
 */
export async function generateMissingEmbeddings(batchSize = 50): Promise<number> {
  const passages = await prisma.passage.findMany({
    where: {
      OR: [
        { embeddings: { equals: [] } },
        { embeddings: null },
      ],
    },
    take: batchSize,
    orderBy: { verseOrder: 'asc' },
  });
  
  if (passages.length === 0) {
    console.log('✅ All passages have embeddings');
    return 0;
  }
  
  console.log(`🧮 Generating embeddings for ${passages.length} passages...`);
  
  const texts = passages.map(p => `${p.primaryTranslation} ${p.originalText}`);
  const embeddings = await generateEmbeddingsBatch(texts);
  
  for (let i = 0; i < passages.length; i++) {
    await prisma.passage.update({
      where: { id: passages[i].id },
      data: { embeddings: embeddings[i] },
    });
  }
  
  console.log(`✅ Stored ${passages.length} embeddings`);
  return passages.length;
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find similar passages using vector similarity
 * Fetches embeddings from Postgres and computes similarity in memory
 */
export async function findSimilarPassages(
  queryEmbedding: number[],
  options: {
    limit?: number;
    textIds?: string[];
    minSimilarity?: number;
  } = {}
): Promise<Array<{ id: string; passageKey: string; textId: string; book: string; chapter: number; verse: number; translation: string; similarity: number }>> {
  const { limit = 10, textIds, minSimilarity = 0.5 } = options;
  
  const where: any = {
    embeddings: { not: [] },
  };
  
  if (textIds?.length) {
    where.textId = { in: textIds };
  }
  
  const passages = await prisma.passage.findMany({
    where,
    select: {
      id: true,
      passageKey: true,
      textId: true,
      bookId: true,
      chapterNum: true,
      verseNum: true,
      primaryTranslation: true,
      embeddings: true,
    },
  });
  
  const results = passages
    .map(p => ({
      ...p,
      similarity: cosineSimilarity(queryEmbedding, p.embeddings as number[]),
    }))
    .filter(p => p.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
  
  return results.map(p => ({
    id: p.id,
    passageKey: p.passageKey,
    textId: p.textId,
    book: p.bookId,
    chapter: p.chapterNum,
    verse: p.verseNum,
    translation: p.primaryTranslation,
    similarity: p.similarity,
  }));
}