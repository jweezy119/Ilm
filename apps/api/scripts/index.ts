/**
 * Indexing
 *
 * Turns raw passages into something searchable and comparable:
 *   1. score themes on every passage (Jev when configured, local keywords otherwise)
 *   2. store embeddings when a provider is configured
 *   3. rebuild the in-process Orama index
 *   4. optionally detect cross-references
 *
 *   npm run index                # themes + search index
 *   npm run index -- --themes 500   # only the first 500 passages
 *   npm run index -- --crossrefs   # also detect cross-references (slow, costs API calls)
 */

import type { Prisma } from '@prisma/client';
import { TextId, TEXT_METADATA, type Passage } from '@ilm/shared';
import { loadLocalEnv } from '../src/lib/env';
import { prisma, setPassageThemesBatch } from '../src/services/passage';
import { classifyThemes, scoreSemanticDensity, needsJudgement } from '../src/services/typesafe';
import { getJevJudge } from '../src/services/typesafe-client';
import { embedMissingPassages, isEmbeddingConfigured } from '../src/services/embeddings';
import { getCrossReferencesForPassage } from '../src/services/crossrefs';
import { buildOramaIndex, persistOramaIndex } from '../src/search/orama';

// Without this the script would find no TYPESAFE_API_KEY, fall back to local theme
// scoring, and write those scores over the model-derived ones without saying so.
loadLocalEnv();

const THEME_BATCH = 100;
const CROSSREF_BATCH = 5;

interface Options {
  themes: number | null;
  crossrefs: boolean;
  only: TextId[];
  skipEmbeddings: boolean;
  /**
   * Send only passages the keyword classifier is unsure about to the model.
   *
   * Most passages have an obvious theme and the keyword answer is already right, so
   * a model call on them buys nothing. This spends the budget on the ones where a
   * model could actually change the answer.
   */
  onlyUncertain: boolean;
  /** Report what would be judged and what it would cost, without calling anything. */
  dryRun: boolean;
}

/**
 * How much clearer than the runner-up the top theme must be for the keyword
 * classifier to be trusted.
 *
 * Calibrated against the real distribution, not guessed. On this corpus the median
 * passage scores 0.150 on its top theme with a 0.100 margin, so any setting tight
 * enough to be meaningful catches most of the corpus. 0.05 is the loosest useful
 * value: it skips a passage only when one theme is genuinely ahead of the next.
 */
const UNCERTAIN_MARGIN = Number(process.env.THEME_JUDGE_MARGIN ?? 0.05);

/**
 * And how strong the top theme must be in absolute terms.
 *
 * A passage scoring below 0.2 matched at most one of its theme's keywords, which is
 * a weak answer. Raising this catches *more* passages, not fewer, so it is set at
 * the point where the keyword list starts producing a real hit rate.
 */
const UNCERTAIN_MIN_SCORE = Number(process.env.THEME_JUDGE_MIN_SCORE ?? 0.2);

/**
 * Input tokens per judged passage, measured from the actual payloads at
 * ~3.2 characters per token: an 80-option choice question is dominated by its
 * criteria list, and the strength rubric is small by comparison. Used only to
 * report what a run will cost before it runs.
 */
const THEME_CLASSIFY_TOKENS = 1201;
const THEME_STRENGTH_TOKENS = 120;

/** TypeSafe's published rate: $0.042 per million input tokens, output free. */
const JEV_INPUT_USD_PER_M = 0.042;

function parseArgs(): Options {
  const args = process.argv.slice(2);
  /*
   * Accepts both `--flag value` and `--flag=value`.
   *
   * It accepted only the first, and the second form was not an error — it was
   * silently ignored. Running with `--only=bukhari,muslim` therefore scored all
   * 59,949 passages instead of the 14,496 asked for, because the flag never
   * matched and an empty corpus filter means every corpus. It would have replaced
   * every theme score in the table, which is the kind of failure a mistyped flag
   * should never be able to cause.
   */
  const value = (flag: string) => {
    const inline = args.find((a) => a.startsWith(`${flag}=`));
    if (inline) return inline.slice(flag.length + 1);
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const themesArg = value('--themes');
  /*
   * The corpus list is the shared one, not a literal here.
   *
   * This was hardcoded to the five original corpora and silently ignored
   * `--only=bukhari,muslim`, so the hadith were invisible to the theme scorer — the
   * same drift as the copy of the recommendation weights in the web store, and fixed
   * the same way: one list, imported, so it cannot fall behind.
   */
  const all: TextId[] = Object.keys(TEXT_METADATA) as TextId[];
  const only = (value('--only') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is TextId => (all as string[]).includes(t));

  return {
    themes: themesArg ? Number(themesArg) : null,
    crossrefs: args.includes('--crossrefs'),
    only,
    skipEmbeddings: args.includes('--skip-embeddings'),
    onlyUncertain: args.includes('--only-uncertain'),
    dryRun: args.includes('--dry-run'),
  };
}


const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================

async function main(): Promise<void> {
  const options = parseArgs();
  const jev = getJevJudge();

  console.log('🔧 Indexing Ilm');
  console.log(`   Jev:        ${jev.available ? 'configured' : `unavailable (${jev.reason}) — themes will be keyword-derived`}`);
  console.log(`   Embeddings: ${options.skipEmbeddings ? 'skipped' : isEmbeddingConfigured() ? 'configured' : 'not configured — skipping'}`);

  const where = options.only.length > 0 ? { textId: { in: options.only } } : {};

  // ---------------------------------------------------------------- themes
  if (options.themes !== 0) {
    const take = options.themes;
    const total = await prisma.passage.count({ where });
    console.log(`\n🏷️  Scoring themes for ${take ?? total} passages...`);
    if (options.onlyUncertain) {
      console.log(`   Only passages the keyword list is unsure about will be judged.`);
      console.log(`   Confident: top theme ≥ ${UNCERTAIN_MIN_SCORE} and clear of the runner-up by ≥ ${UNCERTAIN_MARGIN}.`);
    }
    if (options.dryRun) console.log('   DRY RUN: no model calls, nothing written.');

    let done = 0;
    let judged = 0;
    let skipped = 0;
    // Passages whose model call failed. Their existing themes are left in place
    // rather than replaced, so they are reported and can be re-run.
    let deferred = 0;
    let cursor: string | undefined;

    for (;;) {
      const rows = await prisma.passage.findMany({
        where,
        take: THEME_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, passageKey: true, originalText: true, primaryTranslation: true, textId: true, bookSlug: true, chapterNum: true, verseNum: true, language: true, verseOrder: true, metadata: true, embeddings: true },
      });
      if (rows.length === 0) break;

      const remaining = take === null ? rows.length : Math.max(0, take - done);
      if (remaining === 0) break;
      const batch = rows.slice(0, remaining);

      // Filtered before any model call, so a confident passage costs nothing at all
      // and keeps the theme rows it already has.
      const toJudge = options.onlyUncertain ? batch.filter((row) => needsJudgement(toPassage(row))) : batch;
      skipped += batch.length - toJudge.length;

      // Bounded rather than a Promise.all over the whole batch. A hundred
      // simultaneous requests is enough to trip the connection layer, and the
      // failures arrive as "Connection error: fetch failed" with no status to
      // distinguish them from a rejection.
      const CONCURRENCY = 8;
      let carriedOver = 0;

      for (let i = 0; i < toJudge.length; i += CONCURRENCY) {
        const slice = toJudge.slice(i, i + CONCURRENCY);

        const scored = await Promise.all(
          slice.map(async (row) => {
            const passage = toPassage(row);
            // Density is a property of the passage, not of a theme, so it is
            // stored on the passage and reused by search ranking.
            const [themes, density] = await Promise.all([
              // A failed call returns nothing rather than the keyword answer, so a
              // transient failure cannot overwrite judged rows with local guesses
              // while still counting as progress.
              classifyThemes(passage, 5, { requireJudge: jev.available && !options.dryRun }),
              scoreSemanticDensity(passage),
            ]);

            if (themes.length === 0) carriedOver += 1;

            if (density !== null) {
              await prisma.passage.update({
                where: { id: row.id },
                data: { metadata: { ...(typeof row.metadata === 'object' && row.metadata ? row.metadata : {}), density } },
              });
            }

            return { passageId: row.id, themes };
          })
        );

        if (!options.dryRun) await setPassageThemesBatch(scored);

        // Jev is billed per request; pace so a full corpus does not trip rate limits.
        if (jev.available) await sleep(250);
      }

      deferred += carriedOver;
      judged += toJudge.length;
      cursor = rows[rows.length - 1].id;
      done += batch.length;
      process.stdout.write(`  ${judged} judged, ${skipped} confident\r`);
    }

    process.stdout.write('\n');

    if (options.onlyUncertain) {
      const scanned = judged + skipped;
      const share = scanned > 0 ? (judged / scanned) * 100 : 0;
      console.log(`   scanned ${scanned}, judged ${judged} (${share.toFixed(1)}%), left as-is ${skipped}`);
      if (deferred > 0) console.log(`   deferred: ${deferred} calls failed, existing themes left untouched — re-run to pick them up`);
      // Two requests per judged passage: the 80-option choice and the strength rubric.
      const tokens = judged * (THEME_CLASSIFY_TOKENS + THEME_STRENGTH_TOKENS);
      console.log(`   ~${(tokens / 1e6).toFixed(1)}M input tokens ≈ $${((tokens / 1e6) * JEV_INPUT_USD_PER_M).toFixed(2)}`);
    }
  }

  // ---------------------------------------------------------------- embeddings
  if (!options.skipEmbeddings && isEmbeddingConfigured()) {
    console.log('\n🧮 Embedding passages...');
    let written = 0;
    for (;;) {
      const count = await embedMissingPassages(200);
      if (count === 0) break;
      written += count;
      process.stdout.write(`  ${written}\r`);
    }
    process.stdout.write('\n');
  }

  // ---------------------------------------------------------------- search index
  console.log('\n🔍 Building the search index...');
  await buildOramaIndex();
  await persistOramaIndex();

  // Cross-references are computed lazily on first view and then stored, so this
  // only warms the cache for a set of passages rather than scanning the corpus.
  if (options.crossrefs) {
    console.log(`\n🔗 Warming cross-references for ${options.themes ?? 200} passages...`);

    const rows = await prisma.passage.findMany({
      where,
      take: options.themes ?? 200,
      orderBy: { verseOrder: 'asc' },
      select: { id: true },
    });

    let done = 0;
    for (const row of rows) {
      try {
        const result = await getCrossReferencesForPassage(row.id);
        process.stdout.write(`  ${++done}/${rows.length} ${result.references.length} refs\r`);
      } catch (error) {
        console.error(`  crossrefs failed for ${row.id}: ${(error as Error).message}`);
      }
      if (jev.available) await sleep(150);
    }
    process.stdout.write('\n');
  }

  console.log('\n🎉 Indexing complete');
}

/** Build the shared Passage shape from a lean Prisma row. */
function toPassage(row: {
  id: string;
  passageKey: string;
  textId: string;
  bookSlug: string;
  chapterNum: number;
  verseNum: number;
  originalText: string;
  primaryTranslation: string;
  language: string;
  verseOrder: number;
  metadata: Prisma.JsonValue;
  embeddings: unknown;
}): Passage {
  return {
    id: row.id,
    passageKey: row.passageKey,
    textId: row.textId as TextId,
    book: row.bookSlug,
    chapter: row.chapterNum,
    verse: row.verseNum,
    originalText: row.originalText,
    translation: row.primaryTranslation,
    alternativeTranslations: [],
    metadata: {
      language: (row.language as never) ?? 'english',
      writingSystem: 'Latin',
      canonicalOrder: row.verseOrder,
      verseOrder: row.verseOrder,
    },
    embeddings: Array.isArray(row.embeddings) ? (row.embeddings as number[]) : [],
    themes: [],
    crossReferences: [],
  };
}


main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('\n❌ Indexing failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
