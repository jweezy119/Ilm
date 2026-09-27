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
import { TextId, Passage } from '@ilm/shared';
import { loadLocalEnv } from '../src/lib/env';
import { prisma, setPassageThemesBatch } from '../src/services/passage';
import { classifyThemes, scoreSemanticDensity } from '../src/services/typesafe';
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
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const themesArg = value('--themes');
  const only = (value('--only') ?? '').split(',').filter((t): t is TextId => ['quran', 'torah', 'talmud', 'ot', 'nt'].includes(t));

  return {
    themes: themesArg ? Number(themesArg) : null,
    crossrefs: args.includes('--crossrefs'),
    only,
    skipEmbeddings: args.includes('--skip-embeddings'),
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

    let done = 0;
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

      const scored = await Promise.all(
        batch.map(async (row) => {
          const passage = toPassage(row);
          // Density is a property of the passage, not of a theme, so it is
          // stored on the passage and reused by search ranking.
          const [themes, density] = await Promise.all([classifyThemes(passage, 5), scoreSemanticDensity(passage)]);

          if (density !== null) {
            await prisma.passage.update({
              where: { id: row.id },
              data: { metadata: { ...(typeof row.metadata === 'object' && row.metadata ? row.metadata : {}), density } },
            });
          }

          return { passageId: row.id, themes };
        })
      );
      await setPassageThemesBatch(scored);

      cursor = rows[rows.length - 1].id;
      done += batch.length;
      process.stdout.write(`  ${done}/${take ?? total}\r`);

      // Jev is billed per request; pace so a full corpus does not trip rate limits.
      if (jev.available) await sleep(250);
    }

    process.stdout.write('\n');
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
