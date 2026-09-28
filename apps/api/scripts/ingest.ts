/**
 * Data ingestion
 *
 * Pulls the five corpora from free public APIs and writes them through
 * services/passage.upsertPassage, so re-running is safe after a partial failure.
 *
 *   npm run ingest                       # everything
 *   npm run ingest -- quran              # one text
 *   npm run ingest -- --limit 20         # cap chapters per book, for a quick test
 *
 * Sources
 *   Quran   api.quran.com v4  (Arabic + Sahih International)
 *   OT/NT   bible-api.com     (KJV, public domain)
 *   Torah   Sefaria           (Hebrew + JPS-style English)
 *   Talmud  Sefaria           (Soncino Aramaic/English, key tractates)
 */

import { TextId, TEXT_METADATA } from '@ilm/shared';
import { loadLocalEnv } from '../src/lib/env';
import { stripSefariaHtml } from '../src/services/sefaria';
import { upsertBook, upsertPassage, prisma, getTextStats } from '../src/services/passage';

loadLocalEnv();

const QURAN_API = 'https://api.quran.com/api/v4';
const SEFARIA_API = 'https://www.sefaria.org/api';

// Quran.com resource ids for the English translations we ingest.
const QURAN_TRANSLATIONS = [
  { id: 20, name: 'Sahih International', primary: true },
  { id: 21, name: 'Pickthall', primary: false },
  { id: 22, name: 'Yusuf Ali', primary: false },
];

export const BIBLE_BOOKS: Record<'ot' | 'nt', string[]> = {
  ot: [
    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
    'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
    '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
    'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
    'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
    'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel',
    'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
    'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  ],
  nt: [
    'Matthew', 'Mark', 'Luke', 'John', 'Acts',
    'Romans', '1 Corinthians', '2 Corinthians', 'Galatians',
    'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians',
    '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
    'Hebrews', 'James', '1 Peter', '2 Peter', '1 John',
    '2 John', '3 John', 'Jude', 'Revelation',
  ],
};

const BIBLE_CATEGORIES: Record<string, string> = {
  Genesis: 'pentateuch', Exodus: 'pentateuch', Leviticus: 'pentateuch',
  Numbers: 'pentateuch', Deuteronomy: 'pentateuch',
  Joshua: 'history', Judges: 'history', Ruth: 'history',
  '1 Samuel': 'history', '2 Samuel': 'history', '1 Kings': 'history', '2 Kings': 'history',
  '1 Chronicles': 'history', '2 Chronicles': 'history', Ezra: 'history',
  Nehemiah: 'history', Esther: 'history', Acts: 'history',
  Job: 'wisdom', Psalms: 'wisdom', Proverbs: 'wisdom', Ecclesiastes: 'wisdom',
  'Song of Solomon': 'wisdom',
  Isaiah: 'prophets', Jeremiah: 'prophets', Lamentations: 'prophets',
  Ezekiel: 'prophets', Daniel: 'prophets',
  Hosea: 'minor_prophets', Joel: 'minor_prophets', Amos: 'minor_prophets',
  Obadiah: 'minor_prophets', Jonah: 'minor_prophets', Micah: 'minor_prophets',
  Nahum: 'minor_prophets', Habakkuk: 'minor_prophets', Zephaniah: 'minor_prophets',
  Haggai: 'minor_prophets', Zechariah: 'minor_prophets', Malachi: 'minor_prophets',
  Matthew: 'gospel', Mark: 'gospel', Luke: 'gospel', John: 'gospel',
  Romans: 'pauline', '1 Corinthians': 'pauline', '2 Corinthians': 'pauline',
  Galatians: 'pauline', Ephesians: 'pauline', Philippians: 'pauline',
  Colossians: 'pauline', '1 Thessalonians': 'pauline', '2 Thessalonians': 'pauline',
  '1 Timothy': 'pastoral', '2 Timothy': 'pastoral', Titus: 'pastoral', Philemon: 'pastoral',
  Hebrews: 'general', James: 'general', '1 Peter': 'general', '2 Peter': 'general',
  '1 John': 'johannine', '2 John': 'johannine', '3 John': 'johannine',
  Jude: 'general', Revelation: 'apocalyptic',
};

/** Sefaria's English rendering of the Mishnah, in the Soncino tradition. */
const TALMUD_TRACTATES = [
  'Berakhot', 'Shabbat', 'Eruvin', 'Pesachim', 'Shekalim',
  'Yoma', 'Sukkah', 'Beitzah', 'Rosh Hashanah', 'Taanit',
  'Megillah', 'Moed Katan', 'Chagigah', 'Yevamot', 'Kesubot',
  'Nedarim', 'Nazir', 'Sotah', 'Gitin', 'Kiddushin',
  'Bava Kamma', 'Bava Metzia', 'Bava Batra', 'Sanhedrin', 'Makkos',
  'Shevuot', 'Avodah Zarah', 'Horiot', 'Zevachim', 'Menachot',
  'Chullin', 'Bechorot', 'Arachin', 'Temurah', 'Kerisos',
  'Meilah', 'Kinnim', 'Tamid', 'Niddah',
];

// ============================================================================
// HTTP
// ============================================================================

async function getJson<T>(url: string, label: string, attempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (response.status === 404) throw Object.assign(new Error(`${label}: 404`), { notFound: true });
      if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      const notFound = (error as { notFound?: boolean }).notFound;
      if (notFound || attempt === attempts) throw error;
      const backoff = 500 * 2 ** (attempt - 1);
      console.warn(`  retry ${attempt}/${attempts - 1} for ${label} in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw new Error(`${label}: unreachable`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// QURAN
// ============================================================================

interface QuranChapter {
  id: number;
  name_simple: string;
  name_arabic: string;
  transliterated_name: string;
  verses_count: number;
  revelation_order: number;
}

interface QuranPaged<T> {
  verses: T[];
  pagination: { total_records: number; current_page: number; total_pages: number; per_page: number };
}

interface QuranVerse {
  verse_key: string;
  verse_number: number;
  text_uthmani: string;
  juz_number: number;
  hizb_number: number;
  page_number: number;
  translations: Array<{ text: string; resource_id?: number }>;
}

/** Strip the footnote markers Quran.com embeds, and normalise whitespace. */
function cleanTranslation(raw: string | undefined): string {
  return (raw ?? '')
    .replace(/<sup[^>]*foot_note[^>]*>.*?<\/sup>/g, '')
    .replace(/<sup[^>]*>.*?<\/sup>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function ingestQuran(options: { limit?: number } = {}): Promise<number> {
  console.log('\n📖 Quran — api.quran.com');

  await ensureText('quran');

  const { chapters } = await getJson<{ chapters: QuranChapter[] }>(`${QURAN_API}/chapters?language=en`, 'quran chapters');
  const selected = options.limit ? chapters.slice(0, options.limit) : chapters;

  let written = 0;
  let globalOrder = 0;

  for (const chapter of selected) {
    // api.quran.com paginates (50 per page by default), so walk every page or
    // short surahs silently come back truncated.
    const verses: QuranVerse[] = [];
    const translationParam = QURAN_TRANSLATIONS.map((t) => t.id).join(',');

    for (let page = 1; ; page += 1) {
      const response: QuranPaged<QuranVerse> = await getJson<QuranPaged<QuranVerse>>(
        `${QURAN_API}/verses/by_chapter/${chapter.id}?translations=${translationParam}&fields=text_uthmani&per_page=200&page=${page}`,
        `quran chapter ${chapter.id} page ${page}`
      );
      verses.push(...response.verses);
      if (page >= response.pagination.total_pages) break;
    }

    await upsertBook({
      textId: 'quran',
      bookId: String(chapter.id),
      name: chapter.name_simple,
      nameOriginal: chapter.name_arabic,
      nameTranslit: chapter.transliterated_name,
      chapterCount: 1,
      verseCount: verses.length,
      order: chapter.id,
      testament: 'quran',
      category: chapter.revelation_order <= 54 ? 'meccan' : 'medinan',
      description: `Surah ${chapter.id}`,
    });

    for (const verse of verses) {
      const rendered = (verse.translations ?? [])
        .map((t) => ({ id: t.resource_id, text: cleanTranslation(t.text) }))
        .filter((t) => t.text.length > 0);

      const translations = QURAN_TRANSLATIONS.map((meta) => {
        const match = rendered.find((r) => r.id === meta.id) ?? (meta.primary ? rendered[0] : undefined);
        return { name: meta.name, text: match?.text ?? '', isPrimary: meta.primary };
      }).filter((t) => t.text.length > 0);

      const primary = translations.find((t) => t.isPrimary) ?? translations[0];
      if (!primary) continue;

      await upsertPassage({
        passageKey: `quran:${chapter.id}:1:${verse.verse_number}`,
        textId: 'quran',
        bookSlug: String(chapter.id),
        chapter: 1,
        verse: verse.verse_number,
        originalText: verse.text_uthmani ?? '',
        translation: primary.text,
        translations,
        language: 'arabic',
        verseOrder: ++globalOrder,
        metadata: {
          juz: verse.juz_number,
          hizb: verse.hizb_number,
          page: verse.page_number,
          revelationOrder: chapter.revelation_order,
        },
      });
      written += 1;
    }

    process.stdout.write(`  ${chapter.id}/${selected.length} ${chapter.name_simple} (${verses.length})\r`);
    await sleep(120);
  }

  process.stdout.write('\n');
  await finalizeText('quran');
  console.log(`✅ Quran: ${written} passages`);
  return written;
}

// ============================================================================
// BIBLE (OT / NT)
// ============================================================================

/**
 * A complete public-domain KJV in one request.
 * bible-api.com only serves one chapter per request and rate-limits hard, which
 * makes a 1,189-request crawl fragile; this source is a single fetch.
 */
const KJV_BULK = 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json';

interface BulkBibleBook {
  abbrev: string;
  name: string;
  chapters: string[][];
}

export async function ingestBible(textId: 'ot' | 'nt', options: { limit?: number; translation?: string } = {}): Promise<number> {
  const translation = options.translation ?? 'KJV';
  console.log(`\n📖 ${TEXT_METADATA[textId].name} — ${translation} (bulk)`);

  await ensureText(textId);

  const books = await getJson<BulkBibleBook[]>(KJV_BULK, `${textId} source`);

  // The bulk source lists the 66 books in canonical order but names them in
  // Portuguese, so position is the reliable join key. Sanity-check the count
  // rather than silently ingesting the wrong slice.
  const offset = textId === 'ot' ? 0 : BIBLE_BOOKS.ot.length;
  const ordered = textId === 'ot' ? BIBLE_BOOKS.ot : BIBLE_BOOKS.nt;

  const expectedBookCount = BIBLE_BOOKS.ot.length + BIBLE_BOOKS.nt.length;
  if (books.length !== expectedBookCount) {
    throw new Error(`Bulk source has ${books.length} books; expected ${expectedBookCount}`);
  }

  const selected = options.limit ? ordered.slice(0, options.limit) : ordered;
  const matched = selected.map((canonicalName, i) => ({ canonicalName, source: books[offset + i] }));

  for (const [i, entry] of matched.entries()) {
    const expectedChapters = entry.source.chapters.length;
    if (expectedChapters === 0) {
      throw new Error(`Bulk source has no chapters for ${entry.canonicalName} (slot ${i})`);
    }
  }

  let written = 0;
  let globalOrder = 0;

  for (const { canonicalName: canonical, source: book } of matched) {
    let bookVerses = 0;

    for (let c = 0; c < book.chapters.length; c += 1) {
      const chapterNumber = c + 1;
      const verses = book.chapters[c];

      for (let v = 0; v < verses.length; v += 1) {
        const text = (verses[v] ?? '').replace(/\s+/g, ' ').trim();
        if (!text) continue;

        await upsertPassage({
          passageKey: `${textId}:${canonical}:${chapterNumber}:${v + 1}`,
          textId,
          bookSlug: canonical,
          chapter: chapterNumber,
          verse: v + 1,
          // The bulk source is English only. Leaving the original-language column
          // empty is honest; filling it would mean inventing the Hebrew or Greek.
          originalText: '',
          translation: text,
          translations: [{ name: translation, text, isPrimary: true }],
          language: 'english',
          verseOrder: ++globalOrder,
        });
        written += 1;
        bookVerses += 1;
      }
    }

    await upsertBook({
      textId,
      bookId: canonical,
      name: canonical,
      chapterCount: book.chapters.length,
      verseCount: bookVerses,
      order: ordered.indexOf(canonical) + 1,
      testament: textId === 'ot' ? 'old' : 'new',
      category: BIBLE_CATEGORIES[canonical] ?? 'other',
    });
  }

  console.log(`  ${matched.length} books, ${written} verses`);

  await finalizeText(textId);
  console.log(`✅ ${TEXT_METADATA[textId].name}: ${written} passages`);
  return written;
}

// ============================================================================
// SEFARIA (TORAH + TALMUD)
// ============================================================================

interface SefariaChapterResponse {
  ref: string;
  text?: unknown[];
  he?: unknown[];
  lengths?: number[];
}


/** Fetch one Sefaria chapter as parallel English and original-language segments. */
async function fetchSefariaChapter(ref: string): Promise<{ en: string[]; original: string[] } | null> {
  const data = await getJson<SefariaChapterResponse>(
    `${SEFARIA_API}/texts/${encodeURIComponent(ref)}?context=0&commentary=0&pad=0&wrap_per_vertex=0`,
    `sefaria ${ref}`,
    2
  );

  const en = Array.isArray(data.text) ? data.text : [];
  const original = Array.isArray(data.he) ? data.he : [];
  if (en.length === 0 || original.length === 0) return null;

  return {
    en: en.map(stripSefariaHtml),
    original: original.map(stripSefariaHtml),
  };
}

export async function ingestTorah(): Promise<number> {
  console.log('\n📖 Torah — Sefaria');

  await ensureText('torah');

  const books = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'];
  let written = 0;
  let globalOrder = 0;

  for (const book of books) {
    const index = await getJson<{ lengths?: number[] }>(`${SEFARIA_API}/texts/${encodeURIComponent(book)}?context=0`, `torah index ${book}`);
    const chapterCount = index.lengths?.[0] ?? 0;
    if (chapterCount === 0) {
      console.warn(`  skipping ${book}: Sefaria reported no chapters`);
      continue;
    }

    let bookVerses = 0;

    for (let chapter = 1; chapter <= chapterCount; chapter += 1) {
      const data = await fetchSefariaChapter(`${book}.${chapter}`);
      if (!data) continue;

      for (let i = 0; i < data.original.length; i += 1) {
        const original = data.original[i];
        const translation = data.en[i];
        if (!original || !translation) continue;

        await upsertPassage({
          passageKey: `torah:${book}:${chapter}:${i + 1}`,
          textId: 'torah',
          bookSlug: book,
          chapter,
          verse: i + 1,
          originalText: original,
          translation,
          translations: [{ name: 'Sefaria English (JPS 1985)', text: translation, isPrimary: true }],
          language: 'hebrew',
          verseOrder: ++globalOrder,
        });
        written += 1;
        bookVerses += 1;
      }

      await sleep(60);
    }

    await upsertBook({
      textId: 'torah',
      bookId: book,
      name: book,
      chapterCount,
      verseCount: bookVerses,
      order: books.indexOf(book) + 1,
      testament: 'torah',
      category: 'pentateuch',
    });

    console.log(`  ${book}: ${chapterCount} chapters, ${bookVerses} verses`);
  }

  await finalizeText('torah');
  console.log(`✅ Torah: ${written} passages`);
  return written;
}

/**
 * Sefaria's Mishnah titles do not all match their English names. Resolved
 * spellings are listed here; anything unresolved is skipped with a warning
 * rather than silently mis-filed.
 */
const SEFARIA_TRACTATE_ALIASES: Record<string, string> = {
  Kesubot: 'Ketubot',
  Gitin: 'Gittin',
  Makkos: 'Makkot',
  Horiot: 'Horayot',
  Bechorot: 'Bekhorot',
  Arachin: 'Arakhin',
};

/** Sefaria's Mishnah, in its English rendering based on the Soncino tradition. */
export async function ingestTalmud(options: { limit?: number } = {}): Promise<number> {
  console.log('\n📖 Talmud (Mishnah, Bavli) — Sefaria');

  await ensureText('talmud');

  const tractates = options.limit ? TALMUD_TRACTATES.slice(0, options.limit) : TALMUD_TRACTATES;
  let written = 0;
  let globalOrder = 0;

  const skipped: string[] = [];

  for (const tractate of tractates) {
    const sefariaTitle = SEFARIA_TRACTATE_ALIASES[tractate] ?? tractate;
    let mishnahCount = 0;
    let chapterCount = 0;

    // Mishnah tractates have at most nine chapters; stop at the first empty one.
    for (let chapter = 1; chapter <= 12; chapter += 1) {
      let data: { en: string[]; original: string[] } | null;
      try {
        data = await fetchSefariaChapter(`Mishnah_${sefariaTitle}.${chapter}`);
      } catch {
        data = null;
      }
      if (!data) break;

      chapterCount = chapter;

      for (let i = 0; i < data.original.length; i += 1) {
        const original = data.original[i];
        const translation = data.en[i];
        if (!original || !translation || !isOriginalScript(original)) continue;

        await upsertPassage({
          passageKey: `talmud:${tractate}:${chapter}:${i + 1}`,
          textId: 'talmud',
          bookSlug: tractate,
          chapter,
          verse: i + 1,
          originalText: original,
          translation,
          translations: [{ name: 'Soncino (Sefaria)', text: translation, isPrimary: true }],
          language: 'aramaic',
          verseOrder: ++globalOrder,
        });
        written += 1;
        mishnahCount += 1;
      }

      await sleep(60);
    }

    if (mishnahCount > 0) {
      await upsertBook({
        textId: 'talmud',
        bookId: tractate,
        name: tractate,
        chapterCount,
        verseCount: mishnahCount,
        order: tractates.indexOf(tractate) + 1,
        testament: 'talmud',
        category: 'mishnah',
      });
    }

    if (mishnahCount === 0) skipped.push(tractate);
    process.stdout.write(`  ${tractate}: ${mishnahCount} mishnayot\r`);
  }

  process.stdout.write('\n');
  if (skipped.length > 0) {
    console.warn(`  Sefaria has no Mishnah under these names: ${skipped.join(', ')}`);
  }
  await finalizeText('talmud');
  console.log(`✅ Talmud: ${written} passages`);
  return written;
}

/** Hebrew, Aramaic, or Greek script — used to tell original text from translation. */
function isOriginalScript(text: string): boolean {
  return /[\u0590-\u05FF\u0700-\u074F\u0370-\u03FF]/.test(text);
}

// ============================================================================
// TEXT BOOKKEEPING
// ============================================================================

async function ensureText(textId: TextId): Promise<void> {
  const meta = TEXT_METADATA[textId];
  await prisma.text.upsert({
    where: { textId },
    create: {
      textId,
      name: meta.name,
      originalLang: meta.originalLanguage,
      direction: meta.direction,
      bookCount: meta.bookCount,
      verseCount: 0,
    },
    update: { name: meta.name, originalLang: meta.originalLanguage, direction: meta.direction },
  });
}

async function finalizeText(textId: TextId): Promise<void> {
  const stats = await getTextStats(textId);
  await prisma.text.update({
    where: { textId },
    data: { bookCount: stats.bookCount, verseCount: stats.passageCount },
  });
}

// ============================================================================
// ENTRY POINT
// ============================================================================

const TEXTS: Record<string, (options: { limit?: number }) => Promise<number>> = {
  quran: ingestQuran,
  torah: () => ingestTorah(),
  talmud: ingestTalmud,
  ot: (options) => ingestBible('ot', options),
  nt: (options) => ingestBible('nt', options),
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;
  const requested = args.filter((a) => !a.startsWith('--') && a !== String(limit)).filter((a) => a in TEXTS);

  const targets = requested.length > 0 ? requested : Object.keys(TEXTS);

  if (targets.length > 0 && args.includes('--list')) {
    console.log(`Available texts: ${Object.keys(TEXTS).join(', ')}`);
    return;
  }

  console.log(`🚀 Ingesting: ${targets.join(', ')}${limit ? ` (limit ${limit} per book)` : ''}`);

  const startedAt = Date.now();
  let total = 0;

  for (const textId of targets) {
    total += await TEXTS[textId]({ limit });
  }

  console.log(`\n🎉 ${total} passages in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log('Next: npm run index   (build the search index and score themes)');
}

// Only when run directly. Importing this module for its helpers must not start a
// full corpus ingest as a side effect.
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/ingest.ts');

if (isDirectRun) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error('\n❌ Ingestion failed:', error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
