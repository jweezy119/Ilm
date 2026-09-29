/**
 * Validate the curated topics against the live corpus.
 *
 * The topic registry is hand-written, and nothing about a hand-written list of
 * database ids fails loudly. A theme that does not exist, or a phrase that
 * matches nothing, produces an empty result set and a page that looks broken.
 * The first draft of this registry contained two theme ids the corpus has never
 * used ('god' and 'truth') and nine facets matching fewer than twenty passages;
 * both were found by running the numbers, not by reading the file.
 *
 *   npx tsx scripts/validate-topics.ts
 *
 * Reads the corpus, writes nothing, and exits non-zero if anything is unusable.
 * Run it after re-ingesting, or after editing the registry.
 */

import { prisma } from '../src/services/passage';
import { TOPICS, MIN_PASSAGES, MIN_CORPORA } from '../src/services/topics';

/** A facet below this is a dead end rather than a question. */
const MIN_FACET_RESULTS = 20;

async function main(): Promise<void> {
  const known = new Set(
    (await prisma.passageTheme.findMany({ distinct: ['themeId'], select: { themeId: true } })).map((r) => r.themeId)
  );

  // One grouped query for the topic themes, and one count per facet phrase.
  // A dozen topics and forty-odd facets is small enough that separate statements
  // cost nothing, and separate statements are far easier to read than a
  // hand-rolled batch with a side table.
  const coverage = new Map(
    (
      await prisma.$queryRaw<Array<{ themeId: string; passages: bigint; corpora: string[]; books: bigint }>>`
        SELECT pt.theme_id AS "themeId",
               count(*)::bigint AS passages,
               array_agg(DISTINCT p.text_id) AS corpora,
               count(DISTINCT p.text_id || ':' || p.book_slug)::bigint AS books
        FROM passage_themes pt
        JOIN passages p ON p.id = pt.passage_id
        WHERE pt.theme_id = ANY(${[...new Set(TOPICS.map((t) => t.theme))]}::text[])
        GROUP BY pt.theme_id
      `
    ).map((row) => [row.themeId, row])
  );

  const problems: string[] = [];
  const summary: string[] = [];

  for (const topic of TOPICS) {
    const detail = coverage.get(topic.theme);

    if (!known.has(topic.theme)) {
      problems.push(`${topic.slug}: theme "${topic.theme}" is not in the corpus`);
      continue;
    }
    if (!detail) {
      problems.push(`${topic.slug}: theme "${topic.theme}" has no passages`);
      continue;
    }

    const passages = Number(detail.passages);
    const corpora = detail.corpora.length;

    if (passages < MIN_PASSAGES) {
      problems.push(`${topic.slug}: theme "${topic.theme}" has ${passages} passages, floor is ${MIN_PASSAGES}`);
    }
    if (corpora < MIN_CORPORA) {
      problems.push(`${topic.slug}: theme "${topic.theme}" spans ${corpora} corpora, floor is ${MIN_CORPORA}`);
    }

    const facetCounts: string[] = [];
    for (const facet of topic.facets) {
      const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM passages p
        WHERE p.search_vector @@ websearch_to_tsquery('english', ${facet.query})`;
      const results = Number(row.n);

      if (results < MIN_FACET_RESULTS) {
        problems.push(
          `${topic.slug}.${facet.id}: "${facet.query}" matches ${results} passages, floor is ${MIN_FACET_RESULTS}`
        );
      }
      for (const theme of facet.themes) {
        if (!known.has(theme)) {
          problems.push(`${topic.slug}.${facet.id}: scope theme "${theme}" is not in the corpus`);
        }
      }
      facetCounts.push(`${facet.id}=${results}`);
    }

    summary.push(
      `${topic.slug.padEnd(15)} ${String(passages).padStart(6)} passages  ${String(corpora)} corpora  ` +
        `${String(Number(detail.books)).padStart(4)} books  |  ${facetCounts.join(' ')}`
    );
  }

  console.log(summary.join('\n'));
  console.log(`\n${TOPICS.length} topics, ${TOPICS.reduce((n, t) => n + t.facets.length, 0)} facets checked`);

  if (problems.length > 0) {
    console.error(`\n❌ ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`   ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log('✅ every topic clears the coverage floor and every facet returns results');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('validation failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
