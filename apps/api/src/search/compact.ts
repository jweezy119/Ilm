/**
 * Compressed In-Process Hybrid Search Engine (`SEARCH_ENGINE=compact`)
 *
 * Combines:
 *   1) Delta+varint compressed multi-script BM25+ inverted index (~12-18 MB RAM)
 *   2) 2-stage quantized semantic vector index (1-bit BQ 2.2 MB + Int8 SQ8 5.9 MB)
 *   3) Reciprocal Rank Fusion (RRF) blending lexical + original-script + dense
 *      semantic scores while preserving unsaturated score ordering (AGENTS.md).
 *
 * Loads in ~1-2 seconds from `corpus.ilm.pack.br` (zero Postgres needed when
 * `ILM_STORAGE=pack`), or builds in one lean query from Postgres if no pack
 * file exists yet.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import type { TextId } from '@ilm/shared';
import { prisma } from '../lib/db';
import {
  defaultPackPath,
  dequantizeU8,
  packPassageKey,
  unpackThemesByDoc,
  unpackVerseOrders,
  type DecodedIlmPack,
} from '../lib/ilm-pack';
import { isPackStorageEnabled, tryLoadPackStore } from '../lib/pack-store';
import { generateEmbeddings, isEmbeddingConfigured } from '../services/embeddings';
import { CompactBm25Index, type CompactDocInput } from './compact-bm25';
import { CompactVectorIndex } from './compact-vectors';
import type {
  IndexHit,
  IndexSearchOptions,
  IndexSearchResult,
  MatchMode,
  PassageDoc,
} from './postgres';

let bm25Index: CompactBm25Index | null = null;
let vectorIndex: CompactVectorIndex | null = null;
let loadingPromise: Promise<CompactBm25Index> | null = null;

function defaultVectorPath(): string {
  const configured = process.env.ILM_VECTOR_PATH?.trim();
  if (configured) return configured;
  return fileURLToPath(new URL('../../data/vectors.ilm.vec.br', import.meta.url));
}

function tryLoadStandaloneVectors(expectedCount: number): CompactVectorIndex | null {
  const vecPath = defaultVectorPath();
  if (!existsSync(vecPath)) return null;
  try {
    const raw = readFileSync(vecPath);
    const decompressed = vecPath.endsWith('.br') ? brotliDecompressSync(raw) : raw;
    const loaded = CompactVectorIndex.deserialize(
      new Uint8Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength)
    );
    if (loaded.count !== expectedCount) {
      console.warn(
        `[compact-search] ignoring vector file (${loaded.count} docs) — index has ${expectedCount} docs`
      );
      return null;
    }
    return loaded;
  } catch (error) {
    console.warn('[compact-search] could not load vector file:', (error as Error).message);
    return null;
  }
}

export function buildCompactFromPack(pack: DecodedIlmPack): {
  bm25: CompactBm25Index;
  vectors: CompactVectorIndex | null;
} {
  const { payload, vectorBlob } = pack;
  const verseOrders = unpackVerseOrders(payload);
  const themesByDoc = unpackThemesByDoc(payload);

  const docs: CompactDocInput[] = new Array(payload.count);
  for (let i = 0; i < payload.count; i += 1) {
    const textId = payload.texts[payload.textIdx[i]] as TextId;
    const book = payload.books[payload.bookIdx[i]];
    const tEntries = themesByDoc.get(i);
    docs[i] = {
      passageKey: packPassageKey(payload, i),
      textId,
      book: book.bookId,
      chapter: payload.chapters[i],
      verse: payload.verses[i],
      translation: payload.translations[i] ?? '',
      originalText: payload.originals[i] ?? '',
      language: payload.languages[payload.langIdx[i]] ?? 'english',
      verseOrder: verseOrders[i],
      themes: tEntries ? tEntries.map((t) => t.theme) : [],
      density: dequantizeU8(payload.densityQ8[i]),
    };
  }

  const bm25 = new CompactBm25Index(docs);
  let vectors: CompactVectorIndex | null = null;
  if (vectorBlob && vectorBlob.byteLength > 0) {
    try {
      const decoded = CompactVectorIndex.deserialize(vectorBlob);
      if (decoded.count === docs.length) vectors = decoded;
    } catch (error) {
      console.warn('[compact-search] could not decode embedded vectors:', (error as Error).message);
    }
  }
  if (!vectors) vectors = tryLoadStandaloneVectors(docs.length);
  return { bm25, vectors };
}

async function buildCompactFromPostgres(): Promise<{
  bm25: CompactBm25Index;
  vectors: CompactVectorIndex | null;
}> {
  const [rows, themeRows] = await Promise.all([
    prisma.passage.findMany({
      select: {
        id: true,
        passageKey: true,
        textId: true,
        bookSlug: true,
        chapterNum: true,
        verseNum: true,
        primaryTranslation: true,
        originalText: true,
        language: true,
        verseOrder: true,
        metadata: true,
      },
      orderBy: [{ verseOrder: 'asc' }, { passageKey: 'asc' }],
    }),
    prisma.passageTheme.findMany({
      select: { passageId: true, themeId: true },
    }),
  ]);

  const themesById = new Map<string, string[]>();
  for (const t of themeRows) {
    let list = themesById.get(t.passageId);
    if (!list) {
      list = [];
      themesById.set(t.passageId, list);
    }
    list.push(t.themeId);
  }

  const docs: CompactDocInput[] = rows.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      passageKey: row.passageKey,
      textId: row.textId as TextId,
      book: row.bookSlug,
      chapter: row.chapterNum,
      verse: row.verseNum,
      translation: row.primaryTranslation,
      originalText: row.originalText,
      language: row.language,
      verseOrder: row.verseOrder,
      themes: themesById.get(row.id) ?? [],
      density: typeof meta.density === 'number' ? meta.density : 0.5,
    };
  });

  const bm25 = new CompactBm25Index(docs);
  const vectors = tryLoadStandaloneVectors(docs.length);
  return { bm25, vectors };
}

/** Build or return the singleton compact hybrid index. */
export async function initializeOramaIndex(): Promise<void> {
  await ensureCompactIndex();
}

async function ensureCompactIndex(): Promise<CompactBm25Index> {
  if (bm25Index) return bm25Index;
  if (!loadingPromise) {
    loadingPromise = (async () => {
      const startedAt = Date.now();
      const packStore = tryLoadPackStore(defaultPackPath());
      const built = packStore
        ? buildCompactFromPack(packStore.pack)
        : isPackStorageEnabled()
          ? (() => {
              throw new Error(`ILM_STORAGE=pack requires a pack file at ${defaultPackPath()}`);
            })()
          : await buildCompactFromPostgres();

      bm25Index = built.bm25;
      vectorIndex = built.vectors;

      const elapsed = Date.now() - startedAt;
      const bm25Mb = (bm25Index.indexMemoryBytes / 1024 / 1024).toFixed(1);
      const vecMb = vectorIndex ? (vectorIndex.memoryBytes / 1024 / 1024).toFixed(1) : '0.0';
      console.log(
        `[compact-search] ready: ${bm25Index.count} passages in ${elapsed}ms ` +
          `(BM25=${bm25Mb} MB, vocab=${bm25Index.vocabularySize}, vectors=${vectorIndex?.size ?? 0} / ${vecMb} MB)`
      );
      return bm25Index;
    })().catch((error) => {
      loadingPromise = null;
      throw error;
    });
  }
  return loadingPromise;
}

export function isIndexReady(): boolean {
  return bm25Index !== null;
}

export function invalidateOramaIndex(): void {
  bm25Index = null;
  vectorIndex = null;
  loadingPromise = null;
}

export async function indexedTextIds(): Promise<string[] | null> {
  // Compact index covers the entire corpus (~25 MB RAM), never a subset.
  return null;
}

export function compactIndexStats(): {
  ready: boolean;
  documents: number;
  vocabulary: number;
  bm25Bytes: number;
  vectorCount: number;
  vectorBytes: number;
} {
  return {
    ready: bm25Index !== null,
    documents: bm25Index?.count ?? 0,
    vocabulary: bm25Index?.vocabularySize ?? 0,
    bm25Bytes: bm25Index?.indexMemoryBytes ?? 0,
    vectorCount: vectorIndex?.size ?? 0,
    vectorBytes: vectorIndex?.memoryBytes ?? 0,
  };
}

/** Test hook to load a pre-built in-memory compact index directly. */
export function setCompactIndexForTests(bm25: CompactBm25Index | null, vectors: CompactVectorIndex | null = null): void {
  bm25Index = bm25;
  vectorIndex = vectors;
  loadingPromise = null;
}

/**
 * Reciprocal Rank Fusion (RRF) combining lexical BM25+ hits and dense quantized
 * vector hits into one cleanly ordered, unsaturated score list.
 */
export function fuseHybridHits(
  lexical: Array<{ docId: number; score: number; matchedIn: string }>,
  semantic: Array<{ docId: number; score: number }>,
  rrfK = 60
): Array<{ docId: number; score: number; matchedIn: string }> {
  if (semantic.length === 0) return lexical;
  if (lexical.length === 0) {
    return semantic.map((h) => ({
      docId: h.docId,
      // Scale cosine into the same range normalizeBm25 expects (score / (score + 6))
      // so unsaturated scores sit meaningfully in [0, 0.85] without pinning to 1.0.
      score: h.score * 10,
      matchedIn: 'semantic',
    }));
  }

  const fused = new Map<number, { rrf: number; lexScore: number; semScore: number; matchedIn: string }>();

  lexical.forEach((hit, rank) => {
    fused.set(hit.docId, {
      rrf: 1 / (rrfK + rank + 1),
      lexScore: hit.score,
      semScore: 0,
      matchedIn: hit.matchedIn,
    });
  });

  semantic.forEach((hit, rank) => {
    const rrfDelta = 1 / (rrfK + rank + 1);
    const existing = fused.get(hit.docId);
    if (existing) {
      existing.rrf += rrfDelta;
      existing.semScore = hit.score;
    } else {
      fused.set(hit.docId, {
        rrf: rrfDelta,
        lexScore: 0,
        semScore: hit.score,
        matchedIn: 'semantic',
      });
    }
  });

  // Normalize RRF back onto the BM25 scale expected by `search.ts` (`normalizeBm25 = s / (s + 6)`).
  // Max theoretical RRF is 2 / (rrfK + 1) when ranked #1 by both; mapping to ~12 keeps
  // normalizeBm25(12) = 0.67..0.85 — well-ordered and strictly unsaturated.
  const maxPossibleRrf = 2 / (rrfK + 1);
  return [...fused.entries()]
    .map(([docId, entry]) => ({
      docId,
      score: (entry.rrf / maxPossibleRrf) * 14 + entry.lexScore * 0.15 + entry.semScore * 2.5,
      matchedIn: entry.matchedIn,
    }))
    .sort((a, b) => b.score - a.score);
}

/** Optional cached query embeddings for repeated searches. */
const queryVecCache = new Map<string, number[]>();
const QUERY_VEC_CACHE_MAX = 200;

async function embedQueryIfAvailable(term: string): Promise<number[] | null> {
  if (!vectorIndex || vectorIndex.size === 0) return null;
  if (!isEmbeddingConfigured()) return null;
  const key = term.trim().toLowerCase();
  if (key.length < 3) return null;
  const cached = queryVecCache.get(key);
  if (cached) return cached;
  try {
    const [vec] = await generateEmbeddings([term]);
    if (!vec || vec.length === 0) return null;
    if (queryVecCache.size >= QUERY_VEC_CACHE_MAX) queryVecCache.clear();
    queryVecCache.set(key, vec);
    return vec;
  } catch {
    return null;
  }
}

export async function searchIndex(options: IndexSearchOptions): Promise<IndexSearchResult> {
  const startedAt = Date.now();
  const index = await ensureCompactIndex();
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const sortBy = options.sortBy ?? 'relevance';
  const sortOrder = options.sortOrder ?? 'desc';
  const trimmed = options.term.trim();

  // Fetch enough lexical candidates for clean hybrid fusion.
  const windowLimit = Math.min(index.count, Math.max(limit + offset, 60));
  const lexResult = index.search(
    trimmed,
    {
      textIds: options.textIds,
      books: options.books,
      chapters: options.chapters,
      languages: options.languages,
      themes: options.themes,
    },
    { limit: sortBy === 'verseOrder' ? limit : windowLimit, offset: sortBy === 'verseOrder' ? offset : 0, sortBy, sortOrder }
  );

  let combined: Array<{ docId: number; score: number; matchedIn: string }> = lexResult.hits;
  let total = lexResult.total;
  let matchMode: MatchMode = lexResult.matchMode;

  // Stage 2: Optional dense quantized vector fusion (BQ Hamming + SQ8 rescore).
  if (trimmed && sortBy === 'relevance' && vectorIndex && vectorIndex.size > 0) {
    const qVec = await embedQueryIfAvailable(trimmed);
    if (qVec) {
      const filter = index.buildFilterPredicate({
        textIds: options.textIds,
        books: options.books,
        chapters: options.chapters,
        languages: options.languages,
        themes: options.themes,
      });
      const semHits = vectorIndex.search(qVec, {
        limit: Math.max(40, limit + offset),
        filter: filter ?? undefined,
      });
      if (semHits.length > 0) {
        combined = fuseHybridHits(lexResult.hits, semHits);
        total = Math.max(total, combined.length);
        if (lexResult.hits.length === 0) matchMode = 'relaxed';
      }
    }
  }

  const page = sortBy === 'verseOrder' ? combined : combined.slice(offset, offset + limit);
  const hits: IndexHit[] = page.map((h) => ({
    document: index.toPassageDoc(h.docId, h.matchedIn),
    score: h.score,
  }));

  return {
    hits,
    count: total,
    elapsedMs: Date.now() - startedAt,
    matchMode,
  };
}

export async function getIndexedPassage(passageKey: string): Promise<PassageDoc | null> {
  const index = await ensureCompactIndex();
  const docId = index.getDocId(passageKey);
  return docId === undefined ? null : index.toPassageDoc(docId);
}

export async function getIndexedThemes(): Promise<string[]> {
  const index = await ensureCompactIndex();
  return index.getThemesList();
}
