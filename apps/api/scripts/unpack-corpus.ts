/**
 * Hydrate a fresh local Postgres database from a compressed `.ilm.pack.br`
 * snapshot in seconds (instead of 20-40 minutes of external API scraping).
 *
 * Idempotent: uses `skipDuplicates` / upserts on natural keys so re-running
 * after a partial failure is completely safe.
 *
 * Usage:
 *   npm run hydrate --workspace=@ilm/api
 *   npx tsx scripts/unpack-corpus.ts --in data/corpus.ilm.pack.br
 */

import { Prisma } from '@prisma/client';
import { TEXT_METADATA, type TextId } from '@ilm/shared';
import { loadLocalEnv } from '../src/lib/env';
import { prisma } from '../src/lib/db';
import {
  defaultPackPath,
  dequantizeU8,
  packPassageKey,
  readIlmPack,
  unpackThemesByDoc,
  unpackVerseOrders,
} from '../src/lib/ilm-pack';

loadLocalEnv();

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inPath = argValue(args, '--in') ?? defaultPackPath();
  const batchSize = Math.max(100, Number(argValue(args, '--batch') ?? 1000));
  const startedAt = Date.now();

  console.log(`🚀 Hydrating Postgres from ${inPath}`);
  const { payload } = readIlmPack(inPath);
  const verseOrders = unpackVerseOrders(payload);
  const themesByDoc = unpackThemesByDoc(payload);

  // 1. Texts
  for (const textId of payload.texts as TextId[]) {
    const meta = TEXT_METADATA[textId];
    await prisma.text.upsert({
      where: { textId },
      create: {
        textId,
        name: meta?.name ?? textId,
        originalLang: meta?.originalLanguage ?? 'english',
        direction: meta?.direction ?? 'ltr',
      },
      update: {},
    });
  }

  // 2. Books
  const bookIdMap = new Map<string, string>();
  for (const b of payload.books) {
    const row = await prisma.book.upsert({
      where: { textId_bookId: { textId: b.textId, bookId: b.bookId } },
      create: {
        textId: b.textId,
        bookId: b.bookId,
        name: b.name,
        nameOriginal: b.nameOriginal,
        nameTranslit: b.nameTranslit,
        chapterCount: b.chapterCount,
        verseCount: b.verseCount,
        order: b.order,
        testament: b.testament,
        category: b.category,
        description: b.description,
      },
      update: {
        name: b.name,
        chapterCount: b.chapterCount,
        verseCount: b.verseCount,
        order: b.order,
      },
    });
    bookIdMap.set(`${b.textId}:${b.bookId}`, row.id);
  }

  // 3. Chapters (unique set across passages)
  const chapterKeySet = new Set<string>();
  const chapterRowsToCreate: Array<{ bookRef: string; number: number }> = [];
  for (let i = 0; i < payload.count; i += 1) {
    const b = payload.books[payload.bookIdx[i]];
    const bookRef = bookIdMap.get(`${b.textId}:${b.bookId}`)!;
    const cNum = payload.chapters[i];
    const cKey = `${bookRef}:${cNum}`;
    if (!chapterKeySet.has(cKey)) {
      chapterKeySet.add(cKey);
      chapterRowsToCreate.push({ bookRef, number: cNum });
    }
  }
  for (let i = 0; i < chapterRowsToCreate.length; i += batchSize) {
    await prisma.chapter.createMany({
      data: chapterRowsToCreate.slice(i, i + batchSize),
      skipDuplicates: true,
    });
  }
  const allChapters = await prisma.chapter.findMany({ select: { id: true, bookRef: true, number: true } });
  const chapterIdMap = new Map<string, string>(allChapters.map((c) => [`${c.bookRef}:${c.number}`, c.id]));

  // 4. Passages in fast batches (statement-level search_vector trigger handles FTS automatically)
  for (let start = 0; start < payload.count; start += batchSize) {
    const end = Math.min(payload.count, start + batchSize);
    const chunk: Prisma.PassageCreateManyInput[] = [];
    for (let i = start; i < end; i += 1) {
      const textId = payload.texts[payload.textIdx[i]];
      const b = payload.books[payload.bookIdx[i]];
      const bookRef = bookIdMap.get(`${b.textId}:${b.bookId}`)!;
      const chapterRef = chapterIdMap.get(`${bookRef}:${payload.chapters[i]}`)!;
      const extra = payload.extraMeta?.[String(i)] ?? {};
      chunk.push({
        passageKey: packPassageKey(payload, i),
        textId,
        bookRef,
        bookSlug: b.bookId,
        chapterRef,
        chapterNum: payload.chapters[i],
        verseNum: payload.verses[i],
        originalText: payload.originals[i] ?? '',
        primaryTranslation: payload.translations[i] ?? '',
        language: payload.languages[payload.langIdx[i]] ?? 'english',
        verseOrder: verseOrders[i],
        metadata: { ...extra, density: dequantizeU8(payload.densityQ8[i]) } as Prisma.InputJsonValue,
      });
    }
    await prisma.passage.createMany({ data: chunk, skipDuplicates: true });
  }

  // 5. Themes & PassageTheme links
  if (payload.themes.length > 0) {
    await prisma.theme.createMany({
      data: payload.themes.map((name) => ({ name, category: 'other' })),
      skipDuplicates: true,
    });

    const keyRows = await prisma.passage.findMany({ select: { id: true, passageKey: true } });
    const keyToId = new Map<string, string>(keyRows.map((r) => [r.passageKey, r.id]));

    const ptRows: Prisma.PassageThemeCreateManyInput[] = [];
    for (const [docId, entries] of themesByDoc) {
      const passageId = keyToId.get(packPassageKey(payload, docId));
      if (!passageId) continue;
      for (const e of entries) {
        ptRows.push({
          passageId,
          themeId: e.theme,
          score: e.score,
          confidence: e.confidence,
          evidence: [],
          source: e.source,
        });
      }
    }
    for (let i = 0; i < ptRows.length; i += batchSize * 2) {
      await prisma.passageTheme.createMany({
        data: ptRows.slice(i, i + batchSize * 2),
        skipDuplicates: true,
      });
    }
  }

  // 6. Cross-lingual terms
  if (payload.xlingualTerms.length > 0) {
    await prisma.xlingualTerm.createMany({
      data: payload.xlingualTerms.map((x) => ({
        theme: x.theme,
        language: x.language,
        term: x.term,
        inPassages: x.inPassages,
        specificity: x.specificity,
      })),
      skipDuplicates: true,
    });
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(
    `✅ Hydrated ${payload.count} passages, ${payload.books.length} books, ` +
      `${payload.themeLinks.length / 5} theme links, and ${payload.xlingualTerms.length} xlingual terms in ${elapsedSec}s`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('❌ Hydrate failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
