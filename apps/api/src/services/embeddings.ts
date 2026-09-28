/**
 * Embeddings
 *
 * Optional. When an embedding provider is configured, vectors feed the local
 * candidate ranking in recommendations. Without one, ranking falls back to theme
 * and term overlap, so the app stays fully functional.
 *
 * Three providers: OpenRouter, OpenAI, and a local model that runs in-process.
 *
 * ## On the local model
 *
 * `paraphrase-multilingual-MiniLM-L12-v2` runs through ONNX on CPU, so there is no
 * API key, no per-request cost and no data leaving the machine. It is multilingual
 * because the corpus is not monolingual.
 *
 * Measured on this corpus, and worth knowing before relying on it:
 *   - English to English across all five corpora is usable. The two love passages
 *     (John 3:16 and 1 John 4:9) score 0.74 against each other and 0.24–0.49
 *     against everything else.
 *   - Arabic to Arabic and Hebrew to Hebrew are usable (0.52–0.93).
 *   - Hebrew to English is effectively zero (0.024). So this cannot be used for
 *     cognate detection across scripts, which is the one thing an embedding of the
 *     original text would have been good for. It measures meaning in one language,
 *     not across them.
 *
 * It is a similarity signal, not a judgement: it reflects shared English wording as
 * much as shared doctrine. It is combined with themes and, when available, a model,
 * never used alone.
 */

import { Prisma } from '@prisma/client';
import { prisma } from './passage';

export interface EmbeddingConfig {
  provider: 'openrouter' | 'openai' | 'local';
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * The default local checkpoint. 384 dimensions, int8-quantised ONNX, and the one
 * model in this family that covers Arabic, Hebrew and Greek as well as English.
 */
const LOCAL_MODEL = process.env.LOCAL_EMBEDDING_MODEL ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

export function getEmbeddingConfig(): EmbeddingConfig | null {
  // Explicit choice first, so a deploy is never surprised by a model download.
  if (process.env.EMBEDDING_PROVIDER === 'local') {
    return { provider: 'local', apiKey: '', baseUrl: '', model: LOCAL_MODEL };
  }

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

// ---------------------------------------------------------------------------
// Local model
// ---------------------------------------------------------------------------

type FeatureExtractor = (
  input: string | string[],
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array | number[] | number[][]; dims: number[] }>;

/**
 * The extractor is loaded once and kept. Loading the ONNX session costs seconds, and
 * doing that per batch would dominate a backfill that calls this thousands of times.
 */
let localExtractor: Promise<FeatureExtractor> | null = null;

async function getLocalExtractor(model: string): Promise<FeatureExtractor> {
  if (!localExtractor) {
    localExtractor = (async () => {
      // Imported lazily so a deploy that never asks for local embeddings does not
      // pay for the dependency or attempt a model download at boot.
      const { pipeline } = await import('@xenova/transformers');
      return (await pipeline('feature-extraction', model, { quantized: true })) as unknown as FeatureExtractor;
    })().catch((error) => {
      // A failed load must not be cached, or one transient error disables the
      // provider for the life of the process.
      localExtractor = null;
      throw error;
    });
  }
  return localExtractor;
}

/**
 * Embed text with the local model.
 *
 * Sent as a real batch rather than one call per string: the ONNX session amortises
 * its setup across the batch, which is worth about 1.6x on CPU and is the difference
 * between a backfill finishing in two hours and in three.
 *
 * Text is passed whole. Truncating would be faster still, but a truncated Talmudic
 * passage stops mid-argument and the vector stops representing the passage, which
 * is worse than waiting.
 */
export async function generateLocalEmbeddings(texts: string[], model = LOCAL_MODEL, batchSize = 16): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getLocalExtractor(model);

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const result = await extractor(batch, { pooling: 'mean', normalize: true });

    // The session returns a flat typed array plus a `dims` shape, not a nested
    // array. Reading it as nested reports one vector for the whole batch, which
    // then gets written against a single passage.
    const { dims } = result;
    // The session returns a flat typed array plus a `dims` shape. A single input
    // comes back flat too, so `dims` is what distinguishes the two cases.
    const flat = result.data as Float32Array | number[];
    const vectors: number[][] = [];

    if (dims.length === 2) {
      const [rows, width] = dims;
      for (let r = 0; r < rows; r += 1) vectors.push(Array.from(flat.slice(r * width, (r + 1) * width)));
    } else if (Array.isArray(result.data[0])) {
      for (const row of result.data as number[][]) vectors.push(row);
    } else {
      vectors.push(Array.from(flat));
    }

    if (vectors.length !== batch.length) {
      throw new Error(`Local model returned ${vectors.length} vectors for ${batch.length} inputs (dims ${dims.join('x')})`);
    }

    for (const vector of vectors) {
      // A zero-length vector is worse than no vector: it is stored, counted as
      // embedded, and silently disables similarity for that pair forever.
      if (vector.length === 0) {
        throw new Error('Local model returned an empty vector');
      }
      out.push(vector);
    }
  }
  return out;
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

  if (config.provider === 'local') {
    return generateLocalEmbeddings(texts, config.model, Number(process.env.LOCAL_EMBEDDING_BATCH ?? 16));
  }

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

  // A short or misaligned vector would be written against the wrong passage. The
  // count is checked, and so is each vector's length, because a zero-length one
  // reads as "embedded" forever while contributing nothing.
  if (vectors.length !== texts.length) {
    throw new Error(`Expected ${texts.length} vectors, got ${vectors.length}`);
  }
  const bad = vectors.findIndex((v) => v.length === 0);
  if (bad !== -1) {
    throw new Error(`Vector ${bad} is empty; refusing to write a batch containing one`);
  }

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
