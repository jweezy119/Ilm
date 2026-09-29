/**
 * Ingest al-Bukhari and Sahih Muslim.
 *
 * Two corpora, not one. A hadith is cited by its collection — al-Bukhari 2:4 is not
 * the same claim as Muslim 2:4 — so a single "Hadith" bucket could not carry the
 * distinction a citation depends on, and the reference the API hands us is
 * `book:hadith` within a named collection.
 *
 *   npx tsx scripts/ingest-hadith.ts [--texts=bukhari,muslim] [--limit=N]
 *
 * Source: fawazahmed0/hadith-api on jsDelivr. Free, no key, CC0-adjacent, and the
 * Arabic is the vocalized matn-and-isnad text rather than a modern retyping.
 *
 * Two of the six Sunni collections, and deliberately:
 *
 *   al-Bukhari   7,589 hadiths
 *   Sahih Muslim 7,563 hadiths
 *
 * Both are sahih by the consensus of Sunni scholarship, so neither carries a
 * per-hadith grade and neither requires the caveat. The four Sunan do carry grades
 * — 5,274 of 5,274 in Abu Dawud — and shipping them means shipping da'if material
 * with its grade attached and visible. That is worth doing and it is a separate run.
 *
 * On the isnad: the source concatenates chain and report into one field, and there
 * is no reliable delimiter — guillemets appear in 2 of 7,589 and a colon after
 * qala in 8. So no boundary is guessed here. The full text is indexed, and the
 * narrator names are recorded separately because they are a closed set of a few
 * dozen recurring names; chain overlap is then comparable without needing to know
 * where the chain stops. Ranking is not harmed by the names, since a name appearing
 * in most hadiths has almost no inverse document frequency.
 *
 * Idempotent: every write upserts on the passage key, so a re-run is safe.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fold } from '../src/lib/script-normalize';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = join(homedir(), '.ilm-logs', 'hadith-cache');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UA = 'ilm-ingest/0.1 (scripture comparison app)';

const EDITION_BASE = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions';

/** Per language, because Arabic and English share a hadith number but not a text. */
const EDITIONS: Array<{ textId: 'bukhari' | 'muslim'; lang: 'ara' | 'eng'; name: string }> = [
  { textId: 'bukhari', lang: 'ara', name: 'Sahih al-Bukhari' },
  { textId: 'bukhari', lang: 'eng', name: 'Sahih al-Bukhari' },
  { textId: 'muslim', lang: 'ara', name: 'Sahih Muslim' },
  { textId: 'muslim', lang: 'eng', name: 'Sahih Muslim' },
];

interface RawHadith {
  hadithnumber: number;
  arabicnumber?: number;
  text: string;
  grades?: Array<{ name: string; grade: string; voted_by?: string | null }>;
  reference?: { book: number; hadith: number };
}

async function fetchEdition(textId: string, lang: string): Promise<RawHadith[]> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `${lang}-${textId}.json`);

  if (existsSync(file)) {
    const stat = JSON.parse(readFileSync(file, 'utf8')) as { at: number; hadiths: RawHadith[] };
    if (Date.now() - stat.at < CACHE_TTL_MS) return stat.hadiths;
  }

  const url = `${EDITION_BASE}/${lang}-${textId}.json`;
  process.stderr.write(`  fetching ${lang}-${textId} ... `);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const body = (await res.json()) as { hadiths: RawHadith[] };
  writeFileSync(file, JSON.stringify({ at: Date.now(), hadiths: body.hadiths }));
  process.stderr.write(`${body.hadiths.length.toLocaleString()} hadiths\n`);
  return body.hadiths;
}

/*
 * The recurring transmitters and Companions, as they appear after the definite
 * article. A closed set of a few dozen, and it only has to be a superset of the
 * names that actually recur to be useful — this is for chain overlap, not for
 * scholarship, and the UI will say so.
 */
const NARRATORS = [
  'أبو بكرة', 'أبو هريرة', 'أبو هرير', 'أبو مسعود', 'أبو ذر', 'أبو سعيد', 'أبو هريرة',
  'عمر بن الخطاب', 'عثمان بن عفان', 'علي بن أبي طالب', 'عائشة', 'حفصة', 'زينب',
  'عبد الله بن عمر', 'عبد الله بن العباس', 'عبد الله بن مسعود', 'عبد الله بن أبي',
  'أنس بن مالك', 'ابن عمر', 'ابن عباس', 'ابن مسعود', 'ابن أبي أوسب', 'ابن جرير',
  'أبو داود', 'أبو سعيد الخدري', 'أبو مالك', 'أبو المجاور', 'أبو حميد', 'أبو بردة',
  'أبو نعيم', 'أبو عابد', 'سعيد بن المسيب', 'سعيد بن جبير', 'سعيد بن أبي سعيد',
  'محمود بن ربيع', 'محمد بن أبي الحارث', 'مالك بن أنس', 'مالك', 'نافع', 'الزهري',
  'هشام بن عروة', 'هشام بن محمد', 'عمرو بن العاص', 'خالد بن الوليد', 'أبو عبيدة',
  'أبو سلمة', 'أبو عمرو', 'أبو موسى', 'أبو هريرة', 'سليم', 'قتادة', 'الزبير',
  'ابن سيرين', 'محمد بن بشير', 'محمد بن عمرو', 'ابن جريج', 'أبو حنيفة', 'أبو يعقوب',
  'أبو أيوب', 'أبو رقية', 'بشر بن المفضل', 'يحيى بن سعيد', 'محمد بن مقاد',
];

/*
 * Any of the recurring names present in the text.
 *
 * The source is fully vocalized — أَبُو هُرَيْرَةَ — and the list above is written
 * plain, so matching the two directly found nothing at all. The first run recorded
 * a transmitter on 0 of 200 hadiths, which is the kind of quietly wrong result a
 * zero does not look like. Both sides are folded with the shared normalizer first,
 * which is what script-normalize is for and which AGENTS.md is explicit about.
 */
function narratorsIn(text: string): string[] {
  const flat = fold(text);
  const found = new Set<string>();
  for (const name of NARRATORS) {
    if (flat.includes(fold(name))) found.add(name);
  }
  return [...found];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (flag: string, fallback: string) => {
    const inline = argv.find((a) => a.startsWith(`${flag}=`));
    if (inline) return inline.slice(flag.length + 1);
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const wanted = arg('--texts', 'bukhari,muslim').split(',');
  const limitArg = Number(arg('--limit', '0'));
  const limit = limitArg > 0 ? limitArg : Number.POSITIVE_INFINITY;

  process.env.DATABASE_URL = process.env.ILM_PILOT_DB ?? process.env.DATABASE_URL ?? '';
  const { prisma } = await import('../src/services/passage');

  for (const textId of wanted as Array<'bukhari' | 'muslim'>) {
    if (!EDITIONS.some((e) => e.textId === textId)) {
      throw new Error(`unknown hadith corpus: ${textId}`);
    }

    const arabic = await fetchEdition(textId, 'ara');
    const english = await fetchEdition(textId, 'eng');

    const englishByNumber = new Map(english.map((h) => [h.hadithnumber, h]));
    const rows = arabic.slice(0, limit === Number.POSITIVE_INFINITY ? undefined : limit);

    console.log(`\n${textId}: ${rows.length.toLocaleString()} hadiths from ${arabic.length.toLocaleString()}`);

    // The kitab is the book, and the hadith number is the chapter, so the citation
    // reads book:chapter — al-Bukhari 2:4 — straight off the reference, with no
    // invented level in between. A hadith is cited by collection and number, and
    // that is exactly what the key carries.
    const kitabs = new Map<number, number>();
    const chapters: Array<{ id: string; bookId: string; num: number }> = [];
    const passages: Array<Record<string, unknown>> = [];
    // Keyed by passage key, because passage_translations references the passage's
    // id — a cuid the database assigns — and not its passage key. The first attempt
    // passed the key and failed on passage_translations_passage_id_fkey.
    const translations: Array<{ passageKey: string; name: string; language: string; text: string; isPrimary: boolean }> = [];

    for (const h of rows) {
      const kitab = h.reference?.book;
      const number = h.reference?.hadith;
      if (!kitab || !number) continue;

      const bookId = `${textId}:${kitab}`;
      const chapterId = `${bookId}:${number}`;
      const passageKey = `${bookId}:${number}:1`;

      if (!kitabs.has(kitab)) kitabs.set(kitab, (kitabs.get(kitab) ?? 0) + 1);
      chapters.push({ id: chapterId, bookId, num: number });

      const eng = englishByNumber.get(h.hadithnumber);
      const narrators = narratorsIn(h.text);

      passages.push({
        passageKey,
        textId,
        bookRef: bookId,
        bookSlug: String(kitab),
        chapterRef: chapterId,
        chapterNum: number,
        verseNum: 1,
        originalText: h.text.trim(),
        primaryTranslation: (eng?.text ?? '').trim(),
        primaryTranslationId: null,
        language: 'arabic',
        verseOrder: h.hadithnumber,
        metadata: {
          hadithNumber: h.hadithnumber,
          arabicNumber: h.arabicnumber ?? null,
          kitab: kitab,
          narrators,
          // The chain and the report are one field at the source, and no boundary
          // between them is guessed. Recorded so nothing downstream assumes one.
          chainSeparated: false,
          grades: h.grades ?? [],
        },
      });

      if (eng?.text) {
        translations.push({
          passageKey,
          name: `${textId === 'bukhari' ? 'Bukhari' : 'Muslim'} (English)`,
          language: 'english',
          text: eng.text.trim(),
          isPrimary: true,
        });
      }
    }

    console.log(`  kitabs: ${kitabs.size}  passages: ${passages.length}  translations: ${translations.length}`);

    /*
     * Written parent-first: texts, then books, then chapters, then passages.
     *
     * The order is the foreign keys. Passages reference texts and chapters, chapters
     * reference books, and books reference texts — so the first attempt at this
     * failed on passages_text_id_fkey because the Text row was created at the end,
     * after the rows that needed it.
     *
     * Every write is an upsert on the natural key, so a re-run after a partial
     * failure is safe and a re-run after a success changes nothing.
     */
    console.log('  [1/4] text');
    await prisma.text.upsert({
      where: { textId },
      create: {
        textId,
        name: textId === 'bukhari' ? 'Sahih al-Bukhari' : 'Sahih Muslim',
        originalLang: 'arabic',
        direction: 'rtl',
        bookCount: kitabs.size,
        verseCount: passages.length,
      },
      update: { bookCount: kitabs.size, verseCount: passages.length },
    });

    console.log(`  [2/4] books (${kitabs.size})`);
    const books = [...kitabs.entries()].map(([num, count]) => ({
      id: `${textId}:${num}`,
      textId,
      bookId: String(num),
      name: `Kitāb ${num}`,
      nameOriginal: null,
      chapterCount: count,
      verseCount: count,
      order: num,
    }));
    for (let i = 0; i < books.length; i += 500) {
      await prisma.$transaction(
        books.slice(i, i + 500).map((b) =>
          prisma.book.upsert({ where: { id: b.id }, create: b as never, update: { chapterCount: b.chapterCount } })
        )
      );
    }

    // One chapter per hadith, which follows from the citation shape rather than any
    // claim that a hadith is a chapter: the citation is kitab:hadith and the key
    // carries it whole.
    console.log(`  [3/4] chapters (${chapters.length})`);
    for (let i = 0; i < chapters.length; i += 1000) {
      await prisma.$transaction(
        chapters.slice(i, i + 1000).map((c) =>
          prisma.chapter.upsert({
            where: { id: c.id },
            create: { id: c.id, bookRef: c.bookId, number: c.num, name: null, nameOriginal: null, verseCount: 1 },
            update: { verseCount: 1 },
          })
        )
      );
    }

    console.log(`  [4/4] passages (${passages.length}) translations (${translations.length})`);
    const passageIdByKey = new Map<string, string>();
    for (let i = 0; i < passages.length; i += 1000) {
      const written = await prisma.$transaction(
        passages.slice(i, i + 1000).map((row) =>
          prisma.passage.upsert({
            where: { passageKey: (row as { passageKey: string }).passageKey },
            create: row as never,
            update: {
              originalText: (row as { originalText: string }).originalText,
              primaryTranslation: (row as { primaryTranslation: string }).primaryTranslation,
              metadata: (row as { metadata: unknown }).metadata as never,
            },
          })
        )
      );
      for (const row of written) passageIdByKey.set(row.passageKey, row.id);
    }

    console.log('  [5/4] translations');
    for (let i = 0; i < translations.length; i += 1000) {
      const batch = translations.slice(i, i + 1000);
      // One translation row per corpus, reused by every hadith in the batch.
      const existing = await prisma.translation.findFirst({ where: { name: batch[0].name } });
      const translation = existing
        ?? (await prisma.translation.create({
            data: { name: batch[0].name, language: batch[0].language, isPrimary: true, textId },
          }));
      await prisma.$transaction(
        batch.map((t) => {
          const passageId = passageIdByKey.get(t.passageKey);
          if (!passageId) throw new Error(`no passage id recorded for ${t.passageKey}`);
          return prisma.passageTranslation.upsert({
            where: { passageId_translationId: { passageId, translationId: translation.id } },
            create: { passageId, translationId: translation.id, text: t.text },
            update: { text: t.text },
          });
        })
      );
    }

    /*
     * Rebuild the search vector now the translations exist.
     *
     * The row trigger fires on insert, and at that moment the passage has no
     * translation row yet, so it builds the vector from the metadata alone and the
     * body weighs nothing. The trigger does not fire again — it watches
     * book_slug, text_id and primary_translation, none of which change when a
     * translation is inserted afterwards. So without this the hadith would be
     * indexed by corpus name and unsearchable by their own words.
     *
     * One statement rather than a call per passage: 15,152 round trips is minutes
     * of nothing, and this is the same shape as the backfill in migration 4.
     */
    console.log('  rebuilding search vectors');
    await prisma.$executeRawUnsafe(
      `UPDATE passages p
       SET search_vector =
             setweight(to_tsvector('english', coalesce(tr_text.text, '')), 'A') ||
             setweight(to_tsvector('english', coalesce(th.names, '')), 'B') ||
             setweight(to_tsvector('simple', p.book_slug || ' ' || p.text_id || ' ' || p.primary_translation), 'C')
       FROM passages p2
       LEFT JOIN LATERAL (
         SELECT t2.text
         FROM passage_translations t2
         JOIN translations tr2 ON tr2.id = t2.translation_id
         WHERE t2.passage_id = p2.id
         ORDER BY (tr2.is_primary) DESC NULLS LAST
         LIMIT 1
       ) tr_text ON true
       LEFT JOIN LATERAL (
         SELECT string_agg(DISTINCT pt2.theme_id, ' ') AS names
         FROM passage_themes pt2
         WHERE pt2.passage_id = p2.id
       ) th ON true
       WHERE p2.id = p.id AND p2.text_id = $1`,
      textId
    );

    const withChain = (await prisma.passage.findMany({
      where: { textId },
      select: { metadata: true },
    })).filter((p) => ((p.metadata as { narrators?: string[] }).narrators ?? []).length > 0).length;

    console.log(`  recorded at least one transmitter on: ${withChain.toLocaleString()} of ${passages.length.toLocaleString()}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  const { prisma } = await import('../src/services/passage');
  await prisma.$disconnect();
  process.exit(1);
});
