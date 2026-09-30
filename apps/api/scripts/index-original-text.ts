/**
 * Index the original-language text for search.
 *
 *   npm run index-original-text [-- --limit=5000] [-- --reindex]
 *
 * The corpus is 23% non-English by verse count and was entirely unsearchable in
 * its own script. `search_vector` is built with the 'english' configuration over
 * the English translation, so a reader searching الرحمن, מזמור or ηγαπησεν
 * matched nothing and was shown the empty state — which reads as "the corpus does
 * not discuss this", not "the app cannot search Arabic".
 *
 * Two things make this more than a second `to_tsvector`.
 *
 * **The text is normalised first.** The corpus is vocalised: ٱلرَّحْمَٰنِ is stored,
 * الرحمن is typed. `normalizeForSearch` strips the marks and folds the alef
 * family, and the *same function* runs on the query side in search/postgres.ts.
 * Two implementations would drift, and drift here is invisible — English keeps
 * working and every other script silently returns nothing.
 *
 * **The configuration is `simple`, not a language one.** There is no `hebrew`
 * configuration in this database, and stemming is actively harmful for Arabic: the
 * prefixes and suffixes carry the meaning, and a stemmer strips them.
 *
 * **Greek carries a second, stemmed vector, at a lower weight.** Every other script
 * is indexed by surface form alone. Greek is the one corpus where that loses
 * passages: θεός, θεοῦ, θεῷ, θεοί and θεῶν are five unrelated lexemes for one word,
 * and a reader who types one does not find the other four. Measured reach on the
 * Greek New Testament was 71% before this and the concept figure was 11%.
 *
 * The stems go in as *additional, lower-weighted* lexemes rather than replacing the
 * surface forms, and that is the whole design. Replacing them was tried and it cost
 * more than it gained: every passage containing ανθρωπ then competes for one lexeme,
 * so the passages that contain the word the reader actually typed get pushed out of
 * the page by passages that only contain a relative of it — ἀνθρωποι fell from 19 of
 * 27 to 7 of 27. Weight A for the surface form and weight D for the stem means an
 * exact hit outranks a stemmed one, so widening costs the reader nothing when the
 * exact form is present, and still finds the sibling forms when it is not.
 *
 * Stems are added for Greek only, and the query side stems its Greek tokens exactly
 * once. The algorithm is not idempotent — 39% of the corpus's tokens stem to
 * something that stems to something else — so an index or a query stemmed twice
 * would simply stop matching, which is a failure that looks exactly like a language
 * the app cannot search.
 *
 * Idempotent, and re-runnable. Pass --reindex to rebuild rows that already have a
 * vector, which is what a change to the normaliser requires.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../src/services/passage';
import { expandForIndex } from '../src/lib/script-normalize';
import { stemGreekTokens } from '../src/lib/greek-stem';
import { loadLocalEnv } from '../src/lib/env';

loadLocalEnv();

/**
 * Rows per statement.
 *
 * 500 balances a round trip against the size of a single UPDATE, and the same
 * reasoning as the batched quotation writes: one row per round trip turned a
 * four-minute job into ninety minutes.
 */
const BATCH = 500;

function parseArgs(argv: string[]) {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    limit: Number(value('--limit') ?? Number.POSITIVE_INFINITY),
    reindex: argv.includes('--reindex'),
  };
}

async function main(): Promise<void> {
  const { limit, reindex } = parseArgs(process.argv.slice(2));

  /*
   * Raw SQL throughout, because neither vector column is in schema.prisma.
   *
   * `search_vector` has never been declared on the model — it is added by
   * migration and only ever read through `$queryRaw` — and this follows the same
   * pattern rather than introducing a second convention. Prisma's client cannot
   * filter on `search_vector_original` at all, and a `Unsupported("tsvector")`
   * field would still not be selectable.
   */
   const needsWork = reindex
     ? Prisma.sql`original_text <> ''`
     : Prisma.sql`original_text <> '' AND search_vector_original IS NULL`;

  const [countRow] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint n FROM passages WHERE ${needsWork}`;
  const total = Number(countRow.n) > limit ? limit : Number(countRow.n);
  console.log(
    `Indexing original-language text — ${total.toLocaleString()} passages` +
      `${reindex ? ' (reindex: rows already indexed are rebuilt)' : ''}`
  );
  if (total === 0) {
    console.log('Nothing to do.');
    return;
  }

  const started = Date.now();
  let done = 0;

  /*
   * One read of the whole set, then batched writes.
   *
   * 6 MB of text in a single result is nothing next to the 45k round trips an
   * offset-paginated loop would cost over a pooled connection, and the text is
   * needed in memory anyway to normalise it.
   */
  const rows = await prisma.$queryRaw<Array<{ id: string; originalText: string }>>`
    SELECT id, original_text AS "originalText"
    FROM passages
    WHERE ${needsWork}
    LIMIT ${total}`;

  if (rows.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const batch = rows.slice(offset, offset + BATCH);

    /*
     * Written as a single UPDATE over a VALUES list rather than a loop.
     *
     * The parameter is the *normalised* text and the tsvector is built in the
     * database, so the text is not round-tripped back out as a vector literal.
     * `simple` is named here rather than relying on the column's default: a
     * tsvector built with the wrong configuration cannot be rebuilt without
     * dropping the column, so the choice is stated at the point it is made.
     */
    await prisma.$executeRaw`
      UPDATE passages AS p
      SET search_vector_original = v.tsv
      FROM (
        VALUES ${Prisma.join(
          batch.map(
            (row) =>
              Prisma.sql`(${row.id}::text, setweight(to_tsvector('simple', ${expandForIndex(row.originalText ?? '')}), 'A')
                || setweight(to_tsvector('simple', ${stemGreekTokens(expandForIndex(row.originalText ?? ''))}), 'D'))`
          ),
          ','
        )}
      ) AS v(id, tsv)
      WHERE p.id = v.id
    `;

    done += batch.length;
    if (done % (BATCH * 10) === 0 || done >= rows.length) {
      const rate = done / ((Date.now() - started) / 1000);
      console.log(`  ${done.toLocaleString()} / ${rows.length.toLocaleString()}  (${Math.round(rate)}/s)`);
    }
  }

  /*
   * The GIN index last, so it is built once over populated data rather than
   * maintained on every row of a backfill. ~20 MB for the 45k passages, against a
   * 460 MB database.
   */
  console.log('Creating the GIN index (once, over populated data)…');
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS passages_search_vector_original_idx
                                  ON passages USING gin (search_vector_original)`);

  const indexed = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint n FROM passages WHERE search_vector_original IS NOT NULL`;
  const size = await prisma.$queryRaw<Array<{ s: string }>>`
    SELECT pg_size_pretty(pg_relation_size('passages_search_vector_original_idx')) s`;

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`   rows indexed: ${indexed[0].n.toLocaleString()}`);
  console.log(`   index size:   ${size[0].s}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('\nOriginal-text indexing failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
