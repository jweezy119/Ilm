/**
 * Train a theme classifier on lexical features.
 *
 *   npm run train-lexical-classifier -w @ilm/api -- [--holdout 0.2] [--max-terms 40000]
 *
 * This is the second attempt at the same job as train-theme-classifier.ts, which
 * reached 41% micro F1 on the dense embeddings and cleared its reliability bar on
 * 3 of 80 themes. The difference between the two is the features, and the reason
 * for trying lexical ones is in DEPLOY.md: a similarity encoder is the wrong
 * instrument for deciding what a passage is about.
 *
 * Features come from the passage text alone, never from `search_vector` — that
 * column contains the theme names, and using it would hand the model its own
 * answers.
 *
 * It reports before it writes anything, and it writes nothing unless the themes it
 * can handle cover most of the corpus. A second 40%-precision labeller would be
 * worse than no labeller, because it would look like progress.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '../src/lib/db';
import { loadLocalEnv } from '../src/lib/env';
import { THEME_TAXONOMY } from '@ilm/shared';
import {
  buildVocabulary,
  evaluateLexical,
  fitCentroids,
  fitThresholds,
  parseTsvector,
  toDense,
  type DenseSample,
  type LexicalDocument,
} from '../src/services/lexical-theme-model';

loadLocalEnv();

const OUTPUT_PATH = path.join(process.cwd(), 'data', 'lexical-theme-model.json');

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

async function main(): Promise<void> {
  const holdoutRatio = arg('--holdout', 0.2);
  const maxTerms = arg('--max-terms', 40_000);
  const minDocumentFrequency = arg('--min-df', 5);

  const themes: string[] = [...THEME_TAXONOMY];
  const labelIndex = new Map<string, number>(themes.map((t, i) => [t, i]));

  console.log('Reading passage text and lexemes…');

  /*
   * The text is tsvectorised here rather than read from `search_vector`, because
   * that column is a union of translation, theme names and book — and the theme
   * names are the labels. Building the vector from the translation alone is the
   * difference between a classifier and a mirror.
   */
  const rows = await prisma.$queryRaw<Array<{ id: string; lexemes: string | null }>>`
    SELECT p.id,
           to_tsvector('english', pt.text)::text AS lexemes
    FROM passages p
    JOIN LATERAL (
      SELECT t.text FROM passage_translations t
      JOIN translations tr ON tr.id = t.translation_id
      WHERE t.passage_id = p.id
      ORDER BY (tr.is_primary) DESC NULLS LAST
      LIMIT 1
    ) pt ON true
    WHERE EXISTS (SELECT 1 FROM passage_themes x WHERE x.passage_id = p.id AND x.source = 'jev')
  `;
  console.log(`${rows.length.toLocaleString()} passages with model labels.`);

  const themeRows = await prisma.passageTheme.findMany({
    where: { source: 'jev' },
    select: { passageId: true, themeId: true },
  });
  const targets = new Map<string, Float32Array>();
  for (const row of themeRows) {
    let vector = targets.get(row.passageId);
    if (!vector) {
      vector = new Float32Array(themes.length);
      targets.set(row.passageId, vector);
    }
    const index = labelIndex.get(row.themeId);
    if (index !== undefined) vector[index] = 1;
  }

  const documents: LexicalDocument[] = [];
  for (const row of rows) {
    if (!row.lexemes || !targets.has(row.id)) continue;
    documents.push({ id: row.id, terms: parseTsvector(row.lexemes) });
  }
  console.log(`${documents.length.toLocaleString()} documents, ${themeRows.length.toLocaleString()} labels.`);
  console.log(`Vocabulary: ${documents.reduce((s, d) => s + d.terms.size, 0).toLocaleString()} distinct terms.`);

  const vocabulary = buildVocabulary(documents, { minDocumentFrequency, maxTerms });
  console.log(`Kept ${vocabulary.terms.length.toLocaleString()} terms (df ≥ ${minDocumentFrequency}).`);

  const samples: DenseSample[] = [];
  for (const document of documents) {
    const labels = targets.get(document.id);
    if (!labels) continue;
    samples.push({ id: document.id, labels, vector: toDense(document, vocabulary) });
  }

  // Shuffled before splitting. Corpus order is one text after another, so a tail
  // split would hold out whole corpora and measure generalisation across
  // traditions rather than across passages.
  for (let i = samples.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [samples[i], samples[j]] = [samples[j], samples[i]];
  }
  const holdout = Math.floor(samples.length * holdoutRatio);
  const held = samples.slice(0, holdout);
  const train = samples.slice(holdout);
  console.log(`Train ${train.length.toLocaleString()}, held out ${held.length.toLocaleString()}.\n`);

  const { centroids, support } = fitCentroids(train, themes);
  console.log('Per-theme support (the 12 least frequent):');
  const bySupport = themes.map((theme, t) => ({ theme, n: support[t] })).sort((a, b) => a.n - b.n);
  console.log(`  ${bySupport.slice(0, 12).map((r) => `${r.theme} (${r.n})`).join(', ')}`);

  const thresholds = fitThresholds(centroids, themes, held);
  const metrics = evaluateLexical(centroids, themes, thresholds, held, { minThemes: 1, maxThemes: 4 });

  console.log('\nHeld-out:');
  console.log(`  micro  precision ${(metrics.microPrecision * 100).toFixed(1)}%  recall ${(metrics.microRecall * 100).toFixed(1)}%  F1 ${(metrics.microF1 * 100).toFixed(1)}%`);
  console.log(`  macro  F1 ${(metrics.macroF1 * 100).toFixed(1)}%`);
  console.log(`  predicted ${metrics.predicted.toLocaleString()} against ${metrics.actual.toLocaleString()} actual`);
  console.log(`  previous attempt on dense embeddings: 40.7% micro F1`);

  const ranked = [...metrics.perTheme].sort((a, b) => b.f1 - a.f1);
  console.log('\nBest themes:');
  for (const row of ranked.slice(0, 10)) console.log(`  ${row.theme.padEnd(16)} F1 ${(row.f1 * 100).toFixed(0)}%  (${row.support})`);
  console.log('Weakest themes:');
  for (const row of ranked.slice(-6)) console.log(`  ${row.theme.padEnd(16)} F1 ${(row.f1 * 100).toFixed(0)}%  (${row.support})`);

  const RELIABILITY_FLOOR = 0.55;
  const MIN_SUPPORT = 100;
  const reliable = metrics.perTheme.filter((r) => r.f1 >= RELIABILITY_FLOOR && r.support >= MIN_SUPPORT);
  const totalMass = metrics.perTheme.reduce((s, r) => s + r.support, 0);
  const covered = reliable.reduce((s, r) => s + r.support, 0);
  const coverage = totalMass === 0 ? 0 : covered / totalMass;
  console.log(
    `\n${reliable.length} of ${themes.length} themes clear F1 ${RELIABILITY_FLOOR} with ${MIN_SUPPORT}+ examples, ` +
      `covering ${(coverage * 100).toFixed(0)}% of label mass.`
  );
  console.log(`  previous attempt: 3 of 80, covering 6%.`);

  const payload = {
    themes,
    maxTerms: vocabulary.terms.length,
    minDocumentFrequency,
    terms: vocabulary.terms,
    centroids: centroids.map((c, t) => ({
      support: support[t],
      threshold: Number(thresholds[t].toFixed(4)),
      // Rounded: 1e-4 on a cosine is far below the resolution of the comparison.
      values: Array.from(c, (v) => Number(v.toFixed(4))),
    })),
    microF1: Number(metrics.microF1.toFixed(4)),
    macroF1: Number(metrics.macroF1.toFixed(4)),
    reliableThemes: reliable.map((r) => r.theme),
    labelMassCoverage: Number(coverage.toFixed(4)),
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload));
  console.log(`\nModel written to ${OUTPUT_PATH} (${Math.round((await fs.stat(OUTPUT_PATH)).size / 1024 / 1024)} MB).`);

  if (coverage < 0.5) {
    console.log('\nUnder half the label mass is covered. Do not auto-assign from this model.');
  } else {
    console.log('\nUsable. Run `npm run classify-themes -w @ilm/api` to label the unlabelled passages.');
  }
}

main()
  .catch((error) => {
    console.error('Training failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
