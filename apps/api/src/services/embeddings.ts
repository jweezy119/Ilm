/**
 * Embeddings
 *
 * Optional. When an embedding provider is configured, vectors feed the local
 * candidate ranking in recommendations. Without one, ranking falls back to theme
 * and term overlap, so the app stays fully functional.
 *
 * Supports OpenRouter (many models) and OpenAI directly.
 */

import { Prisma } from '@prisma/client';
import { prisma } from './passage';

export interface EmbeddingConfig {
  provider: 'openrouter' | 'openai';
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getEmbeddingConfig(): EmbeddingConfig | null {
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openrouterKey && !openrouterKey.startsWith('your_')) {
    return {
      provider: 'openrouter',
      apiKey: openrouterKey,
      baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      model: process.env.EMBEDDING_MODEL ?? 'openai/text-embedding-3-small',
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey && !openaiKey.startsWith('your_')) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    };
  }

  return null;
}

export function isEmbeddingConfigured(): boolean {
  return getEmbeddingConfig() !== null;
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
}

async function requestEmbeddings(config: EmbeddingConfig, input: string[]): Promise<number[][]> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...(config.provider === 'openrouter'
        ? { 'HTTP-Referer': 'https://ilm.app', 'X-Title': 'Ilm' }
        : {}),
    },
    body: JSON.stringify({ model: config.model, input, encoding_format: 'float' }),
  });

  if (!response.ok) {
    throw new Error(`Embedding provider returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const payload = (await response.json()) as EmbeddingResponse;
  const vectors = payload.data?.map((d) => d.embedding).filter((v): v is number[] => Array.isArray(v)) ?? [];

  if (vectors.length !== input.length) {
    throw new Error(`Embedding provider returned ${vectors.length} vectors for ${input.length} inputs`);
  }

  return vectors;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const config = getEmbeddingConfig();
  if (!config) throw new Error('No embedding provider configured');
  if (texts.length === 0) return [];

  const batchSize = Number(process.env.EMBEDDING_BATCH_SIZE ?? 64);
  const all: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    all.push(...(await requestEmbeddings(config, texts.slice(i, i + batchSize))));
  }

  return all;
}

/**
 * Embed passages that have none yet.
 * Returns the number of passages updated so a caller can loop until it hits 0.
 */
export async function embedMissingPassages(batchSize = 200): Promise<number> {
  const config = getEmbeddingConfig();
  if (!config) {
    console.log('[embeddings] no provider configured — skipping. Recommendation ranking will use lexical overlap only.');
    return 0;
  }

  const passages = await prisma.passage.findMany({
    where: { OR: [{ embeddings: { equals: Prisma.DbNull } }, { embeddings: { equals: [] } }] },
    select: { id: true, primaryTranslation: true, originalText: true },
    take: batchSize,
    orderBy: { verseOrder: 'asc' },
  });

  if (passages.length === 0) return 0;

  const texts = passages.map((p) => [p.primaryTranslation, p.originalText].filter(Boolean).join(' '));
  const vectors = await generateEmbeddings(texts);

  await prisma.$transaction(
    vectors.map((vector, i) =>
      prisma.passage.update({ where: { id: passages[i].id }, data: { embeddings: vector as unknown as Prisma.InputJsonValue } })
    )
  );

  return passages.length;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
