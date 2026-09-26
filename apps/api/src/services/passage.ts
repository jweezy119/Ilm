/**
 * Passage Service - CRUD and data access for passages
 */

import { PrismaClient } from '@prisma/client';
import { Passage, TextId, BookMetadata, PassageKey, createPassageKey, parsePassageKey, TEXT_METADATA } from '@ilm/shared';

const prisma = new PrismaClient();

// ============================================================================
// PASSAGE CRUD
// ============================================================================

export async function createPassage(data: {
  textId: TextId;
  book: string;
  chapter: number;
  verse: number;
  originalText: string;
  primaryTranslation: string;
  primaryTranslationId?: string;
  language?: string;
  metadata?: Record<string, unknown>;
  embeddings?: number[];
}): Promise<Passage> {
  const passageKey = createPassageKey(data.textId, data.book, data.chapter, data.verse);
  
  // Get verse order
  const verseOrder = await getNextVerseOrder(data.textId);
  
  const passage = await prisma.passage.create({
    data: {
      passageKey,
      textId: data.textId,
      bookId: data.book,
      chapterId: await getOrCreateChapterId(data.textId, data.book, data.chapter),
      chapterNum: data.chapter,
      verseNum: data.verse,
      originalText: data.originalText,
      primaryTranslation: data.primaryTranslation,
      primaryTranslationId: data.primaryTranslationId,
      language: data.language || 'english',
      verseOrder,
      metadata: data.metadata || {},
      embeddings: data.embeddings || [],
    },
  });
  
  return mapPrismaPassage(passage);
}

export async function getPassageById(id: string): Promise<Passage | null> {
  const passage = await prisma.passage.findUnique({
    where: { id },
    include: {
      themes: { include: { theme: true } },
      crossRefsSource: { include: { targetPassage: true } },
      crossRefsTarget: { include: { sourcePassage: true } },
      translations: { include: { translation: true } },
    },
  });
  
  return passage ? mapPrismaPassage(passage) : null;
}

export async function getPassageByKey(key: PassageKey): Promise<Passage | null> {
  const passage = await prisma.passage.findUnique({
    where: { passageKey: key },
    include: {
      themes: { include: { theme: true } },
      crossRefsSource: { include: { targetPassage: true } },
      crossRefsTarget: { include: { sourcePassage: true } },
      translations: { include: { translation: true } },
    },
  });
  
  return passage ? mapPrismaPassage(passage) : null;
}

export async function getPassagesByKeys(keys: PassageKey[]): Promise<Passage[]> {
  const passages = await prisma.passage.findMany({
    where: { passageKey: { in: keys } },
    include: {
      themes: { include: { theme: true } },
      crossRefsSource: { include: { targetPassage: true } },
      crossRefsTarget: { include: { sourcePassage: true } },
      translations: { include: { translation: true } },
    },
  });
  
  return passages.map(mapPrismaPassage);
}

export async function getPassagesByText(textId: TextId, limit = 50, offset = 0): Promise<Passage[]> {
  const passages = await prisma.passage.findMany({
    where: { textId },
    orderBy: { verseOrder: 'asc' },
    take: limit,
    skip: offset,
    include: {
      themes: { include: { theme: true } },
      translations: { include: { translation: true } },
    },
  });
  
  return passages.map(mapPrismaPassage);
}

export async function getPassagesByBook(textId: TextId, book: string, limit = 100, offset = 0): Promise<Passage[]> {
  const passages = await prisma.passage.findMany({
    where: { textId, bookId: book },
    orderBy: [{ chapterNum: 'asc' }, { verseNum: 'asc' }],
    take: limit,
    skip: offset,
    include: {
      themes: { include: { theme: true } },
      translations: { include: { translation: true } },
    },
  });
  
  return passages.map(mapPrismaPassage);
}

export async function getPassagesByChapter(textId: TextId, book: string, chapter: number): Promise<Passage[]> {
  const passages = await prisma.passage.findMany({
    where: { textId, bookId: book, chapterNum: chapter },
    orderBy: { verseNum: 'asc' },
    include: {
      themes: { include: { theme: true } },
      translations: { include: { translation: true } },
    },
  });
  
  return passages.map(mapPrismaPassage);
}

export async function updatePassage(id: string, data: Partial<Passage>): Promise<Passage> {
  const passage = await prisma.passage.update({
    where: { id },
    data: {
      originalText: data.originalText,
      primaryTranslation: data.translation,
      metadata: data.metadata,
      embeddings: data.embeddings,
      themes: data.themes ? {
        deleteMany: {},
        create: data.themes.map(t => ({
          themeId: t.theme, // Assumes theme exists
          score: t.score,
          confidence: t.confidence,
          evidence: t.evidence,
          source: t.source,
        })),
      } : undefined,
    },
    include: {
      themes: { include: { theme: true } },
      translations: { include: { translation: true } },
    },
  });
  
  return mapPrismaPassage(passage);
}

export async function deletePassage(id: string): Promise<void> {
  await prisma.passage.delete({ where: { id } });
}

// ============================================================================
// BOOK & CHAPTER MANAGEMENT
// ============================================================================

export async function getBooks(textId: TextId): Promise<BookMetadata[]> {
  const books = await prisma.book.findMany({
    where: { textId },
    orderBy: { order: 'asc' },
  });
  
  return books.map(b => ({
    textId: b.textId as TextId,
    id: b.bookId,
    name: b.name,
    nameOriginal: b.nameOriginal || undefined,
    nameTransliterated: b.nameTranslit || undefined,
    chapterCount: b.chapterCount,
    verseCount: b.verseCount,
    order: b.order,
    testament: b.testament as any,
    category: b.category || undefined,
    description: b.description || undefined,
  }));
}

export async function getBook(textId: TextId, bookId: string): Promise<BookMetadata | null> {
  const book = await prisma.book.findUnique({
    where: { textId_bookId: { textId, bookId } },
  });
  
  return book ? {
    textId: book.textId as TextId,
    id: book.bookId,
    name: book.name,
    nameOriginal: book.nameOriginal || undefined,
    nameTransliterated: book.nameTranslit || undefined,
    chapterCount: book.chapterCount,
    verseCount: book.verseCount,
    order: book.order,
    testament: book.testament as any,
    category: book.category || undefined,
    description: book.description || undefined,
  } : null;
}

export async function createBook(data: {
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
  metadata?: Record<string, unknown>;
}): Promise<BookMetadata> {
  const book = await prisma.book.create({
    data: {
      textId: data.textId,
      bookId: data.bookId,
      name: data.name,
      nameOriginal: data.nameOriginal,
      nameTranslit: data.nameTranslit,
      chapterCount: data.chapterCount,
      verseCount: data.verseCount,
      order: data.order,
      testament: data.testament,
      category: data.category,
      description: data.description,
      metadata: data.metadata || {},
    },
  });
  
  return {
    textId: book.textId as TextId,
    id: book.bookId,
    name: book.name,
    nameOriginal: book.nameOriginal || undefined,
    nameTransliterated: book.nameTranslit || undefined,
    chapterCount: book.chapterCount,
    verseCount: book.verseCount,
    order: book.order,
    testament: book.testament as any,
    category: book.category || undefined,
    description: book.description || undefined,
  };
}

async function getOrCreateChapterId(textId: TextId, book: string, chapter: number): Promise<string> {
  let chapterRecord = await prisma.chapter.findFirst({
    where: { bookId: book, number: chapter },
  });
  
  if (!chapterRecord) {
    chapterRecord = await prisma.chapter.create({
      data: {
        bookId: book,
        number: chapter,
        verseCount: 0, // Will update after passage insert
      },
    });
  }
  
  return chapterRecord.id;
}

async function getNextVerseOrder(textId: TextId): Promise<number> {
  const last = await prisma.passage.findFirst({
    where: { textId },
    orderBy: { verseOrder: 'desc' },
    select: { verseOrder: true },
  });
  
  return (last?.verseOrder || 0) + 1;
}

// ============================================================================
// THEME MANAGEMENT
// ============================================================================

export async function addPassageThemes(passageId: string, themes: Array<{
  theme: string;
  score: number;
  confidence: number;
  evidence: string[];
  source: 'jev' | 'manual' | 'derived';
}>): Promise<void> {
  // Ensure themes exist
  for (const t of themes) {
    await prisma.theme.upsert({
      where: { name: t.theme },
      create: { name: t.theme, category: categorizeTheme(t.theme) },
      update: {},
    });
  }
  
  await prisma.passageTheme.createMany({
    data: themes.map(t => ({
      passageId,
      themeId: t.theme,
      score: t.score,
      confidence: t.confidence,
      evidence: t.evidence,
      source: t.source,
    })),
    skipDuplicates: true,
  });
}

export async function getPassageThemes(passageId: string) {
  return prisma.passageTheme.findMany({
    where: { passageId },
    include: { theme: true },
    orderBy: { score: 'desc' },
  });
}

function categorizeTheme(theme: string): string {
  const categories: Record<string, string[]> = {
    divine_attributes: ['mercy', 'compassion', 'justice', 'wrath', 'forgiveness', 'love', 'power', 'knowledge', 'wisdom', 'sovereignty', 'holiness', 'faithfulness'],
    covenant_law: ['covenant', 'law', 'commandment', 'obedience', 'sin', 'repentance', 'atonement', 'sacrifice', 'purity', 'righteousness'],
    salvation: ['salvation', 'redemption', 'resurrection', 'judgment', 'heaven', 'hell', 'afterlife', 'messiah', 'kingdom', 'eternal_life'],
    practice: ['prayer', 'worship', 'fasting', 'pilgrimage', 'charity', 'almsgiving', 'ritual', 'ceremony', 'sabbath', 'festival'],
    ethics: ['justice', 'charity', 'humility', 'patience', 'gratitude', 'trust', 'honesty', 'kindness', 'generosity'],
    narrative: ['creation', 'adam', 'noah', 'abraham', 'moses', 'david', 'solomon', 'jesus', 'muhammad', 'prophets', 'angels', 'satan'],
    community: ['community', 'family', 'marriage', 'parenthood', 'neighbor', 'stranger', 'poor', 'orphan', 'widow', 'governance'],
    cosmology: ['creation', 'heaven', 'earth', 'light', 'darkness', 'water', 'fire', 'wind', 'stars', 'animals', 'plants'],
  };
  
  for (const [cat, themes] of Object.entries(categories)) {
    if (themes.includes(theme)) return cat;
  }
  return 'other';
}

// ============================================================================
// CROSS-REFERENCE MANAGEMENT
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
  await prisma.crossReference.create({
    data: {
      sourcePassageId: data.sourcePassageId,
      targetPassageId: data.targetPassageId,
      type: data.type,
      strength: data.strength,
      direction: data.direction || 'bidirectional',
      notes: data.notes,
      detectedBy: data.detectedBy || 'jev',
      matchedSegments: data.matchedSegments || [],
    },
  });
}

export async function getCrossReferences(passageId: string, limit = 20) {
  return prisma.crossReference.findMany({
    where: {
      OR: [
        { sourcePassageId: passageId },
        { targetPassageId: passageId },
      ],
    },
    orderBy: { strength: 'desc' },
    take: limit,
    include: {
      sourcePassage: true,
      targetPassage: true,
    },
  });
}

// ============================================================================
// ALIGNMENT MANAGEMENT
// ============================================================================

export async function addAlignment(data: {
  sourcePassageId: string;
  targetPassageId: string;
  type: string;
  strength: number;
  matchedSegments: unknown[];
  notes?: string;
}): Promise<void> {
  await prisma.alignment.upsert({
    where: {
      sourcePassageId_targetPassageId: {
        sourcePassageId: data.sourcePassageId,
        targetPassageId: data.targetPassageId,
      },
    },
    create: {
      sourcePassageId: data.sourcePassageId,
      targetPassageId: data.targetPassageId,
      type: data.type,
      strength: data.strength,
      matchedSegments: data.matchedSegments,
      notes: data.notes,
    },
    update: {
      type: data.type,
      strength: data.strength,
      matchedSegments: data.matchedSegments,
      notes: data.notes,
    },
  });
}

export async function getAlignments(passageId: string) {
  return prisma.alignment.findMany({
    where: {
      OR: [
        { sourcePassageId: passageId },
        { targetPassageId: passageId },
      ],
    },
    orderBy: { strength: 'desc' },
    include: {
      sourcePassage: true,
      targetPassage: true,
    },
  });
}

// ============================================================================
// STATISTICS
// ============================================================================

export async function getTextStats(textId: TextId) {
  const [passageCount, bookCount, themeCount, crossRefCount] = await Promise.all([
    prisma.passage.count({ where: { textId } }),
    prisma.book.count({ where: { textId } }),
    prisma.passageTheme.count({
      where: { passage: { textId } },
      distinct: ['themeId'],
    }),
    prisma.crossReference.count({
      where: {
        OR: [
          { sourcePassage: { textId } },
          { targetPassage: { textId } },
        ],
      },
    }),
  ]);
  
  return {
    textId,
    passageCount,
    bookCount,
    themeCount,
    crossRefCount,
  };
}

// ============================================================================
// MAPPING
// ============================================================================

function mapPrismaPassage(p: any): Passage {
  return {
    id: p.id,
    passageKey: p.passageKey,
    textId: p.textId,
    book: p.bookId,
    chapter: p.chapterNum,
    verse: p.verseNum,
    originalText: p.originalText,
    translation: p.primaryTranslation,
    alternativeTranslations: p.translations?.map((t: any) => ({
      id: t.translation.id,
      language: t.translation.language,
      translator: t.translation.translator,
      year: t.translation.year,
      text: t.text,
      isPrimary: t.translation.isPrimary,
    })) || [],
    metadata: p.metadata,
    embeddings: p.embeddings,
    themes: p.themes?.map((t: any) => ({
      theme: t.theme.name,
      score: t.score,
      confidence: t.confidence,
      evidence: t.evidence,
      source: t.source,
    })) || [],
    crossReferences: p.crossRefsSource?.map((c: any) => ({
      targetPassageId: c.targetPassageId,
      targetText: c.targetPassage.textId,
      type: c.type,
      strength: c.strength,
      direction: c.direction,
      notes: c.notes,
      detectedBy: c.detectedBy,
    })) || [],
  };
}