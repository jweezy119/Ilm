/**
 * A theme classifier over lexical features.
 *
 * This exists because the dense-embedding classifier did not work, and the reason
 * it did not work is the point.
 *
 * `paraphrase-multilingual-MiniLM` is a similarity model: trained so that two
 * sentences about the same thing land near each other. Measured on held-out data it
 * reached 41% micro F1 for theme prediction — above the 14% of always guessing, and
 * wrong more often than right. Topic is not a similarity property. "A sacrifice was
 * offered" and "the LORD is my shepherd" can be semantically adjacent in that
 * space while sharing almost no vocabulary, which is exactly backwards for deciding
 * whether a passage is about sacrifice.
 *
 * So: term frequencies, stemmed, weighted by inverse document frequency, and a
 * centroid per theme. No learning rate, no epochs that matter, and a decision that
 * can be explained — "called atonement because it shares rare terms with the
 * passages Jev called atonement". That inspectability is worth more here than a
 * couple of points of F1.
 *
 * A second thing this must not do is leak its own labels. The corpus already has a
 * `search_vector` that includes theme names, so using it would hand the model the
 * answer. Features here come from the passage text alone, which is also why the
 * feature builder takes raw lexemes rather than that column.
 */

/** Stop nothing — `to_tsvector('english')` has already stemmed and dropped stopwords. */
export interface LexicalDocument {
  id: string;
  /** Term -> count, already stemmed. */
  terms: Map<string, number>;
}

export interface Vocabulary {
  terms: string[];
  idf: Float32Array;
}

export interface VocabularyOptions {
  /** Terms appearing in fewer passages than this are noise or typos. */
  minDocumentFrequency?: number;
  /** Cap, keeping the most widely-distributed terms. 40k is plenty for 80 topics. */
  maxTerms?: number;
}

/**
 * Build a vocabulary with inverse document frequency.
 *
 * Terms are kept by document frequency rather than by corpus frequency on purpose.
 * The frequent words in scripture are exactly the ones that carry no topical
 * information — "lord", "said", "people" appear everywhere — and the rare ones are
 * what distinguish a passage about ritual from one about kingship.
 */
export function buildVocabulary(docs: LexicalDocument[], options: VocabularyOptions = {}): Vocabulary {
  const minDf = options.minDocumentFrequency ?? 3;
  const maxTerms = options.maxTerms ?? 40_000;

  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.terms.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const kept = [...documentFrequency.entries()]
    .filter(([, df]) => df >= minDf)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([term]) => term);

  const idf = new Float32Array(kept.length);
  const total = Math.max(1, docs.length);
  for (let i = 0; i < kept.length; i += 1) {
    // Smoothed: a term in every document would otherwise get idf 0 and vanish
    // entirely, which is nearly what we want for "lord" but is a knife edge.
    idf[i] = Math.log((total + 1) / ((documentFrequency.get(kept[i]) ?? 0) + 1)) + 1;
  }

  return { terms: kept, idf };
}

export interface SparseVector {
  indices: Int32Array;
  values: Float32Array;
}

const termIndex = (vocabulary: Vocabulary) => {
  const map = new Map<string, number>();
  vocabulary.terms.forEach((term, i) => map.set(term, i));
  return map;
};

/**
 * TF-IDF, sublinear term frequency, L2 normalised.
 *
 * Sublinear because term counts in scripture are long-tailed: a passage repeating
 * "blood" nine times is not nine times more about blood. L2 normalisation so that
 * cosine against a centroid is a plain dot product, and so a long passage does not
 * out-vote a short one purely by length.
 */
export function toTfidf(doc: LexicalDocument, vocabulary: Vocabulary, index?: Map<string, number>): SparseVector {
  const lookup = index ?? termIndex(vocabulary);
  const indices: number[] = [];
  const values: number[] = [];

  for (const [term, count] of doc.terms) {
    const i = lookup.get(term);
    if (i === undefined) continue;
    const tf = 1 + Math.log(count);
    indices.push(i);
    values.push(tf * vocabulary.idf[i]);
  }

  let norm = 0;
  for (const v of values) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let k = 0; k < values.length; k += 1) values[k] /= norm;

  return { indices: Int32Array.from(indices), values: Float32Array.from(values) };
}

/** Dense, for training and for the 80 centroids. 35k x 40k would be far too big. */
export interface DenseSample {
  id: string;
  labels: Float32Array;
  vector: Float32Array;
}

export function toDense(
  doc: LexicalDocument,
  vocabulary: Vocabulary,
  index?: Map<string, number>
): Float32Array {
  const sparse = toTfidf(doc, vocabulary, index);
  const dense = new Float32Array(vocabulary.terms.length);
  for (let k = 0; k < sparse.indices.length; k += 1) dense[sparse.indices[k]] = sparse.values[k];
  return dense;
}

/**
 * One centroid per theme: the mean of the training passages carrying it, then
 * normalised so that comparing to it is a cosine.
 *
 * Centroid rather than logistic regression because there are 80 classes and
 * 35,799 examples: a Rocchio classifier costs one accumulation per term and gives
 * up a couple of points of F1, and the resulting model is 80 sparse-ish vectors a
 * human can read. On the previous attempt, extra capacity was not what was missing.
 */
export function fitCentroids(
  samples: DenseSample[],
  themes: string[],
  options: { minSupport?: number } = {}
): { centroids: Float32Array[]; support: number[]; offsets: number[] } {
  const minSupport = options.minSupport ?? 2;
  const dims = samples[0]?.vector.length ?? 0;
  const centroids: Float32Array[] = [];
  const support: number[] = [];

  for (let t = 0; t < themes.length; t += 1) {
    const accumulator = new Float32Array(dims);
    let count = 0;
    for (const sample of samples) {
      if (sample.labels[t] === 0) continue;
      const v = sample.vector;
      for (let d = 0; d < dims; d += 1) accumulator[d] += v[d];
      count += 1;
    }
    if (count < minSupport) {
      // Below this the centroid is an average of one or two passages and is worse
      // than useless: it will match anything similar to that single example.
      support.push(count);
      centroids.push(new Float32Array(0));
      continue;
    }
    let norm = 0;
    for (let d = 0; d < dims; d += 1) norm += accumulator[d] * accumulator[d];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let d = 0; d < dims; d += 1) accumulator[d] /= norm;
    centroids.push(accumulator);
    support.push(count);
  }

  return { centroids, support, offsets: Array.from(support) };
}

/**
 * Cosine similarity against every centroid.
 *
 * The optional output buffer matters: the evaluator passes one to score 35,000
 * passages against 80 centroids, and allocating 2.8 million short-lived arrays
 * doing it is the difference between a second and a minute. It was silently
 * missing, so every score came back zero and the evaluator fell through to its
 * tie-break path — which is how a model that separates the toy data perfectly
 * scored 0.5.
 */
export function predict(
  centroids: Float32Array[],
  vector: Float32Array,
  out?: Float32Array
): Float32Array {
  const scores = out ?? new Float32Array(centroids.length);
  for (let t = 0; t < centroids.length; t += 1) {
    const c = centroids[t];
    if (c.length === 0) {
      scores[t] = 0;
      continue;
    }
    let dot = 0;
    for (let d = 0; d < c.length; d += 1) dot += c[d] * vector[d];
    scores[t] = dot; // cosine, since both sides are unit length
  }
  return scores;
}

/**
 * Per-theme thresholds.
 *
 * A single global cut is wrong for centroids specifically: similarity scores are
 * not probabilities and their scale differs per theme, because a theme carried by
 * four thousand passages has a broad centroid and a rare one a tight one. A shared
 * threshold therefore either drowns the rare themes or floods the common ones.
 * Each theme gets the cut that maximised its own F1 on held-out data.
 */
export function fitThresholds(
  centroids: Float32Array[],
  themes: string[],
  samples: DenseSample[],
  options: { grid?: number[] } = {}
): Float32Array {
  const grid = options.grid ?? [0.05, 0.1, 0.12, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5];
  const thresholds = new Float32Array(themes.length).fill(0.2);

  for (let t = 0; t < themes.length; t += 1) {
    if (centroids[t].length === 0) continue;
    const scores = samples.map((s) => predict([centroids[t]], s.vector)[0]);
    const actual = samples.map((s) => s.labels[t] > 0);
    let bestF1 = -1;
    for (const cut of grid) {
      let tp = 0;
      let fp = 0;
      let fn = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const predicted = scores[i] >= cut;
        if (predicted && actual[i]) tp += 1;
        else if (predicted) fp += 1;
        else if (actual[i]) fn += 1;
      }
      const f1 = (2 * tp) / Math.max(1, 2 * tp + fp + fn);
      if (f1 > bestF1) {
        bestF1 = f1;
        thresholds[t] = cut;
      }
    }
  }
  return thresholds;
}

export interface LexicalMetrics {
  microPrecision: number;
  microRecall: number;
  microF1: number;
  macroF1: number;
  perTheme: Array<{ theme: string; f1: number; support: number }>;
  predicted: number;
  actual: number;
}

export function evaluateLexical(
  centroids: Float32Array[],
  themes: string[],
  thresholds: Float32Array,
  samples: DenseSample[],
  options: { minThemes?: number; maxThemes?: number } = {}
): LexicalMetrics {
  const minThemes = options.minThemes ?? 1;
  const maxThemes = options.maxThemes ?? 4;

  const scores = new Float32Array(themes.length);
  const tp = new Int32Array(themes.length);
  const fp = new Int32Array(themes.length);
  const fn = new Int32Array(themes.length);
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (const sample of samples) {
    predict(centroids, sample.vector, scores);
    const ranked: number[] = [];
    for (let t = 0; t < themes.length; t += 1) {
      if (centroids[t].length > 0 && scores[t] >= thresholds[t]) ranked.push(t);
    }
    ranked.sort((a, b) => scores[b] - scores[a]);

    const chosen: number[] = ranked.slice(0, maxThemes);
    if (chosen.length < minThemes) {
      /*
       * Always say something — a passage with no theme is a hole in the data — but
       * say the *most confident* thing, not the first thing in the list. Taking the
       * first eligible theme scored 0.5 micro F1 on data the model separates
       * perfectly, because a passage below every one of its thresholds was handed
       * whichever theme happened to come first in the taxonomy.
       */
      const byScore = [...Array(themes.length).keys()]
        .filter((t) => centroids[t].length > 0)
        .sort((a, b) => scores[b] - scores[a]);
      for (const t of byScore) {
        if (chosen.length >= minThemes) break;
        if (!chosen.includes(t)) chosen.push(t);
      }
    }

    for (const t of chosen) {
      if (sample.labels[t] > 0) {
        truePositive += 1;
        tp[t] += 1;
      } else {
        falsePositive += 1;
        fp[t] += 1;
      }
    }
    for (let t = 0; t < themes.length; t += 1) {
      if (sample.labels[t] > 0 && !chosen.includes(t)) {
        falseNegative += 1;
        fn[t] += 1;
      }
    }
  }

  const microPrecision = truePositive / Math.max(1, truePositive + falsePositive);
  const microRecall = truePositive / Math.max(1, truePositive + falseNegative);
  const microF1 = (2 * microPrecision * microRecall) / Math.max(1e-9, microPrecision + microRecall);

  const perTheme = themes
    .map((theme, t) => ({
      theme,
      f1: (2 * tp[t]) / Math.max(1, 2 * tp[t] + fp[t] + fn[t]),
      support: tp[t] + fn[t],
    }))
    .filter((r) => r.support > 0);
  const macroF1 = perTheme.reduce((sum, r) => sum + r.f1, 0) / Math.max(1, perTheme.length);

  return {
    microPrecision,
    microRecall,
    microF1,
    macroF1,
    perTheme,
    predicted: truePositive + falsePositive,
    actual: truePositive + falseNegative,
  };
}

/**
 * Parse the `text` rendering of a tsvector: `'creat':3 'form':1`.
 *
 * The counts are kept rather than discarded, because a passage that says "blood"
 * five times is more about blood than one that says it once, and the counts are
 * what lets sublinear term frequency do that job.
 */
export function parseTsvector(text: string): Map<string, number> {
  const terms = new Map<string, number>();
  // Lexemes are single-quoted and may not contain an apostrophe after stemming.
  const pattern = /'([^']+)':(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    terms.set(match[1], Number(match[2]));
  }
  return terms;
}
