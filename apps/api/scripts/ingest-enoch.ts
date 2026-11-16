/**
 * Ingest the Book of Enoch into the database.
 * 
 * Usage:
 *   tsx scripts/ingest-enoch.ts
 */

import fs from 'fs';
import { fileURLToPath } from 'node:url';
import { TEXT_METADATA } from '@ilm/shared';
import { loadLocalEnv } from '../src/lib/env';
import { upsertBook, upsertPassage, prisma, getTextStats } from '../src/services/passage';
import { invalidateCorpusCache } from '../src/lib/corpus-cache';

loadLocalEnv();

async function ingestEnoch(): Promise<number> {
  console.log('\n📖 Book of Enoch');

  const meta = TEXT_METADATA['enoch'];
  await prisma.text.upsert({
    where: { textId: 'enoch' },
    create: {
      textId: 'enoch',
      name: meta.name,
      originalLang: meta.originalLanguage,
      direction: meta.direction,
      bookCount: meta.bookCount,
      verseCount: 0,
    },
    update: { name: meta.name, originalLang: meta.originalLanguage, direction: meta.direction },
  });

  /*
   * Resolved from this file, not from the working directory.
   *
   * This script runs three ways — `npm run ingest-enoch` from apps/api,
   * `npx tsx` from the repository root, and `npx tsx` from /app inside the
   * image — and each has a different cwd. The old cwd-relative path pointed
   * outside the repository in all three, so Enoch silently never ingested
   * and the corpus came up empty.
   */
  const dataPath = fileURLToPath(new URL('../data/enoch.json', import.meta.url));
  const rawData = fs.readFileSync(dataPath, 'utf-8');
  const chapters = JSON.parse(rawData);

  let written = 0;
  let globalOrder = 0;

  // Enoch is typically one "book" with 108 chapters, but some divide it. 
  // We'll treat it as one book called 'enoch'.
  let totalVerses = 0;
  
  for (const chapter of chapters) {
    const chapterNum = chapter.chapter;
    for (const verse of chapter.verses) {
      const verseNum = verse.verse;
      const text = verse.text.trim();
      
      if (!text) continue;

      await upsertPassage({
        passageKey: `enoch:enoch:${chapterNum}:${verseNum}`,
        textId: 'enoch',
        bookSlug: 'enoch',
        chapter: chapterNum,
        verse: verseNum,
        originalText: '',
        translation: text,
        translations: [{ name: 'R.H. Charles', text: text, isPrimary: true }],
        language: 'english',
        verseOrder: ++globalOrder,
      });

      written++;
      totalVerses++;
    }
  }

  await upsertBook({
    textId: 'enoch',
    bookId: 'enoch',
    name: 'Book of Enoch',
    chapterCount: chapters.length,
    verseCount: totalVerses,
    order: 1,
    testament: 'other',
    category: 'apocrypha',
  });

  const stats = await getTextStats('enoch');
  await prisma.text.update({
    where: { textId: 'enoch' },
    data: { bookCount: stats.bookCount, verseCount: stats.passageCount },
  });

  console.log(`✅ Book of Enoch: ${written} passages`);
  return written;
}

async function main() {
  const startedAt = Date.now();
  const total = await ingestEnoch();
  invalidateCorpusCache();
  console.log(`\n🎉 ${total} passages in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log('Next: npm run index   (build the search index and score themes)');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('\n❌ Ingestion failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
