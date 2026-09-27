/**
 * Additional translations for the Bible corpora.
 *
 * The OT and NT were ingested from a single English file, so every passage in both
 * has exactly one translation and a translation switcher has nothing to switch
 * between. This fetches further published translations and attaches them to the
 * passages that already exist.
 *
 * Update-only, for the same reason as the Hebrew ingest: our verse numbering comes
 * from the KJV file and not every translation divides verses identically. A verse
 * this source does not have is left alone rather than created, because a passage
 * with no primary translation is worse than a missing alternate.
 *
 * bible-api.com is used because it returns per-verse references together with the
 * translation's own published name, so nothing here has to be labelled by guesswork.
 * A bulk GitHub mirror was rejected: its `en_*` files are Portuguese despite the
 * filename, which would have put mislabelled text in front of a reader as scripture.
 *
 *   npx tsx --env-file=.env scripts/ingest-translations.ts
 *   npx tsx --env-file=.env scripts/ingest-translations.ts --translation web
 *   npx tsx --env-file=.env scripts/ingest-translations.ts --book John
 */

import { prisma } from '../src/services/passage';
import { loadLocalEnv } from '../src/lib/env';

loadLocalEnv();

const BIBLE_API = 'https://bible-api.com';

interface TranslationSpec {
  id: string;
  note: string;
}

/**
 * Translations to add. The name is taken from the source's own response rather than
 * hardcoded, so a translation that renames itself is labelled correctly.
 *
 * ASV is public domain and WEB is likewise freely redistributable; BBE is included
 * as a third voice. The licence each carries is recorded from the source response
 * where available.
 */
const TRANSLATIONS: TranslationSpec[] = [
  { id: 'web', note: 'freely redistributable' },
  { id: 'asv', note: 'public domain' },
  { id: 'bbe', note: 'public domain' },
];

/**
 * USFM book codes to our book names.
 *
 * bible-api.com identifies books by USFM abbreviation ("PSA", "JHN"), which does not
 * match the names our passage keys use. Mapped explicitly rather than guessed, since
 * a wrong mapping would attach a translation to the wrong book.
 */
const USFM_TO_BOOK: Record<string, string> = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy',
  JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
  EZR: 'Ezra', NEH: 'Nehemiah', EST: 'Esther', JOB: 'Job', PSA: 'Psalms',
  PRO: 'Proverbs', ECC: 'Ecclesiastes', SNG: 'Song of Solomon', ISA: 'Isaiah',
  JER: 'Jeremiah', LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea',
  JOL: 'Joel', AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah',
  NAM: 'Nahum', HAB: 'Habakkuk', ZEP: 'Zephaniah', HAG: 'Haggai', ZEC: 'Zechariah',
  MAL: 'Malachi',
  MAT: 'Matthew', MRK: 'Mark', LUK: 'Luke', JHN: 'John', ACT: 'Acts',
  ROM: 'Romans', '1CO': '1 Corinthians', '2CO': '2 Corinthians', GAL: 'Galatians',
  EPH: 'Ephesians', PHI: 'Philippians', COL: 'Colossians', '1TH': '1 Thessalonians',
  '2TH': '2 Thessalonians', '1TI': '1 Timothy', '2TI': '2 Timothy', TIT: 'Titus',
  PHM: 'Philemon', HEB: 'Hebrews', JAS: 'James', '1PE': '1 Peter', '2PE': '2 Peter',
  '1JN': '1 John', '2JN': '2 John', '3JN': '3 John', JUD: 'Jude', REV: 'Revelation',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Delay between chapter requests.
 *
 * bible-api.com answers 429 well before this script would otherwise finish: at 40ms
 * it refused one chapter in twenty. One request a second is unfashionably slow but
 * gets through, and 1,189 chapters still completes in about twenty minutes per
 * translation. Raising this is cheaper than re-running and re-fetching.
 */
const REQUEST_DELAY_MS = 2500;

async function getJson<T>(url: string, label: string, attempts = 4): Promise<T | null> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'ilm-ingest/1.0 (comparative text research)' },
        signal: AbortSignal.timeout(45_000),
      });

      if (response.status === 429) {
        // Being told to slow down is not a failure to retry past: back off hard and
        // try again, or the whole run fails on a rate limit rather than on data.
        const wait = 5000 * attempt;
        console.warn(`  … rate limited on ${label}, waiting ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      if (attempt === attempts) {
        console.warn(`  ! ${label} failed after ${attempts} attempts: ${(error as Error).message}`);
        return null;
      }
      await sleep(1500 * attempt);
    }
  }
  return null;
}

interface ChapterResponse {
  reference?: string;
  verses?: Array<{ book_id?: string; chapter?: number; verse?: number; text?: string }>;
  translation_id?: string;
  translation_name?: string;
  translation_note?: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlyTranslation = args[args.indexOf('--translation') + 1];
  const onlyBook = args.find((a) => !a.startsWith('--') && a !== onlyTranslation) ?? null;

  const specs = onlyTranslation ? TRANSLATIONS.filter((t) => t.id === onlyTranslation) : TRANSLATIONS;
  if (specs.length === 0) {
    console.log(`Unknown translation "${onlyTranslation}". Available: ${TRANSLATIONS.map((t) => t.id).join(', ')}`);
    return;
  }

  // Chapters that already have passages, so the loop is driven by our verse
  // numbering and never by the source's.
  const chapters = await prisma.passage.findMany({
    where: {
      textId: { in: ['ot', 'nt'] },
      ...(onlyBook ? { bookSlug: { in: await bookSlugsFor(onlyBook) } } : {}),
    },
    select: { bookSlug: true, chapterNum: true },
    distinct: ['bookSlug', 'chapterNum'],
    orderBy: [{ bookSlug: 'asc' }, { chapterNum: 'asc' }],
  });

  if (chapters.length === 0) {
    console.log('No OT/NT chapters found. Has the Bible been ingested?');
    return;
  }

  const usfmByBook = new Map<string, string>();
  for (const [usfm, name] of Object.entries(USFM_TO_BOOK)) usfmByBook.set(name, usfm);

  const unattributed = chapters.filter((c) => !usfmByBook.has(c.bookSlug));
  if (unattributed.length > 0) {
    const names = [...new Set(unattributed.map((c) => c.bookSlug))];
    console.warn(`  ! no USFM mapping for: ${names.join(', ')} — these chapters are skipped`);
  }

  console.log(`📖 Translations — bible-api.com (${specs.map((s) => s.id).join(', ')})`);
  console.log(`   ${chapters.length} chapters, update-only.\n`);

  for (const spec of specs) {
    let written = 0;
    let missingSource = 0;
    let noVerse = 0;
    let translationName = `${spec.id} (${spec.note})`;

    for (const { bookSlug: book, chapterNum } of chapters) {
      const usfm = usfmByBook.get(book);
      if (!usfm) continue;

      const data = await getJson<ChapterResponse>(
        `${BIBLE_API}/${encodeURIComponent(usfm)}%20${chapterNum}?translation=${spec.id}`,
        `${spec.id} ${book} ${chapterNum}`
      );

      if (!data) {
        missingSource += 1;
        continue;
      }

      // The source names the translation; use its name rather than our label.
      if (data.translation_name) translationName = data.translation_name;
      if (!Array.isArray(data.verses)) continue;

      const existing = await prisma.passage.findMany({
        where: { bookSlug: book, chapterNum, textId: { in: ['ot', 'nt'] } },
        select: { id: true, verseNum: true },
        orderBy: { verseNum: 'asc' },
      });
      if (existing.length === 0) continue;

      const byVerse = new Map(data.verses.filter((v) => typeof v.verse === 'number').map((v) => [v.verse as number, v.text ?? '']));
      const rows = existing
        .map((passage) => ({ id: passage.id, text: (byVerse.get(passage.verseNum) ?? '').trim() }))
        .filter((row) => row.text.length > 0);

      noVerse += existing.length - rows.length;

      if (rows.length === 0) continue;

      written += await attach(rows, translationName);
      await sleep(REQUEST_DELAY_MS);
    }

    console.log(`  ${translationName}: ${written} verses attached`);
    console.log(`     no such verse in this translation: ${noVerse}`);
    console.log(`     chapters the source did not return: ${missingSource}`);
  }

  console.log('\nNote: existing passages keep their current primary translation; these are additions.');
}

/**
 * Attach a translation to a set of passages.
 *
 * The `translations` row is shared across the whole corpus, so it is looked up once
 * per batch and the id reused.
 */
async function attach(rows: Array<{ id: string; text: string }>, name: string): Promise<number> {
  const translation = await prisma.translation.upsert({
    where: { textId_name_language: { textId: 'ot', name, language: 'english' } },
    create: { textId: 'ot', name, language: 'english', translator: name, isPrimary: false },
    update: {},
  });

  // Skip verses that already carry this translation, so a re-run is cheap and does
  // not churn rows.
  const existing = await prisma.passageTranslation.findMany({
    where: { translationId: translation.id, passageId: { in: rows.map((r) => r.id) } },
    select: { passageId: true },
  });
  const have = new Set(existing.map((e) => e.passageId));
  const fresh = rows.filter((r) => !have.has(r.id));
  if (fresh.length === 0) return 0;

  await prisma.passageTranslation.createMany({
    data: fresh.map((r) => ({ passageId: r.id, translationId: translation.id, text: r.text })),
    skipDuplicates: true,
  });

  return fresh.length;
}

/** Our book slugs for one book name, so `--book John` only walks that book. */
async function bookSlugsFor(name: string): Promise<string[]> {
  const books = await prisma.book.findMany({ where: { textId: { in: ['ot', 'nt'] } }, select: { bookId: true } });
  const wanted = name.toLowerCase();
  return books.map((b) => b.bookId).filter((id) => id.toLowerCase() === wanted);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('\n❌ Failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
