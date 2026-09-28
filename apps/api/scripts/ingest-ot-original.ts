/**
 * Original-language text for the Old Testament.
 *
 * The OT was ingested from a bulk KJV file, which has no Hebrew, so every OT
 * passage has an empty `originalText`. That blocks two things: lexicon lookup
 * needs a word in its original script, and cognate detection between passages
 * needs two words to compare.
 *
 * Sefaria's Tanakh is the same 39 books, so the Hebrew is fetched from there and
 * attached to the passages that already exist.
 *
 * This script only ever UPDATES. It never inserts a passage, and that constraint
 * is the whole point: the Masoretic text and the KJV do not divide verses
 * identically. Daniel 3 has 33 verses in Hebrew and 30 in English, so a plain
 * upsert would mint `ot:Daniel:3:31..33` — verses with Hebrew and no translation,
 * which would then appear in search results and comparisons as blank rows. Verses
 * the KJV does not have are reported as uncovered and left alone.
 *
 *   npx tsx --env-file=.env scripts/ingest-ot-original.ts
 *   npx tsx --env-file=.env scripts/ingest-ot-original.ts --book Genesis
 */

import { prisma } from '../src/services/passage';
import { stripSefariaHtml } from '../src/services/sefaria';
import { loadLocalEnv } from '../src/lib/env';

loadLocalEnv();

const SEFARIA_API = 'https://www.sefaria.org/api';

/**
 * Sefaria's canonical titles for the numbered books. It resolves "I Samuel" but
 * not "1 Samuel", and our book ids are the numeric form, so each needs mapping.
 * Unlisted books use their own name, which Sefaria already accepts.
 */
const SEFARIA_TITLES: Record<string, string> = {
  '1 Samuel': 'I Samuel',
  '2 Samuel': 'II Samuel',
  '1 Kings': 'I Kings',
  '2 Kings': 'II Kings',
  '1 Chronicles': 'I Chronicles',
  '2 Chronicles': 'II Chronicles',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson<T>(url: string, label: string, attempts = 3): Promise<T | null> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'ilm-ingest/1.0 (comparative text research)' },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      if (attempt === attempts) {
        console.warn(`  ! ${label} failed after ${attempts} attempts: ${(error as Error).message}`);
        return null;
      }
      await sleep(1200 * attempt);
    }
  }
  return null;
}

interface SefariaChapter {
  he?: unknown[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.find((a) => !a.startsWith('--')) ?? null;

  const books = await prisma.book.findMany({
    where: { textId: 'ot', ...(only ? { bookId: only } : {}) },
    orderBy: { order: 'asc' },
    select: { id: true, bookId: true },
  });

  if (books.length === 0) {
    console.log('No OT books found. Has the OT been ingested?');
    return;
  }

  console.log(`📖 Old Testament — original Hebrew from Sefaria (${books.length} books)`);
  console.log('   Update-only: verses the KJV does not have are reported, not created.\n');

  let filled = 0;
  let alreadyHad = 0;
  let uncovered = 0;
  let missingChapter = 0;
  let mismatchedShape = 0;

  for (const book of books) {
    const title = SEFARIA_TITLES[book.bookId] ?? book.bookId;

    // Only chapters that already have passages, so the loop cannot walk verses
    // the English side never produced.
    const chapters = await prisma.passage.findMany({
      where: { bookRef: book.id },
      select: { chapterNum: true },
      distinct: ['chapterNum'],
      orderBy: { chapterNum: 'asc' },
    });

    let bookFilled = 0;
    let skippedChapters = 0;

    for (const { chapterNum } of chapters) {
      /*
       * Checked before the request, not after.
       *
       * A completed chapter has nothing to update, and asking Sefaria for 929
       * chapters on every re-run turns an idempotent script into an hour of
       * network calls. The count is a cheap indexed read; the request is not.
       * This is what makes retrying the handful of chapters that failed on a
       * transient error a minute of work instead of a full re-ingest.
       */
      const remaining = await prisma.passage.count({
        where: { bookRef: book.id, chapterNum, originalText: '' },
      });
      if (remaining === 0) {
        skippedChapters += 1;
        continue;
      }

      const ref = `${title}.${chapterNum}`;
      const data = await getJson<SefariaChapter>(
        `${SEFARIA_API}/texts/${encodeURIComponent(ref)}?context=0&commentary=0&pad=0&wrap_per_vertex=0`,
        `ot ${ref}`
      );

      const he = Array.isArray(data?.he) ? data.he : null;
      if (!he) {
        missingChapter += 1;
        continue;
      }

      const passages = await prisma.passage.findMany({
        where: { bookRef: book.id, chapterNum },
        select: { id: true, verseNum: true, originalText: true },
        orderBy: { verseNum: 'asc' },
      });

      // A chapter whose Hebrew and English verse counts disagree is normal. The
      // loop is driven by our verses, never by Sefaria's, so the extra Hebrew
      // verses simply have no row to attach to.
      if (he.length !== passages.length) mismatchedShape += 1;

      const updates: Array<{ id: string; originalText: string }> = [];
      for (const passage of passages) {
        const raw = he[passage.verseNum - 1];
        const original = stripSefariaHtml(raw);
        if (!original) {
          uncovered += 1;
          continue;
        }
        if (passage.originalText) {
          alreadyHad += 1;
          continue;
        }
        updates.push({ id: passage.id, originalText: original });
      }

      if (updates.length > 0) {
        // One statement for the chapter rather than one per verse: 929 chapters of
        // individual UPDATEs is minutes of round trips for no benefit.
        await prisma.$transaction([
          ...updates.map((u) => prisma.passage.update({ where: { id: u.id }, data: { originalText: u.originalText } })),
          // The OT was ingested from an English-only file, so every row was recorded
          // as `english`. With Hebrew now attached, the script has to be corrected
          // too or the passage renders in the Latin font and the section is labelled
          // "Original (english)".
          ...(updates.length > 0
            ? [prisma.passage.updateMany({ where: { id: { in: updates.map((u) => u.id) } }, data: { language: 'hebrew' } })]
            : []),
        ]);
        filled += updates.length;
        bookFilled += updates.length;
      }

      await sleep(50);
    }

    console.log(`  ${book.bookId.padEnd(20)} ${bookFilled} verses filled${skippedChapters > 0 ? ` (${skippedChapters} chapters already complete)` : ''}`);
  }

  const remaining = await prisma.passage.count({ where: { textId: 'ot', originalText: '' } });

  console.log(`\n✅ filled ${filled} verses`);
  console.log(`   already had Hebrew: ${alreadyHad}`);
  console.log(`   no Hebrew for that verse number: ${uncovered}`);
  console.log(`   chapters Sefaria did not return: ${missingChapter}`);
  console.log(`   chapters where verse counts differ (expected; English side wins): ${mismatchedShape}`);
  console.log(`   OT verses still without original text: ${remaining}`);
  console.log('\nNote: the Orama search index does not index original text, so it needs no rebuild.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('\n❌ Failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
