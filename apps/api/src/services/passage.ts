/**
 * Passage service — data access for texts, books, chapters, and passages.
 *
 * Postgres is the source of truth. The search index holds only what retrieval
 * needs, so anything that renders a passage reads it from here.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { cached, catalogueCache } from '../lib/corpus-cache';
import { Passage, TextId, BookMetadata, PassageKey, createPassageKey, TEXT_METADATA } from '@ilm/shared';
import type { CrossReference } from '@prisma/client';

/**
 * What every passage read loads.
 *
 * No cross-references, and that is the single most expensive thing this file used
 * to do on every read. Both directions were included with the *whole* referenced
 * passage, so opening a 286-verse chapter joined every verse to every verse it
 * points at and to all of their translations and themes — for data no reader of
 * this data ever saw.
 *
 * Nothing uses it. The reader ignores cross-references entirely, and the one
 * route that does want them (`GET /api/passages/by-key`) overwrites the field
 * with a freshly computed value from `crossReferencesFor`, because the stored
 * version may be stale. So the joins were being paid for on every passage on
 * screen and then either ignored or thrown away.
 *
 * A caller that genuinely needs them asks for them by name.
 */
const passageInclude = {
  themes: { include: { theme: true } },
  passageTranslations: { include: { translation: true } },
} satisfies Prisma.PassageInclude;

type PassageRow = Prisma.PassageGetPayload<{ include: typeof passageInclude }>;

// ============================================================================
// PASSAGE READS
// ============================================================================

export async function getPassageById(id: string): Promise<Passage | null> {
  return cached(`passageId:${id}`, async () => {
    const row = await prisma.passage.findUnique({ where: { id }, include: passageInclude });
    return row ? toPassage(row) : null;
  });
}

export async function getPassageByKey(key: string): Promise<Passage | null> {
  return cached(`passage:${key}`, async () => {
    const row = await prisma.passage.findUnique({ where: { passageKey: key }, include: passageInclude });
    return row ? toPassage(row) : null;
  });
}

export async function getPassagesByIds(ids: string[]): Promise<Passage[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.passage.findMany({ where: { id: { in: ids } }, include: passageInclude });
  return orderByRequested(ids, rows.map(toPassage));
}

export async function getPassagesByKeys(keys: string[]): Promise<Passage[]> {
  if (keys.length === 0) return [];
  const rows = await prisma.passage.findMany({ where: { passageKey: { in: keys } }, include: passageInclude });
  return orderByRequested(keys, rows.map(toPassage));
}

/** Resolve a bare passage id, a canonical key, or an id-with-translation suffix. */
export async function resolvePassage(ref: string): Promise<Passage | null> {
  const direct = await getPassageById(ref);
  if (direct) return direct;
  return getPassageByKey(ref);
}

function orderByRequested<T extends { passageKey: string }>(keys: string[], rows: T[]): T[] {
  const rank = new Map(keys.map((k, i) => [k, i]));
  return rows.sort((a, b) => (rank.get(a.passageKey) ?? 0) - (rank.get(b.passageKey) ?? 0));
}

export async function getPassagesByText(textId: TextId, limit = 100, offset = 0): Promise<Passage[]> {
  const rows = await prisma.passage.findMany({
    where: { textId },
    orderBy: { verseOrder: 'asc' },
    take: limit,
    skip: offset,
    include: passageInclude,
  });
  return rows.map(toPassage);
}

export async function getPassagesByBook(textId: TextId, bookSlug: string, limit = 200, offset = 0): Promise<Passage[]> {
  const rows = await prisma.passage.findMany({
    where: { textId, bookSlug },
    orderBy: [{ chapterNum: 'asc' }, { verseNum: 'asc' }],
    take: limit,
    skip: offset,
    include: passageInclude,
  });
  return rows.map(toPassage);
}

export async function getPassagesByChapter(textId: TextId, bookSlug: string, chapter: number): Promise<Passage[]> {
  return cached(`chapter:${textId}:${bookSlug}:${chapter}`, async () => {
    const rows = await prisma.passage.findMany({
      where: { textId, bookSlug, chapterNum: chapter },
      orderBy: { verseNum: 'asc' },
      include: passageInclude,
    });
    return rows.map(toPassage);
  });
}

// ============================================================================
// PASSAGE WRITES
// ============================================================================

export interface UpsertPassageInput {
  passageKey: string;
  textId: TextId;
  bookSlug: string;
  chapter: number;
  verse: number;
  originalText: string;
  translation: string;
  translationName?: string;
  language?: string;
  verseOrder: number;
  metadata?: Record<string, unknown>;
  translations?: Array<{ name: string; text: string; language?: string; isPrimary?: boolean }>;
}

/**
 * Write one passage and its translations, creating the book and chapter rows on
 * demand. Idempotent: safe to re-run ingestion after a partial failure.
 */
export async function upsertPassage(input: UpsertPassageInput): Promise<string> {
  const meta = TEXT_METADATA[input.textId];

  const book = await prisma.book.upsert({
    where: { textId_bookId: { textId: input.textId, bookId: input.bookSlug } },
    create: {
      textId: input.textId,
      bookId: input.bookSlug,
      name: input.bookSlug,
      chapterCount: 0,
      verseCount: 0,
      order: input.chapter * 1000 + input.verse,
      testament: meta ? input.textId : undefined,
      category: input.chapter > 1 ? undefined : 'surah',
    },
    update: {},
  });

  const chapter = await prisma.chapter.upsert({
    where: { bookRef_number: { bookRef: book.id, number: input.chapter } },
    create: { bookRef: book.id, number: input.chapter },
    update: {},
  });

  const row = await prisma.passage.upsert({
    where: { passageKey: input.passageKey },
    create: {
      passageKey: input.passageKey,
      textId: input.textId,
      bookRef: book.id,
      bookSlug: input.bookSlug,
      chapterRef: chapter.id,
      chapterNum: input.chapter,
      verseNum: input.verse,
      originalText: input.originalText,
      primaryTranslation: input.translation,
      language: input.language ?? 'english',
      verseOrder: input.verseOrder,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
    update: {
      originalText: input.originalText,
      primaryTranslation: input.translation,
      language: input.language ?? 'english',
      verseOrder: input.verseOrder,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });

  const wanted = input.translations ?? (input.translationName ? [{ name: input.translationName, text: input.translation, isPrimary: true }] : []);

  for (const t of wanted) {
    const translation = await prisma.translation.upsert({
      where: { textId_name_language: { textId: input.textId, name: t.name, language: t.language ?? 'english' } },
      create: {
        textId: input.textId,
        name: t.name,
        language: t.language ?? 'english',
        isPrimary: t.isPrimary ?? false,
      },
      update: {},
    });

    await prisma.passageTranslation.upsert({
      where: { passageId_translationId: { passageId: row.id, translationId: translation.id } },
      create: { passageId: row.id, translationId: translation.id, text: t.text },
      update: { text: t.text },
    });
  }

  return row.id;
}

export async function deletePassage(id: string): Promise<void> {
  await prisma.passage.delete({ where: { id } });
}

export async function setPassageThemes(
  passageId: string,
  themes: Array<{ theme: string; score: number; confidence: number; evidence: string[]; source?: 'jev' | 'manual' | 'derived' }>
): Promise<void> {
  await setPassageThemesBatch([{ passageId, themes }]);
}

export interface PassageThemeInput {
  passageId: string;
  themes: Array<{ theme: string; score: number; confidence: number; evidence: string[]; source?: 'jev' | 'manual' | 'derived' }>;
}

/**
 * Write theme scores for many passages at once.
 * The theme catalogue is small and fixed, so the upserts are hoisted out of the
 * loop — otherwise indexing tens of thousands of passages issues a redundant
 * upsert per theme per passage.
 */
export async function setPassageThemesBatch(entries: PassageThemeInput[]): Promise<void> {
  const withThemes = entries.filter((entry) => entry.themes.length > 0);
  if (withThemes.length === 0) return;

  const names = [...new Set(withThemes.flatMap((entry) => entry.themes.map((t) => t.theme)))];

  for (const name of names) {
    await prisma.theme.upsert({
      where: { name },
      create: { name, category: categorizeTheme(name) },
      update: {},
    });
  }

  const passageIds = withThemes.map((entry) => entry.passageId);

  /**
   * Deleted by passage, not by passage-and-theme.
   *
   * Scoping the delete to the theme names about to be written leaves any theme the
   * new answer dropped still attached, so repeated runs accumulate: passages were
   * found carrying more themes than the five-theme cap allows, and rows whose
   * `source` was a stale `derived` sitting beside a fresh `jev`. Both callers write
   * a passage's complete theme set, so the whole set is what gets replaced.
   */
  await prisma.passageTheme.deleteMany({ where: { passageId: { in: passageIds } } });

  await prisma.passageTheme.createMany({
    data: withThemes.flatMap((entry) =>
      entry.themes.map((t) => ({
        passageId: entry.passageId,
        themeId: t.theme,
        score: t.score,
        confidence: t.confidence,
        evidence: t.evidence,
        source: t.source ?? 'derived',
      }))
    ),
    skipDuplicates: true,
  });
}

// ============================================================================
// BOOKS
// ============================================================================

export async function getBooks(textId: TextId): Promise<BookMetadata[]> {
  // The book list is read on every navigation and only changes when a corpus is
  // ingested, so it is held for an hour rather than looked up each time.
  return cached(
    `books:${textId}`,
    async () => {
      const books = await prisma.book.findMany({ where: { textId }, orderBy: { order: 'asc' } });
      return books.map(toBookMetadata);
    },
    catalogueCache
  );
}

export async function getBook(textId: TextId, bookId: string): Promise<BookMetadata | null> {
  const book = await prisma.book.findUnique({ where: { textId_bookId: { textId, bookId } } });
  return book ? toBookMetadata(book) : null;
}

export async function upsertBook(input: {
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
}): Promise<string> {
  const book = await prisma.book.upsert({
    where: { textId_bookId: { textId: input.textId, bookId: input.bookId } },
    create: {
      textId: input.textId,
      bookId: input.bookId,
      name: input.name,
      nameOriginal: input.nameOriginal,
      nameTranslit: input.nameTranslit,
      chapterCount: input.chapterCount,
      verseCount: input.verseCount,
      order: input.order,
      testament: input.testament,
      category: input.category,
      description: input.description,
    },
    update: {
      name: input.name,
      nameOriginal: input.nameOriginal,
      nameTranslit: input.nameTranslit,
      chapterCount: input.chapterCount,
      verseCount: input.verseCount,
      order: input.order,
      testament: input.testament,
      category: input.category,
      description: input.description,
    },
  });
  return book.id;
}

type BookRow = Prisma.BookGetPayload<Record<string, never>>;

function toBookMetadata(book: BookRow): BookMetadata {
  return {
    textId: book.textId as TextId,
    id: book.bookId,
    name: book.name,
    nameOriginal: book.nameOriginal ?? undefined,
    nameTransliterated: book.nameTranslit ?? undefined,
    chapterCount: book.chapterCount,
    verseCount: book.verseCount,
    order: book.order,
    testament: (book.testament ?? undefined) as BookMetadata['testament'],
    category: book.category ?? undefined,
    description: book.description ?? undefined,
  };
}

// ============================================================================
// CROSS-REFERENCES & ALIGNMENTS
// ============================================================================

export async function addCrossReference(data: {
  sourcePassageId: string;
  targetPassageId: string;
  type: string;
  strength: number;
  direction?: string;
  notes?: string;
  detectedBy?: string;
  matchedSegments?: unknown[];
}): Promise<void> {
  await prisma.crossReference.upsert({
    where: {
      sourcePassageId_targetPassageId_type: {
        sourcePassageId: data.sourcePassageId,
        targetPassageId: data.targetPassageId,
        type: data.type,
      },
    },
    create: {
      sourcePassageId: data.sourcePassageId,
      targetPassageId: data.targetPassageId,
      type: data.type,
      strength: data.strength,
      direction: data.direction ?? 'bidirectional',
      notes: data.notes,
      detectedBy: data.detectedBy ?? 'jev',
      matchedSegments: (data.matchedSegments ?? []) as Prisma.InputJsonValue,
    },
    update: { strength: data.strength, notes: data.notes },
  });
}

/**
 * Stored cross-references for a passage, in both directions.
 * `onlyDetected` skips a read when the caller is about to compute them anyway.
 */
export async function getStoredCrossReferences(passageId: string, limit = 20): Promise<CrossReference[]> {
  return prisma.crossReference.findMany({
    where: { OR: [{ sourcePassageId: passageId }, { targetPassageId: passageId }] },
    orderBy: { strength: 'desc' },
    take: limit,
  });
}

/**
 * Relationship families, kept apart.
 *
 * `quotation`, `parallel` and `duplicate` are found by n-gram matching and are
 * exhaustive: every one of them in the corpus is already stored, so recomputing
 * them would be wasted work. The rest are model judgements over a candidate pool
 * and are not.
 *
 * They have to be distinguished because a stored reference of any kind used to
 * suppress the model pass. Once the corpus-wide n-gram detection had been run,
 * every passage had *some* stored reference, so the short-circuit would have
 * silently stopped the thematic and linguistic detection everywhere — leaving the
 * comparison view showing quotations and nothing else.
 */
export const NGRAM_REFERENCE_TYPES = ['quotation', 'parallel', 'duplicate'] as const;
export const MODEL_REFERENCE_TYPES = [
  'quote',
  'allusion',
  'thematic',
  'linguistic',
  'narrative',
  'theological',
  'historical',
] as const;

export async function hasStoredCrossReferences(
  passageId: string,
  types: readonly string[] = MODEL_REFERENCE_TYPES
): Promise<boolean> {
  const count = await prisma.crossReference.count({
    where: {
      AND: [
        { OR: [{ sourcePassageId: passageId }, { targetPassageId: passageId }] },
        { type: { in: [...types] } },
      ],
    },
  });
  return count > 0;
}

export async function getCrossReferences(passageId: string, limit = 20) {
  return prisma.crossReference.findMany({
    where: { OR: [{ sourcePassageId: passageId }, { targetPassageId: passageId }] },
    orderBy: { strength: 'desc' },
    take: limit,
    include: { sourcePassage: true, targetPassage: true },
  });
}

export async function cacheAlignment(
  sourcePassageId: string,
  targetPassageId: string,
  alignment: { type: string; strength: number; matchedSegments: unknown[]; notes?: string }
): Promise<void> {
  const data = {
    type: alignment.type,
    strength: alignment.strength,
    matchedSegments: alignment.matchedSegments as Prisma.InputJsonValue,
    notes: alignment.notes,
  };
  await prisma.alignment.upsert({
    where: { sourcePassageId_targetPassageId: { sourcePassageId, targetPassageId } },
    create: { sourcePassageId, targetPassageId, ...data },
    update: data,
  });
}

export async function getCachedAlignment(sourcePassageId: string, targetPassageId: string) {
  return prisma.alignment.findUnique({
    where: { sourcePassageId_targetPassageId: { sourcePassageId, targetPassageId } },
  });
}

export async function getAlignments(passageId: string) {
  return prisma.alignment.findMany({
    where: { OR: [{ sourcePassageId: passageId }, { targetPassageId: passageId }] },
    orderBy: { strength: 'desc' },
    include: { sourcePassage: true, targetPassage: true },
  });
}

// ============================================================================
// STATISTICS
// ============================================================================

export async function getTextStats(textId: TextId) {
  const themes = await prisma.passageTheme.findMany({
    where: { passage: { textId } },
    distinct: ['themeId'],
    select: { themeId: true },
  });

  const [passageCount, bookCount, crossRefCount, alignmentCount] = await Promise.all([
    prisma.passage.count({ where: { textId } }),
    prisma.book.count({ where: { textId } }),
    prisma.crossReference.count({
      where: { OR: [{ sourcePassage: { textId } }, { targetPassage: { textId } }] },
    }),
    prisma.alignment.count({
      where: { OR: [{ sourcePassage: { textId } }, { targetPassage: { textId } }] },
    }),
  ]);

  const meta = TEXT_METADATA[textId];

  return {
    textId,
    name: meta?.name ?? textId,
    originalLanguage: meta?.originalLanguage ?? null,
    direction: meta?.direction ?? 'ltr',
    passageCount,
    bookCount,
    themeCount: themes.length,
    crossRefCount,
    alignmentCount,
  };
}

export async function getCorpusStats() {
  const texts = (Object.keys(TEXT_METADATA) as TextId[]).map((textId) => textId);
  const perText = await Promise.all(texts.map((textId) => getTextStats(textId)));
  return {
    texts: perText,
    totals: {
      passages: perText.reduce((sum, t) => sum + t.passageCount, 0),
      books: perText.reduce((sum, t) => sum + t.bookCount, 0),
      crossReferences: perText.reduce((sum, t) => sum + t.crossRefCount, 0),
    },
  };
}

// ============================================================================
// MAPPING
// ============================================================================

const WRITING_SYSTEM: Record<string, string> = {
  arabic: 'Arabic',
  hebrew: 'Hebrew',
  aramaic: 'Aramaic',
  greek: 'Greek',
  english: 'Latin',
};

function toPassage(row: PassageRow): Passage {
  const stored = (row.metadata ?? {}) as Record<string, unknown>;

  /*
   * Empty, because the include that used to fill it is gone.
   *
   * The field stays on the shape so nothing downstream has to change, and so the
   * route that computes them on demand can fill it in as before. It is typed as
   * possibly-undefined below rather than pretending to be a computed list, so a
   * caller that forgets cannot mistake "not loaded" for "none exist".
   */
  const crossReferences: Passage['crossReferences'] = [];

  return {
    id: row.id,
    passageKey: row.passageKey,
    textId: row.textId as TextId,
    book: row.bookSlug,
    chapter: row.chapterNum,
    verse: row.verseNum,
    originalText: row.originalText,
    translation: row.primaryTranslation,
    primaryTranslationName:
      row.passageTranslations.find((t) => t.translation.isPrimary)?.translation.name ??
      row.passageTranslations[0]?.translation.name,
    // The primary is filtered out: it is already in `translation`, and offering it
    // as an "alternative" showed the reader a second copy of the text on screen.
    alternativeTranslations: row.passageTranslations
      .filter((t) => !t.translation.isPrimary && t.text.trim() !== row.primaryTranslation.trim())
      .map((t) => ({
        id: t.translation.id,
        language: (t.translation.language as never) ?? 'english',
        translator: t.translation.translator ?? t.translation.name,
        year: t.translation.year ?? undefined,
        text: t.text,
        isPrimary: t.translation.isPrimary,
      })),
    metadata: {
      language: (row.language as never) ?? 'english',
      writingSystem: WRITING_SYSTEM[row.language] ?? 'Latin',
      canonicalOrder: row.verseOrder,
      verseOrder: row.verseOrder,
      revelationOrder: typeof stored.revelationOrder === 'number' ? stored.revelationOrder : undefined,
      juz: typeof stored.juz === 'number' ? stored.juz : undefined,
      hizb: typeof stored.hizb === 'number' ? stored.hizb : undefined,
      page: typeof stored.page === 'number' ? stored.page : undefined,
    },
    embeddings: row.embeddings ? Array.from(new Float32Array(row.embeddings.buffer, row.embeddings.byteOffset, row.embeddings.byteLength / 4)) : [],
    themes: row.themes
      .map((t) => ({
        theme: t.theme.name,
        score: t.score,
        confidence: t.confidence,
        evidence: t.evidence,
        source: (t.source as 'jev' | 'manual' | 'derived') ?? 'derived',
      }))
      .sort((a, b) => b.score - a.score),
    crossReferences,
  };
}

function categorizeTheme(theme: string): string {
  if (/mercy|compassion|forgiveness|love|grace/.test(theme)) return 'divine_attributes';
  if (/covenant|law|command|obedience|sin|repent|atonement|sacrifice|purity|righteous/.test(theme)) return 'covenant_law';
  if (/salvation|redemption|resurrection|judgment|heaven|hell|afterlife|messiah|kingdom|eternal/.test(theme)) return 'salvation';
  if (/prayer|worship|fast|pilgrimage|charity|alms|ritual|ceremony|sabbath|festival/.test(theme)) return 'practice';
  if (/patience|gratitude|trust|honesty|kindness|generosity|humility/.test(theme)) return 'ethics';
  if (/adam|noah|abraham|moses|david|solomon|jesus|muhammad|prophet|angel|satan|creation/.test(theme)) return 'narrative';
  if (/community|family|marriage|parenthood|neighbor|stranger|poor|orphan|widow|governance/.test(theme)) return 'community';
  if (/earth|light|darkness|water|fire|wind|star|animal|plant/.test(theme)) return 'cosmology';
  return 'other';
}

// The one pool in the process, re-exported so existing importers keep working.
// See src/lib/db.ts.
export { prisma };
export type { PassageKey, createPassageKey };
