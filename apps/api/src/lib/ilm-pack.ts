/**
 * Ilm Portable Compressed Corpus Pack (`.ilm.pack.br`)
 *
 * Compresses the entire 46,464-passage corpus, books, theme assignments,
 * cross-lingual term map, and optional quantized semantic vectors into a single
 * Brotli-compressed columnar binary artifact (~4-6 MB text+themes, ~10-14 MB
 * with quantized semantic vectors).
 *
 * Binary envelope:
 *   [0..3]   ASCII magic "ILMP"
 *   [4]      uint8  version (1)
 *   [5]      uint8  flags (bit 0 = has quantized vector section)
 *   [6..7]   uint16 reserved (0)
 *   [8..11]  uint32 LE byte length of Brotli-compressed JSON columnar corpus
 *   [12..15] uint32 LE byte length of Brotli-compressed binary vector blob (0 if absent)
 *   [16..]   compressed corpus payload, followed by compressed vector payload
 *
 * Uses Node's built-in `node:zlib` Brotli codec — zero external dependencies.
 */

import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BookMetadata, Passage, TextId } from '@ilm/shared';
import type { XlingualTerm } from '../services/xlingual';

const MAGIC = Buffer.from('ILMP', 'ascii');
const PACK_VERSION = 1;
const FLAG_HAS_VECTORS = 1 << 0;
const HEADER_BYTES = 16;

export interface PackBook {
  textId: TextId;
  bookId: string;
  name: string;
  nameOriginal?: string;
  nameTranslit?: string;
  chapterCount: number;
  verseCount: number;
  order: number;
  testament?: string;
  category?: string;
  description?: string;
}

export interface PackPassageInput {
  id: string;
  passageKey: string;
  textId: TextId;
  bookSlug: string;
  chapter: number;
  verse: number;
  originalText: string;
  translation: string;
  primaryTranslationName?: string;
  language: string;
  verseOrder: number;
  density: number;
  metadata?: Record<string, unknown>;
  themes: Array<{
    theme: string;
    score: number;
    confidence: number;
    source: string;
    evidence?: string[];
  }>;
}

export interface ColumnarPackPayload {
  version: number;
  createdAt: string;
  texts: string[];
  languages: string[];
  themes: string[];
  sources: string[];
  translationNames: string[];
  books: PackBook[];
  /** Parallel columnar arrays of length `count`. */
  count: number;
  textIdx: number[];
  bookIdx: number[];
  langIdx: number[];
  chapters: number[];
  verses: number[];
  /** Delta-encoded verseOrder (reconstructed via running sum). */
  verseOrderDelta: number[];
  /** Quantized semantic density in 0..255. */
  densityQ8: number[];
  /** Index into translationNames, or -1 if absent. */
  primaryTransIdx: number[];
  /** Only stored for passages whose passageKey != `${textId}:${bookSlug}:${chapter}:${verse}`. */
  keyOverrides?: Record<string, string>;
  /** Sparse extra passage metadata (revelationOrder, juz, hizb, page). */
  extraMeta?: Record<string, Record<string, number>>;
  /** Contiguous arrays of texts for maximum Brotli LZ77 dictionary reuse. */
  translations: string[];
  originals: string[];
  /**
   * Flat 5-tuple theme links sorted by docId:
   * [docIdDelta, themeIdx, scoreQ8, confidenceQ8, sourceIdx, ...]
   */
  themeLinks: number[];
  xlingualTerms: XlingualTerm[];
}

export interface DecodedIlmPack {
  payload: ColumnarPackPayload;
  /** Optional raw binary buffer for `deserializeVectorIndex` (from compact-vectors.ts). */
  vectorBlob: Uint8Array | null;
}

export function defaultPackPath(): string {
  const configured = process.env.ILM_PACK_PATH?.trim();
  if (configured) return configured;
  return fileURLToPath(new URL('../../data/corpus.ilm.pack.br', import.meta.url));
}

function quantizeU8(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

export function dequantizeU8(value: number): number {
  return Math.max(0, Math.min(1, value / 255));
}

export function buildColumnarPayload(input: {
  books: PackBook[];
  passages: PackPassageInput[];
  xlingualTerms: XlingualTerm[];
}): ColumnarPackPayload {
  const textMap = new Map<string, number>();
  const langMap = new Map<string, number>();
  const themeMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  const transNameMap = new Map<string, number>();
  const bookKeyMap = new Map<string, number>();

  const texts: string[] = [];
  const languages: string[] = [];
  const themes: string[] = [];
  const sources: string[] = [];
  const translationNames: string[] = [];

  const intern = (map: Map<string, number>, list: string[], value: string): number => {
    const existing = map.get(value);
    if (existing !== undefined) return existing;
    const idx = list.length;
    map.set(value, idx);
    list.push(value);
    return idx;
  };

  const books = [...input.books];
  books.forEach((b, idx) => {
    bookKeyMap.set(`${b.textId}:${b.bookId}`, idx);
  });

  // Sort deterministically by verseOrder then passageKey so delta encoding is tight.
  const sorted = [...input.passages].sort(
    (a, b) => a.verseOrder - b.verseOrder || a.passageKey.localeCompare(b.passageKey)
  );

  const count = sorted.length;
  const textIdx = new Array<number>(count);
  const bookIdx = new Array<number>(count);
  const langIdx = new Array<number>(count);
  const chapters = new Array<number>(count);
  const verses = new Array<number>(count);
  const verseOrderDelta = new Array<number>(count);
  const densityQ8 = new Array<number>(count);
  const primaryTransIdx = new Array<number>(count);
  const translations = new Array<string>(count);
  const originals = new Array<string>(count);
  const keyOverrides: Record<string, string> = {};
  const extraMeta: Record<string, Record<string, number>> = {};
  const themeLinks: number[] = [];

  let prevOrder = 0;
  let prevThemeDoc = 0;

  for (let i = 0; i < count; i += 1) {
    const p = sorted[i];
    textIdx[i] = intern(textMap, texts, p.textId);
    langIdx[i] = intern(langMap, languages, p.language || 'english');

    const bkKey = `${p.textId}:${p.bookSlug}`;
    let bIdx = bookKeyMap.get(bkKey);
    if (bIdx === undefined) {
      bIdx = books.length;
      books.push({
        textId: p.textId,
        bookId: p.bookSlug,
        name: p.bookSlug,
        chapterCount: 0,
        verseCount: 0,
        order: bIdx,
      });
      bookKeyMap.set(bkKey, bIdx);
    }
    bookIdx[i] = bIdx;

    chapters[i] = p.chapter;
    verses[i] = p.verse;
    verseOrderDelta[i] = p.verseOrder - prevOrder;
    prevOrder = p.verseOrder;

    densityQ8[i] = quantizeU8(Number.isFinite(p.density) ? p.density : 0.5);
    primaryTransIdx[i] = p.primaryTranslationName
      ? intern(transNameMap, translationNames, p.primaryTranslationName)
      : -1;

    const canonical = `${p.textId}:${p.bookSlug}:${p.chapter}:${p.verse}`;
    if (p.passageKey !== canonical) {
      keyOverrides[String(i)] = p.passageKey;
    }

    if (p.metadata) {
      const compactMeta: Record<string, number> = {};
      for (const k of ['revelationOrder', 'juz', 'hizb', 'page'] as const) {
        const v = p.metadata[k];
        if (typeof v === 'number' && Number.isFinite(v)) compactMeta[k] = v;
      }
      if (Object.keys(compactMeta).length > 0) extraMeta[String(i)] = compactMeta;
    }

    translations[i] = p.translation;
    originals[i] = p.originalText ?? '';

    for (const t of p.themes) {
      const tIdx = intern(themeMap, themes, t.theme);
      const sIdx = intern(sourceMap, sources, t.source || 'derived');
      themeLinks.push(i - prevThemeDoc, tIdx, quantizeU8(t.score), quantizeU8(t.confidence), sIdx);
      prevThemeDoc = i;
    }
  }

  return {
    version: PACK_VERSION,
    createdAt: new Date().toISOString(),
    texts,
    languages,
    themes,
    sources,
    translationNames,
    books,
    count,
    textIdx,
    bookIdx,
    langIdx,
    chapters,
    verses,
    verseOrderDelta,
    densityQ8,
    primaryTransIdx,
    ...(Object.keys(keyOverrides).length > 0 ? { keyOverrides } : {}),
    ...(Object.keys(extraMeta).length > 0 ? { extraMeta } : {}),
    translations,
    originals,
    themeLinks,
    xlingualTerms: input.xlingualTerms,
  };
}

export function encodeIlmPack(
  payload: ColumnarPackPayload,
  vectorBlob?: Uint8Array | null,
  quality = 9
): Buffer {
  const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const compressedJson = brotliCompressSync(jsonBuf, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: Math.max(1, Math.min(11, quality)),
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
    },
  });

  const hasVectors = Boolean(vectorBlob && vectorBlob.byteLength > 0);
  const compressedVec = hasVectors
    ? brotliCompressSync(Buffer.from(vectorBlob!.buffer, vectorBlob!.byteOffset, vectorBlob!.byteLength), {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: Math.max(1, Math.min(9, quality)),
          [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
        },
      })
    : Buffer.alloc(0);

  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt8(PACK_VERSION, 4);
  header.writeUInt8(hasVectors ? FLAG_HAS_VECTORS : 0, 5);
  header.writeUInt16LE(0, 6);
  header.writeUInt32LE(compressedJson.byteLength, 8);
  header.writeUInt32LE(compressedVec.byteLength, 12);

  return Buffer.concat([header, compressedJson, compressedVec]);
}

export function decodeIlmPack(buffer: Uint8Array): DecodedIlmPack {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buf.byteLength < HEADER_BYTES) {
    throw new Error(`Invalid Ilm pack: file too small (${buf.byteLength} bytes)`);
  }
  if (!buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Invalid Ilm pack: missing ILMP header magic');
  }
  const version = buf.readUInt8(4);
  if (version !== PACK_VERSION) {
    throw new Error(`Unsupported Ilm pack version: ${version}`);
  }
  const flags = buf.readUInt8(5);
  const jsonLen = buf.readUInt32LE(8);
  const vecLen = buf.readUInt32LE(12);

  if (HEADER_BYTES + jsonLen + vecLen > buf.byteLength) {
    throw new Error('Invalid Ilm pack: truncated payload');
  }

  const jsonCompressed = buf.subarray(HEADER_BYTES, HEADER_BYTES + jsonLen);
  const jsonRaw = brotliDecompressSync(jsonCompressed);
  const payload = JSON.parse(jsonRaw.toString('utf8')) as ColumnarPackPayload;

  let vectorBlob: Uint8Array | null = null;
  if ((flags & FLAG_HAS_VECTORS) !== 0 && vecLen > 0) {
    const vecCompressed = buf.subarray(HEADER_BYTES + jsonLen, HEADER_BYTES + jsonLen + vecLen);
    const decompressed = brotliDecompressSync(vecCompressed);
    vectorBlob = new Uint8Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
  }

  return { payload, vectorBlob };
}

export function writeIlmPack(
  filePath: string,
  payload: ColumnarPackPayload,
  vectorBlob?: Uint8Array | null,
  quality = 9
): { bytes: number; jsonBytes: number; vectorBytes: number } {
  mkdirSync(dirname(filePath), { recursive: true });
  const encoded = encodeIlmPack(payload, vectorBlob, quality);
  writeFileSync(filePath, encoded);
  return {
    bytes: encoded.byteLength,
    jsonBytes: encoded.readUInt32LE(8),
    vectorBytes: encoded.readUInt32LE(12),
  };
}

export function readIlmPack(filePath = defaultPackPath()): DecodedIlmPack {
  if (!existsSync(filePath)) {
    throw new Error(`Ilm pack not found at ${filePath}`);
  }
  return decodeIlmPack(readFileSync(filePath));
}

export function packPassageKey(payload: ColumnarPackPayload, docId: number): string {
  const override = payload.keyOverrides?.[String(docId)];
  if (override) return override;
  const textId = payload.texts[payload.textIdx[docId]];
  const book = payload.books[payload.bookIdx[docId]];
  return `${textId}:${book.bookId}:${payload.chapters[docId]}:${payload.verses[docId]}`;
}

export function unpackVerseOrders(payload: ColumnarPackPayload): Uint32Array {
  const out = new Uint32Array(payload.count);
  let acc = 0;
  for (let i = 0; i < payload.count; i += 1) {
    acc += payload.verseOrderDelta[i] ?? 0;
    out[i] = acc;
  }
  return out;
}

const WRITING_SYSTEM: Record<string, string> = {
  arabic: 'Arabic',
  hebrew: 'Hebrew',
  aramaic: 'Aramaic',
  greek: 'Greek',
  english: 'Latin',
};

export interface UnpackedThemeEntry {
  theme: string;
  score: number;
  confidence: number;
  source: 'jev' | 'local' | 'derived' | 'manual';
  evidence: string[];
}

export function unpackThemesByDoc(payload: ColumnarPackPayload): Map<number, UnpackedThemeEntry[]> {
  const byDoc = new Map<number, UnpackedThemeEntry[]>();
  const links = payload.themeLinks;
  let docId = 0;

  for (let i = 0; i + 4 < links.length; i += 5) {
    docId += links[i];
    const theme = payload.themes[links[i + 1]];
    const score = dequantizeU8(links[i + 2]);
    const confidence = dequantizeU8(links[i + 3]);
    const rawSource = payload.sources[links[i + 4]] ?? 'derived';
    const source = (
      rawSource === 'jev' || rawSource === 'local' || rawSource === 'manual' ? rawSource : 'derived'
    ) as UnpackedThemeEntry['source'];

    let list = byDoc.get(docId);
    if (!list) {
      list = [];
      byDoc.set(docId, list);
    }
    list.push({ theme, score, confidence, source, evidence: [] });
  }

  for (const list of byDoc.values()) {
    list.sort((a, b) => b.score - a.score);
  }
  return byDoc;
}

export function unpackBookMetadata(book: PackBook): BookMetadata {
  return {
    textId: book.textId,
    id: book.bookId,
    name: book.name,
    nameOriginal: book.nameOriginal,
    nameTransliterated: book.nameTranslit,
    chapterCount: book.chapterCount,
    verseCount: book.verseCount,
    order: book.order,
    testament: book.testament as BookMetadata['testament'],
    category: book.category,
    description: book.description,
  };
}

export function unpackPassage(
  payload: ColumnarPackPayload,
  docId: number,
  verseOrder: number,
  themes: UnpackedThemeEntry[] = []
): Passage {
  const textId = payload.texts[payload.textIdx[docId]] as TextId;
  const book = payload.books[payload.bookIdx[docId]];
  const language = payload.languages[payload.langIdx[docId]] ?? 'english';
  const passageKey = packPassageKey(payload, docId);
  const extra = payload.extraMeta?.[String(docId)];
  const transIdx = payload.primaryTransIdx[docId];

  return {
    id: passageKey,
    passageKey,
    textId,
    book: book.bookId,
    chapter: payload.chapters[docId],
    verse: payload.verses[docId],
    originalText: payload.originals[docId] ?? '',
    translation: payload.translations[docId] ?? '',
    primaryTranslationName: transIdx >= 0 ? payload.translationNames[transIdx] : undefined,
    alternativeTranslations: [],
    metadata: {
      language: language as Passage['metadata']['language'],
      writingSystem: WRITING_SYSTEM[language] ?? 'Latin',
      canonicalOrder: verseOrder,
      verseOrder,
      revelationOrder: extra?.revelationOrder,
      juz: extra?.juz,
      hizb: extra?.hizb,
      page: extra?.page,
    },
    embeddings: [],
    themes,
    crossReferences: [],
  };
}
