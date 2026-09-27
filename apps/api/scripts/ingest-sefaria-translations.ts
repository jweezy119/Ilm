/**
 * Alternate translations for the Sefaria-sourced corpora: OT, Torah, Talmud.
 *
 * These three were ingested from a single Sefaria response each, so every passage
 * has exactly one English translation. Sefaria carries many more — 14 for Psalms,
 * 41 for Genesis, 12 for the Mishnah — so this attaches a second and third reading
 * to each.
 *
 * ## Why `ven` and not `version`
 *
 * The Texts API takes `ven` for the English version and `vhe` for the Hebrew one.
 * Passing `version=`, which is the obvious guess, is silently ignored and returns
 * the default text every time — which is how this went unnoticed at first.
 *
 * ## Version availability varies by book
 *
 * A title that exists for Genesis is not necessarily digitised for Psalms, so the
 * available titles are read from each book's own `versions` array and the targets
 * are matched against that. A book with no match is reported, not assumed.
 *
 * ## Update-only
 *
 * The loop is driven by the chapters and verses we already have. Sefaria's
 * Mishnah starts at chapter 2, for instance, and a passage with no primary
 * translation would be worse than a missing alternate.
 *
 *   npx tsx --env-file=.env scripts/ingest-sefaria-translations.ts
 *   npx tsx --env-file=.env scripts/ingest-sefaria-translations.ts --text torah
 *   npx tsx --env-file=.env scripts/ingest-sefaria-translations.ts --dry-run
 */

import { prisma } from '../src/services/passage';
import { stripSefariaHtml } from '../src/services/sefaria';
import { loadLocalEnv } from '../src/lib/env';

loadLocalEnv();

const SEFARIA_API = 'https://www.sefaria.org/api';

/** Sefaria tolerates a steady request; 1.2s is what it sustains. */
const REQUEST_DELAY_MS = 1200;

/**
 * Translations to add, per corpus.
 *
 * Matched by substring against the titles Sefaria reports, because titles carry
 * publishers and dates ("The Five Books of Moses, by Everett Fox. New York:
 * Schocken Books, 1995") that must be given exactly.
 *
 * JPS 1917 and the Sefaria Community Translation are chosen because they are
 * Public Domain and CC0 respectively, so they carry no redistribution condition.
 * The licence Sefaria reports for each is recorded on the translation row.
 */
const TARGET_VERSIONS: Record<'ot' | 'torah' | 'talmud', string[]> = {
  ot: ['The Holy Scriptures: A New Translation (JPS 1917)', 'The Koren Jerusalem Bible'],
  torah: ['The Holy Scriptures: A New Translation (JPS 1917)', 'The Koren Jerusalem Bible'],
  talmud: ['Sefaria Community Translation', 'Tractate Berakot by A. Cohen'],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson<T>(url: string, label: string, attempts = 4): Promise<T | null> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'ilm-ingest/1.0 (comparative text research)' },
        signal: AbortSignal.timeout(45_000),
      });

      if (response.status === 429) {
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

interface SefariaVersion {
  language?: string;
  versionTitle?: string;
  license?: string;
  versionSource?: string;
}

interface SefariaChapter {
  text?: unknown;
  he?: unknown[];
  versions?: SefariaVersion[];
  versionTitle?: string;
}

/** Sefaria's title for a book of ours. It resolves "I Samuel" but not "1 Samuel". */
const SEFARIA_TITLES: Record<string, string> = {
  '1 Samuel': 'I Samuel',
  '2 Samuel': 'II Samuel',
  '1 Kings': 'I Kings',
  '2 Kings': 'II Kings',
  '1 Chronicles': 'I Chronicles',
  '2 Chronicles': 'II Chronicles',
};

/**
 * Correct a translation that was named after a tradition rather than after the text.
 *
 * The Talmud was ingested without `ven`, so it received Sefaria's default English,
 * which is the William Davidson Edition. It was stored as "Soncino (Sefaria)" —
 * which told readers they were reading Soncino when they were not. The text is
 * correct; only the label was wrong, so this renames it and records the licence
 * Sefaria reports for that version.
 */
async function correctMislabelledTranslations(dryRun: boolean): Promise<void> {
  const wrong = await prisma.translation.findMany({ where: { textId: 'talmud', name: 'Soncino (Sefaria)' } });
  if (wrong.length === 0) return;

  const correctName = 'William Davidson Edition - English';

  if (dryRun) {
    console.log(`  would rename "Soncino (Sefaria)" -> "${correctName}" (${wrong.length} row)`);
    return;
  }

  await prisma.$transaction(
    wrong.map((t) =>
      prisma.translation.update({
        where: { id: t.id },
        data: { name: correctName, translator: 'William Davidson (Sefaria)', license: 'CC-BY-NC' },
      })
    )
  );
  console.log(`  renamed "Soncino (Sefaria)" -> "${correctName}" (${wrong.length} row)`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlyText = args.find((a) => a.startsWith('--text='))?.split('=')[1] ?? args[args.indexOf('--text') + 1];
  const dryRun = args.includes('--dry-run');
  const texts = (['ot', 'torah', 'talmud'] as const).filter((t) => !onlyText || t === onlyText);

  console.log('📖 Sefaria translations — OT, Torah, Talmud');
  console.log(`   ${dryRun ? 'DRY RUN: nothing written.' : 'Update-only: attaches to verses that already exist.'}\n`);

  console.log('Label corrections:');
  await correctMislabelledTranslations(dryRun);

  for (const textId of texts) {
    const books = await prisma.book.findMany({
      where: { textId },
      orderBy: { order: 'asc' },
      select: { bookId: true },
    });
    const targets = TARGET_VERSIONS[textId];

    console.log(`\n── ${textId}: ${books.length} books, looking for ${targets.length} versions`);

    let attached = 0;
    let noVersion = 0;
    let noVerse = 0;
    const unavailable = new Map<string, number>();

    for (const book of books) {
      const title = SEFARIA_TITLES[book.bookId] ?? book.bookId;
      const chapters = await prisma.passage.findMany({
        where: { textId, bookSlug: book.bookId },
        select: { chapterNum: true },
        distinct: ['chapterNum'],
        orderBy: { chapterNum: 'asc' },
      });
      if (chapters.length === 0) continue;

      // Which of our targets does Sefaria actually hold for this book? Read from
      // the book rather than assumed, because digitisation varies book by book.
      //
      // Several chapters are tried because the first can legitimately be empty:
      // the Mishnah's text starts at chapter 2, so a probe of Berakhot 1 returns
      // neither text nor a version list, and concluding "no versions" from that
      // would silently skip all 38 tractates.
      let available: SefariaVersion[] = [];
      for (const { chapterNum } of chapters.slice(0, 3)) {
        const probe = await getJson<SefariaChapter>(
          `${SEFARIA_API}/texts/${encodeURIComponent(`${title}.${chapterNum}`)}?context=0&commentary=0&pad=0`,
          `${textId} ${title} ${chapterNum} probe`
        );
        available = (probe?.versions ?? []).filter((v) => v.language === 'en' && v.versionTitle);
        if (available.length > 0) break;
        await sleep(REQUEST_DELAY_MS);
      }
      const matched = targets
        .map((target) => {
          const hit = available.find((v) => v.versionTitle?.toLowerCase().includes(target.toLowerCase()));
          return hit ? { target, title: hit.versionTitle as string, license: hit.license ?? null } : null;
        })
        .filter((m): m is { target: string; title: string; license: string | null } => m !== null);

      for (const target of targets) {
        if (!matched.some((m) => m.target === target)) {
          unavailable.set(target, (unavailable.get(target) ?? 0) + 1);
        }
      }
      if (matched.length === 0) {
        noVersion += 1;
        continue;
      }

      for (const version of matched) {
        for (const { chapterNum } of chapters) {
          const ref = `${title}.${chapterNum}`;
          const data = await getJson<SefariaChapter>(
            `${SEFARIA_API}/texts/${encodeURIComponent(ref)}` +
              `?ven=${encodeURIComponent(version.title)}&context=0&commentary=0&pad=0&stripItags=1`,
            `${textId} ${ref} ${version.target}`
          );
          const english = Array.isArray(data?.text) ? (data.text as unknown[]) : [];
          if (english.length === 0) {
            noVerse += 1;
            await sleep(REQUEST_DELAY_MS);
            continue;
          }

          const existing = await prisma.passage.findMany({
            where: { textId, bookSlug: book.bookId, chapterNum },
            select: { id: true, verseNum: true, primaryTranslation: true },
            orderBy: { verseNum: 'asc' },
          });

          const rows = existing
            .map((p) => ({ id: p.id, text: stripSefariaHtml(english[p.verseNum - 1]) }))
            // Identical to the primary is not an alternative; the API hides those,
            // so attaching them would only bloat the table.
            .filter((r) => r.text.length > 0 && r.text !== existing.find((p) => p.id === r.id)?.primaryTranslation.trim());

          if (rows.length > 0 && !dryRun) attached += await attach(textId, version.title, version.license, rows);
          await sleep(REQUEST_DELAY_MS);
        }
      }
    }

    console.log(`   attached: ${attached}`);
    if (unavailable.size > 0) {
      for (const [target, books_] of unavailable) console.log(`   "${target}" not held for ${books_} books`);
    }
    if (noVersion > 0) console.log(`   books with no matching version: ${noVersion}`);
    console.log(`   chapters with no text in some version: ${noVerse}`);
  }
}

async function attach(textId: string, name: string, license: string | null, rows: Array<{ id: string; text: string }>): Promise<number> {
  const translation = await prisma.translation.upsert({
    where: { textId_name_language: { textId, name, language: 'english' } },
    create: { textId, name, language: 'english', translator: name, license, isPrimary: false },
    update: { license },
  });

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

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('\n❌ Failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
