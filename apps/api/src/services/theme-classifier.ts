/**
 * A multi-label linear classifier for passage themes.
 *
 * Why this exists: 35,799 passages carry themes a model assigned, and the remaining
 * 9,654 have only keyword themes or none. Filling those with the hosted judge costs
 * money, every time, for the same 80 labels. A classifier trained once on the
 * existing labels does it for nothing, on CPU, in seconds.
 *
 * Linear, not a neural network, and that is the whole argument. There are 67,643
 * labels over 80 classes on 384-dimensional inputs. A linear model reaches a
 * useful score on that in seconds and its mistakes are inspectable — a weight is a
 * direction in embedding space, and you can ask why a passage was called
 * "atonement". An MLP would score marginally better and be a black box on the one
 * question this app is judged on.
 *
 * One sigmoid per theme, trained one-vs-rest with per-class weights, because the
 * classes are very unevenly sized: a theme on nine passages and a theme on
 * thousands would otherwise let the large ones dominate the gradient.
 *
 * Written against Float32Array rather than pulled in as a dependency. The whole
 * model is a few dozen lines of arithmetic, and a 400 KB ML library to do it would
 * be a poor trade in a project whose other rules are about keeping things inspectable.
 */

/** Themes are this imbalanced that unweighted training predicts the big ones only. */
export interface ClassBalance {
  positive: number;
  total: number;
}

export class ThemeClassifier {
  /** One row per theme, one column per input dimension. */
  private weights: Float32Array;
  /** Bias per theme. */
  private biases: Float32Array;
  private readonly dims: number;
  private readonly labels: string[];

  constructor(dims: number, labels: string[]) {
    this.dims = dims;
    this.labels = labels;
    this.weights = new Float32Array(labels.length * dims);
    this.biases = new Float32Array(labels.length);
  }

  get themeCount(): number {
    return this.labels.length;
  }

  get dimensionCount(): number {
    return this.dims;
  }

  get themes(): string[] {
    return this.labels;
  }

  /**
   * Sigmoid, written out rather than used from Math.exp directly.
   *
   * The naive form overflows for large negative inputs and returns exactly 0, at
   * which point the gradient is 0 and the example can never be learned again.
   * This form is stable at both ends.
   */
  static sigmoid(x: number): number {
    if (x >= 0) {
      const z = Math.exp(-x);
      return 1 / (1 + z);
    }
    const z = Math.exp(x);
    return z / (1 + z);
  }

  /** Raw probability for every theme, given one embedding. */
  predict(vector: Float32Array, out?: Float32Array): Float32Array {
    const scores = out ?? new Float32Array(this.labels.length);
    for (let t = 0; t < this.labels.length; t += 1) {
      let sum = this.biases[t];
      const base = t * this.dims;
      for (let d = 0; d < this.dims; d += 1) sum += this.weights[base + d] * vector[d];
      scores[t] = ThemeClassifier.sigmoid(sum);
    }
    return scores;
  }

  /**
   * Train with mini-batch gradient descent and AdaGrad.
   *
   * AdaGrad rather than plain SGD because the embedding dimensions have wildly
   * different scales — a rare token's component is orders of magnitude below a
   * common one — and a single learning rate is either too big for the former or
   * too small for the latter. AdaGrad gives each weight its own rate from its own
   * history, which removes a knob rather than adding one.
   */
  train(
    samples: Array<{ vector: Float32Array; labels: Float32Array }>,
    balance: ClassBalance[],
    options: { epochs?: number; batchSize?: number; learningRate?: number; l2?: number; heldOut?: number } = {}
  ): { loss: number[]; validationLoss: number[] } {
    const epochs = options.epochs ?? 12;
    const batchSize = options.batchSize ?? 64;
    const baseRate = options.learningRate ?? 0.35;
    const l2 = options.l2 ?? 1e-5;
    const heldOut = options.heldOut ?? 0;

    const accumulator = new Float32Array(this.weights.length);
    const biasAccumulator = new Float32Array(this.labels.length);
    const loss: number[] = [];
    const validationLoss: number[] = [];

    const trainCount = samples.length - heldOut;
    const order = new Int32Array(trainCount);
    for (let i = 0; i < trainCount; i += 1) order[i] = i;

    for (let epoch = 0; epoch < epochs; epoch += 1) {
      // Shuffled each epoch. Without it, minibatches are in corpus order — and
      // corpus order is one text after another, so every batch would be a single
      // corpus and the model would learn "which corpus" instead of "which themes".
      shuffle(order);

      const gradW = new Float32Array(this.weights.length);
      const gradB = new Float32Array(this.labels.length);
      let epochLoss = 0;
      let seen = 0;

      for (let start = 0; start < trainCount; start += batchSize) {
        gradW.fill(0);
        gradB.fill(0);
        const end = Math.min(start + batchSize, trainCount);
        const size = end - start;

        for (let s = start; s < end; s += 1) {
          const sample = samples[order[s]];
          const { vector, labels } = sample;

          for (let t = 0; t < this.labels.length; t += 1) {
            const base = t * this.dims;
            let z = this.biases[t];
            for (let d = 0; d < this.dims; d += 1) z += this.weights[base + d] * vector[d];
            const p = ThemeClassifier.sigmoid(z);
            const y = labels[t];

            // Positive weighting: a theme on nine passages contributes as much per
            // example as a theme on four thousand, instead of being averaged away.
            const w = y > 0 ? balance[t].positive : 1;
            const error = (p - y) * w;
            epochLoss += -w * (y * Math.log(p + 1e-9) + (1 - y) * Math.log(1 - p + 1e-9));
            seen += w;

            gradB[t] += error;
            for (let d = 0; d < this.dims; d += 1) gradW[base + d] += error * vector[d];
          }
        }

        for (let t = 0; t < this.labels.length; t += 1) {
          const base = t * this.dims;
          gradB[t] /= size;
          for (let d = 0; d < this.dims; d += 1) {
            const g = gradW[base + d] / size + l2 * this.weights[base + d];
            accumulator[base + d] += g * g;
            this.weights[base + d] -= (baseRate * g) / (Math.sqrt(accumulator[base + d]) + 1e-8);
          }
          biasAccumulator[t] += gradB[t] * gradB[t];
          this.biases[t] -= (baseRate * gradB[t]) / (Math.sqrt(biasAccumulator[t]) + 1e-8);
        }
      }

      loss.push(epochLoss / Math.max(1, seen));

      if (heldOut > 0) {
        let total = 0;
        let count = 0;
        for (let i = trainCount; i < samples.length; i += 1) {
          const { vector, labels } = samples[i];
          for (let t = 0; t < this.labels.length; t += 1) {
            const base = t * this.dims;
            let z = this.biases[t];
            for (let d = 0; d < this.dims; d += 1) z += this.weights[base + d] * vector[d];
            const p = ThemeClassifier.sigmoid(z);
            total += -(labels[t] * Math.log(p + 1e-9) + (1 - labels[t]) * Math.log(1 - p + 1e-9));
            count += 1;
          }
        }
        validationLoss.push(total / Math.max(1, count));
      }
    }

    return { loss, validationLoss };
  }

  toJSON(): { dims: number; labels: string[]; weights: number[]; biases: number[] } {
    return {
      dims: this.dims,
      labels: this.labels,
      // Rounded to four decimals. A weight of 0.00001 has no effect on a sigmoid,
      // and the file is committed, so the difference is real bytes for nothing.
      weights: Array.from(this.weights, (w) => Number(w.toFixed(4))),
      biases: Array.from(this.biases, (b) => Number(b.toFixed(4))),
    };
  }

  static fromJSON(data: { dims: number; labels: string[]; weights: number[]; biases: number[] }): ThemeClassifier {
    const model = new ThemeClassifier(data.dims, data.labels);
    model.weights.set(data.weights);
    model.biases.set(data.biases);
    return model;
  }
}

/**
 * Choose labels above a threshold, keeping at least `minThemes` and never more
 * than `maxThemes`.
 *
 * A fixed threshold alone is wrong for multi-label prediction in both directions:
 * at 0.5 this classifier would label almost nothing, and at a low threshold it
 * would call every passage a commentary on atonement. The floor and ceiling are
 * what make the output usable — a passage about the sabbath is about the sabbath
 * and the covenant, not thirty things.
 */
export function selectThemes(
  scores: Float32Array,
  labels: string[],
  options: { threshold?: number; minThemes?: number; maxThemes?: number; reliableOnly?: Set<string> } = {}
): Array<{ theme: string; score: number }> {
  const threshold = options.threshold ?? 0.5;
  const minThemes = options.minThemes ?? 1;
  const maxThemes = options.maxThemes ?? 4;

  /*
   * Restricting to themes the model was measured to be reliable on is what makes
   * this usable at all.
   *
   * A single threshold applied to 80 classes means a theme with twenty training
   * examples gets the same say as one with four thousand, and it guesses: measured
   * per-theme F1 on held-out data runs from 57% for `family` down to 5% for
   * `ceremony`. Assigning a theme the model cannot predict would put a confident,
   * checkable-looking label on a passage that does not carry it — the same failure
   * as every other unsourced claim this app is built to avoid. A theme the model
   * cannot do is better left unlabelled.
   */
  const ranked = labels
    .map((theme, i) => ({ theme, score: scores[i] }))
    .filter((r) => !options.reliableOnly || options.reliableOnly.has(r.theme))
    .sort((a, b) => b.score - a.score);

  const selected = ranked.filter((r) => r.score >= threshold).slice(0, maxThemes);
  if (selected.length < minThemes) {
    for (const candidate of ranked) {
      if (selected.length >= minThemes) break;
      if (!selected.includes(candidate)) selected.push(candidate);
    }
  }
  return selected.map((r) => ({ theme: r.theme, score: Number(r.score.toFixed(4)) }));
}

function shuffle(array: Int32Array): void {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
}

/**
 * Precision, recall and F1 for multi-label prediction.
 *
 * Reported rather than asserted, because the only question that matters about a
 * classifier is whether it beats guessing, and that is a measurement.
 */
export interface MultilabelMetrics {
  microPrecision: number;
  microRecall: number;
  microF1: number;
  macroF1: number;
  perThemeF1: Array<{ theme: string; f1: number; support: number }>;
  predicted: number;
  actual: number;
}

export function evaluate(
  model: ThemeClassifier,
  samples: Array<{ vector: Float32Array; labels: Float32Array }>,
  options: { threshold?: number; minThemes?: number; maxThemes?: number } = {}
): MultilabelMetrics {
  const labels = model.themes;
  const scores = new Float32Array(labels.length);

  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const tp = new Int32Array(labels.length);
  const fp = new Int32Array(labels.length);
  const fn = new Int32Array(labels.length);

  for (const sample of samples) {
    model.predict(sample.vector, scores);
    const chosen = new Set(selectThemes(scores, labels, options).map((s) => s.theme));
    const actual = new Set<string>();
    for (let t = 0; t < labels.length; t += 1) if (sample.labels[t] > 0) actual.add(labels[t]);

    for (const theme of chosen) {
      if (actual.has(theme)) {
        truePositive += 1;
        tp[labels.indexOf(theme)] += 1;
      } else {
        falsePositive += 1;
        fp[labels.indexOf(theme)] += 1;
      }
    }
    for (const theme of actual) {
      if (!chosen.has(theme)) {
        falseNegative += 1;
        fn[labels.indexOf(theme)] += 1;
      }
    }
  }

  const microPrecision = truePositive / Math.max(1, truePositive + falsePositive);
  const microRecall = truePositive / Math.max(1, truePositive + falseNegative);
  const microF1 = (2 * microPrecision * microRecall) / Math.max(1e-9, microPrecision + microRecall);

  const perThemeF1 = labels
    .map((theme, t) => {
      const f1 = (2 * tp[t]) / Math.max(1, 2 * tp[t] + fp[t] + fn[t]);
      return { theme, f1, support: tp[t] + fn[t] };
    })
    .filter((r) => r.support > 0);

  const macroF1 = perThemeF1.reduce((sum, r) => sum + r.f1, 0) / Math.max(1, perThemeF1.length);

  return {
    microPrecision,
    microRecall,
    microF1,
    macroF1,
    perThemeF1,
    predicted: truePositive + falsePositive,
    actual: truePositive + falseNegative,
  };
}
