/**
 * Fill the embeddings column.
 *
 * Every one of the 45,453 passages shipped with an empty vector, which meant
 * `embeddingSimilarity` was structurally always zero and the closest-relations
 * ranking had one of its three inputs silently doing nothing.
 *
 * The vector is taken from the English translation, with the original-language text
 * appended when there is one. English is the shared language across all five corpora,
 * so this is what makes two passages from different traditions comparable; the
 * measured limit is that it reflects shared wording at least as much as shared
 * doctrine, and that it does not translate Hebrew into English (see embeddings.ts).
 *
 * Runs locally by default. Set OPENROUTER_API_KEY or OPENAI_API_KEY to use a hosted
 * model instead, or EMBEDDING_PROVIDER=local to force the local one.
 *
 *   npx tsx --env-file=.env scripts/embed.ts
 *   npx tsx --env-file=.env scripts/embed.ts --limit 500
 *   npx tsx --env-file=.env scripts/embed.ts --dry-run
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../src/services/passage';
import { embedMissingPassages, getEmbeddingConfig, generateEmbeddings } from '../src/services/embeddings';
import { loadLocalEnv } from '../src/lib/env';

loadLocalEnv();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;

  const config = getEmbeddingConfig();
  if (!config) {
    console.log('No embedding provider configured.');
    console.log('  Local (no key, runs on CPU):  EMBEDDING_PROVIDER=local npx tsx scripts/embed.ts');
    console.log('  Hosted:                      set OPENROUTER_API_KEY or OPENAI_API_KEY');
    return;
  }

  // Every way a passage can be un-embedded, and all three are needed. A passage
  // that has never been embedded holds DbNull, and Prisma's `equals` does not
  // match it: without that arm the count reads 0 to go on a completely
  // un-embedded corpus and the backfill exits having done nothing. Verified by
  // setting one passage to DbNull — the old query reported 0 to go, the
  // corrected one reported 1.
  const remaining = await prisma.passage.count({
    where: {
      OR: [
        { embeddings: { equals: Prisma.DbNull } },
        { embeddings: { equals: '[]' } },
        { embeddings: { equals: [] } },
      ],
    },
  });
  const total = await prisma.passage.count();
  const embedded = total - remaining;

  console.log(`🔢 Embeddings — ${config.provider} (${config.model})`);
  console.log(`   ${embedded}/${total} passages already have a vector; ${remaining} to go.`);
  if (dryRun) {
    console.log('\nDRY RUN: nothing written.');
    return;
  }

  const startedAt = Date.now();
  let done = 0;
  let lastReport = Date.now();

  while (done < limit) {
    const batch = Math.min(200, limit - done);
    const written = await embedMissingPassages(batch);
    if (written === 0) break;
    done += written;

    if (Date.now() - lastReport > 15_000) {
      // `rate` is per second, so the per-minute figure is rate * 60.
      const perSecond = done / ((Date.now() - startedAt) / 1000);
      const perMinute = perSecond * 60;
      const left = Math.max(0, remaining - done);
      const minutesLeft = perSecond > 0 ? Math.ceil(left / perSecond / 60) : 0;
      process.stdout.write(`  ${embedded + done}/${total} (${perMinute.toFixed(0)}/min, ~${minutesLeft} min left)\r`);
      lastReport = Date.now();
    }

    // The local model is CPU-bound; a pause keeps a backfill from starving the API
    // that shares the process.
    await sleep(50);
  }

  process.stdout.write('\n');

  // A spot check, because a full column of identical or zero vectors is worse than
  // an empty one: it would look like real signal and be meaningless.
  // Prisma's `NOT` on a JSON column does not match an empty array, which sampled
  // every row including the un-embedded ones. The shape is checked in SQL instead.
  const sample = await prisma.$queryRaw<Array<{ passage_key: string; embeddings: number[] }>>`
    SELECT passage_key, embeddings FROM passages
    WHERE jsonb_typeof(embeddings) = 'array' AND jsonb_array_length(embeddings) > 0
    LIMIT 3
  `;
  for (const row of sample) {
    const vector = Array.isArray(row.embeddings) ? row.embeddings : [];
    console.log(`  ${row.passage_key}: ${vector.length} dims, first=${vector[0]?.toFixed(4)}`);
  }

  console.log(`\n✅ embedded ${done} passages in ${((Date.now() - startedAt) / 1000 / 60).toFixed(1)} min`);
  console.log('Note: the Orama search index does not use embeddings, so it needs no rebuild.');
  console.log('      Closest-relations ranking picks them up on the next request.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('\n❌ Failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
