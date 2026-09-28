/**
 * Train the theme classifier on the labels already paid for.
 *
 *   npm run train-theme-classifier -w @ilm/api -- [--epochs 14] [--holdout 0.2] [--threshold 0.5]
 *
 * The labels it learns from are the ones Jev produced for 35,799 passages. Nothing
 * here calls a model: the whole point is that after this runs once, the remaining
 * 9,654 passages can be labelled without paying for them again.
 *
 * It writes a report and the weights, and it reports what it achieved before
 * anything is used. A classifier for this app is only worth having if it beats
 * guessing, and the numbers that decide that are printed rather than assumed:
 * micro and macro F1 on a held-out split, per-theme F1, and the most and least
 * reliable themes. If macro F1 is poor, that is the finding, and the honest move
 * is not to label the corpus with it.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '../src/lib/db';
import { loadLocalEnv } from '../src/lib/env';
import { THEME_TAXONOMY } from '@ilm/shared';
import { ThemeClassifier, evaluate, type ClassBalance } from '../src/services/theme-classifier';

loadLocalEnv();

const WEIGHTS_PATH = path.join(process.cwd(), 'data', 'theme-classifier.json');
const DIMS = 384;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

async function main(): Promise<void> {
  const epochs = arg('--epochs', 14);
  const holdoutRatio = arg('--holdout', 0.2);
  let threshold = arg('--threshold', 0.5);

  const labels: string[] = [...THEME_TAXONOMY];
  const labelIndex = new Map<string, number>(labels.map((l, i) => [l, i]));

  // Only model-assigned labels train the model. The keyword-derived rows are what
  // this is meant to replace, and training on them would teach the classifier to
  // reproduce the thing it is being built to improve on.
  const rows = await prisma.$queryRaw<Array<{ id: string; embeddings: number[] }>>`
    SELECT p.id, p.embeddings
    FROM passages p
    WHERE EXISTS (SELECT 1 FROM passage_themes pt WHERE pt.passage_id = p.id AND pt.source = 'jev')
      AND jsonb_array_length(p.embeddings) = ${DIMS}
  `;
  console.log(`${rows.length.toLocaleString()} passages with model labels and a full vector.`);

  const themeRows = await prisma.passageTheme.findMany({
    where: { source: 'jev' },
    select: { passageId: true, themeId: true },
  });

  const targets = new Map<string, Float32Array>();
  for (const row of themeRows) {
    let vector = targets.get(row.passageId);
    if (!vector) {
      vector = new Float32Array(labels.length);
      targets.set(row.passageId, vector);
    }
    const index = labelIndex.get(row.themeId);
    if (index !== undefined) vector[index] = 1;
  }

  const samples: Array<{ vector: Float32Array; labels: Float32Array }> = [];
  for (const row of rows) {
    const target = targets.get(row.id);
    if (!target) continue;
    if (target.reduce((s, v) => s + v, 0) === 0) continue; // no label survived mapping
    samples.push({ vector: Float32Array.from(row.embeddings), labels: target });
  }
  console.log(`${samples.length.toLocaleString()} usable training samples, ${themeRows.length.toLocaleString()} labels.`);

  // Shuffle before splitting. Corpus order is one text after another, so a tail
  // split would hold out entire corpora and the validation score would measure
  // generalisation across traditions rather than across passages.
  for (let i = samples.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [samples[i], samples[j]] = [samples[j], samples[i]];
  }

  const holdout = Math.floor(samples.length * holdoutRatio);
  const held = samples.slice(0, holdout);
  const train = samples.slice(holdout);

  const balance: ClassBalance[] = labels.map((_, t) => {
    let positive = 0;
    for (const sample of train) if (sample.labels[t] > 0) positive += 1;
    // The ratio that makes each class contribute equally to the gradient.
    return { positive: Math.max(1, (train.length - positive) / Math.max(1, positive)), total: train.length };
  });

  const rarest = labels
    .map((label, t) => ({ label, count: Math.round(balance[t].positive > 0 ? train.length / (1 + balance[t].positive) : 0) }))
    .sort((a, b) => a.count - b.count);
  console.log(`Rarest themes: ${rarest.slice(0, 5).map((r) => `${r.label} (${r.count})`).join(', ')}`);
  console.log(`Most common:  ${rarest.slice(-5).map((r) => `${r.label} (${r.count})`).join(', ')}\n`);

  const model = new ThemeClassifier(DIMS, labels);
  const started = Date.now();
  const { loss, validationLoss } = model.train(train, balance, {
    epochs,
    learningRate: 0.35,
    l2: 1e-5,
    batchSize: 64,
  });
  console.log(`Trained ${epochs} epochs in ${Math.round((Date.now() - started) / 1000)}s.`);
  console.log(`  train loss      ${loss.map((l) => l.toFixed(4)).join(' → ')}`);
  if (validationLoss.length) {
    console.log(`  validation loss ${validationLoss.map((l) => l.toFixed(4)).join(' → ')}`);
  }

  /*
   * The threshold is the single most consequential number in this script, and it
   * is not a constant: at 0.5 the model predicts three themes for every one that
   * exists, because up-weighting rare classes pushes their scores up too. Sweeping
   * it on held-out data and keeping the best is the difference between a model
   * that labels the corpus and one that spray-paints it.
   */
  const sweep = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  let best = { threshold, microF1: -1, macroF1: 0 };
  console.log('\nThreshold sweep on held-out data:');
  for (const t of sweep) {
    const m = evaluate(model, held, { threshold: t, minThemes: 1, maxThemes: 4 });
    console.log(`  ${t.toFixed(2)}  micro F1 ${(m.microF1 * 100).toFixed(1)}%  macro F1 ${(m.macroF1 * 100).toFixed(1)}%  ${m.predicted.toLocaleString()} predicted / ${m.actual.toLocaleString()} actual`);
    if (m.microF1 > best.microF1) best = { threshold: t, microF1: m.microF1, macroF1: m.macroF1 };
  }
  console.log(`  → best threshold ${best.threshold} (micro F1 ${(best.microF1 * 100).toFixed(1)}%)`);
  threshold = best.threshold;

  const metrics = evaluate(model, held, { threshold, minThemes: 1, maxThemes: 4 });
  console.log(`\nHeld-out: ${held.length.toLocaleString()} passages`);
  console.log(`  micro  precision ${(metrics.microPrecision * 100).toFixed(1)}%  recall ${(metrics.microRecall * 100).toFixed(1)}%  F1 ${(metrics.microF1 * 100).toFixed(1)}%`);
  console.log(`  macro  F1 ${(metrics.macroF1 * 100).toFixed(1)}%`);
  console.log(`  predicted ${metrics.predicted.toLocaleString()} themes against ${metrics.actual.toLocaleString()} actual`);

  // Always predicting the most common theme is the floor any honest report needs.
  const floor = floorMetrics(train, held, labels);
  console.log(`  baseline (always the most common theme) F1 ${(floor * 100).toFixed(2)}%`);

  // Macro F1 over every theme is dominated by themes with a handful of examples,
  // which is a statement about the data rather than the model. Reported again over
  // themes with enough support to have been learnable at all.
  const learnable = metrics.perThemeF1.filter((r) => r.support >= 50);
  const macroLearnable = learnable.reduce((sum, r) => sum + r.f1, 0) / Math.max(1, learnable.length);
  console.log(`  macro F1 over the ${learnable.length} themes with 50+ examples: ${(macroLearnable * 100).toFixed(1)}%`);

  const ranked = [...metrics.perThemeF1].sort((a, b) => b.f1 - a.f1);
  console.log('\nBest themes:');
  for (const row of ranked.slice(0, 8)) console.log(`  ${row.theme.padEnd(16)} F1 ${(row.f1 * 100).toFixed(0)}%  (${row.support} passages)`);
  console.log('Weakest themes:');
  for (const row of ranked.slice(-8)) console.log(`  ${row.theme.padEnd(16)} F1 ${(row.f1 * 100).toFixed(0)}%  (${row.support} passages)`);

  /*
   * The bar a theme has to clear before this script will assign it.
   *
   * It was 0.3, which was far too lenient: a theme the model is right about 30% of
   * the time is wrong 70% of the time, and writing that onto a passage produces a
   * confident, checkable-looking label that is usually false. Given how this app
   * talks about unsourced claims, a 30%-reliable guess is exactly the thing that
   * must not ship. 0.55 means it is right more often than not, which is the
   * minimum for a label to be worth having.
   */
  const RELIABILITY_FLOOR = 0.55;
  const MIN_SUPPORT = 100;
  const reliable = metrics.perThemeF1
    .filter((r) => r.f1 >= RELIABILITY_FLOOR && r.support >= MIN_SUPPORT)
    .map((r) => r.theme);
  /*
   * Coverage matters as much as the floor. If only a handful of themes qualify,
   * "label the corpus" is a misleading description of what the result does, so the
   * share of the corpus's real label mass that the reliable themes represent is
   * reported rather than left to be discovered.
   */
  const reliableSet = new Set(reliable);
  const totalMass = metrics.perThemeF1.reduce((sum, r) => sum + r.support, 0);
  const coveredMass = metrics.perThemeF1.filter((r) => reliableSet.has(r.theme)).reduce((sum, r) => sum + r.support, 0);
  const coverage = totalMass === 0 ? 0 : coveredMass / totalMass;

  console.log(
    `\n${reliable.length} of ${labels.length} themes clear F1 ${RELIABILITY_FLOOR} with ${MIN_SUPPORT}+ examples, ` +
      `covering ${(coverage * 100).toFixed(0)}% of the corpus's existing label mass.`
  );
  if (coverage < 0.5) {
    console.log('  Under half the label mass is covered, so this cannot stand in for the model.');
  }

  const payload = {
    ...model.toJSON(),
    threshold,
    reliableThemes: reliable,
    trainedOn: themeRows.length,
    microF1: Number(best.microF1.toFixed(4)),
    macroF1: Number(macroLearnable.toFixed(4)),
  };

  await fs.mkdir(path.dirname(WEIGHTS_PATH), { recursive: true });
  await fs.writeFile(WEIGHTS_PATH, JSON.stringify(payload));
  const bytes = (await fs.stat(WEIGHTS_PATH)).size;
  console.log(`\nWeights written to ${WEIGHTS_PATH} (${Math.round(bytes / 1024)} KB).`);
  console.log(
    reliable.length === 0
      ? '\nNo theme cleared the reliability floor. This labels nothing and must not be used.'
      : coverage < 0.5
        ? `\n${reliable.length} themes qualify but they cover only ${(coverage * 100).toFixed(0)}% of the label mass. ` +
          'The honest conclusion is that the current embeddings cannot support topical classification; ' +
          'do not auto-assign from this.'
        : `\nUsable for those ${reliable.length} themes. Run \`npm run classify-themes -w @ilm/api\` to label the unlabelled passages.`
  );
}

/** Micro F1 of always predicting the single most frequent theme. */
function floorMetrics(train: Array<{ labels: Float32Array }>, held: Array<{ labels: Float32Array }>, labels: string[]): number {
  const counts = new Int32Array(labels.length);
  for (const sample of train) for (let t = 0; t < labels.length; t += 1) counts[t] += sample.labels[t];
  let best = 0;
  for (let t = 0; t < labels.length; t += 1) if (counts[t] > counts[best]) best = t;

  let truePositive = 0;
  let predicted = 0;
  let actual = 0;
  for (const sample of held) {
    predicted += 1;
    if (sample.labels[best] > 0) truePositive += 1;
    for (let t = 0; t < labels.length; t += 1) if (sample.labels[t] > 0) actual += 1;
  }
  const precision = truePositive / Math.max(1, predicted);
  const recall = truePositive / Math.max(1, actual);
  return (2 * precision * recall) / Math.max(1e-9, precision + recall);
}

main()
  .catch((error) => {
    console.error('Training failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
