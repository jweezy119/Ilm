import { describe, expect, it } from 'vitest';
import {
  buildVocabulary,
  evaluateLexical,
  fitCentroids,
  fitThresholds,
  parseTsvector,
  predict,
  toDense,
  type DenseSample,
  type LexicalDocument,
} from '../src/services/lexical-theme-model';

const doc = (id: string, text: string): LexicalDocument => ({ id, terms: parseTsvector(text) });

describe('parseTsvector', () => {
  it('reads terms and counts', () => {
    const terms = parseTsvector("'creat':3 'form':1 'day':2");
    expect(terms.get('creat')).toBe(3);
    expect(terms.get('day')).toBe(2);
    expect(terms.size).toBe(3);
  });

  it('returns nothing for an empty vector', () => {
    expect(parseTsvector('').size).toBe(0);
  });
});

describe('buildVocabulary', () => {
  const docs = [
    doc('a', "'sacrific':2 'blood':1"),
    doc('b', "'sacrific':1 'lamb':3"),
    doc('c', "'sheep':2 'lamb':1"),
    doc('d', "'sheep':1 'pastor':4"),
  ];

  it('drops terms below the document-frequency floor', () => {
    const v = buildVocabulary(docs, { minDocumentFrequency: 2 });
    // 'blood' and 'pastor' appear once; 'lamb' twice; 'sacrific' twice; 'sheep' twice.
    expect(v.terms).toContain('lamb');
    expect(v.terms).not.toContain('blood');
    expect(v.terms).not.toContain('pastor');
  });

  it('weights a term by how many passages it is in, not how often it repeats', () => {
    // The whole argument for lexical features: 'blood' appears once in one passage,
    // 'lamb' three times in one passage. Repetition is not prevalence, and weighting
    // by count would make the rarer-in-corpus term look the more common one.
    const v = buildVocabulary(docs, { minDocumentFrequency: 1 });
    const idf = (term: string) => v.idf[v.terms.indexOf(term)];
    expect(idf('blood')).toBeGreaterThan(idf('sacrific'));
  });
});

describe('tf-idf and centroids', () => {
  const docs = [
    doc('a', "'sacrific':2 'blood':3 'offer':1"),
    doc('b', "'sacrific':1 'blood':1 'offer':2"),
    doc('c', "'sheep':2 'lamb':3 'pastor':1"),
    doc('d', "'sheep':1 'lamb':2 'pastor':2"),
  ];
  const vocabulary = buildVocabulary(docs, { minDocumentFrequency: 1 });
  const themes = ['sacrifice', 'pasture'];

  const label = (sacrifice: boolean, pasture: boolean) => {
    const v = new Float32Array(2);
    if (sacrifice) v[0] = 1;
    if (pasture) v[1] = 1;
    return v;
  };
  const samples: DenseSample[] = [
    { id: 'a', labels: label(true, false), vector: toDense(docs[0], vocabulary) },
    { id: 'b', labels: label(true, false), vector: toDense(docs[1], vocabulary) },
    { id: 'c', labels: label(false, true), vector: toDense(docs[2], vocabulary) },
    { id: 'd', labels: label(false, true), vector: toDense(docs[3], vocabulary) },
  ];

  it('normalises every vector to unit length', () => {
    for (const sample of samples) {
      let norm = 0;
      for (const v of sample.vector) norm += v * v;
      expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
    }
  });

  it('separates two clearly distinct topics', () => {
    const { centroids } = fitCentroids(samples, themes);
    const scoresForA = predict(centroids, samples[0].vector);
    expect(scoresForA[0]).toBeGreaterThan(scoresForA[1]);
    const scoresForC = predict(centroids, samples[2].vector);
    expect(scoresForC[1]).toBeGreaterThan(scoresForC[0]);
  });

  it('does not build a centroid from a class with almost no support', () => {
    // A centroid averaged from one passage matches anything near that passage, and
    // looks like a confident prediction while being an artefact.
    const lonely: DenseSample[] = [
      { id: 'a', labels: label(true, false), vector: toDense(docs[0], vocabulary) },
      { id: 'z', labels: label(false, true), vector: toDense(docs[1], vocabulary) },
    ];
    const { centroids, support } = fitCentroids(lonely, themes, { minSupport: 2 });
    expect(support[1]).toBe(1);
    expect(centroids[1].length).toBe(0);
    expect(predict(centroids, samples[0].vector)[1]).toBe(0);
  });

  it('fits a per-theme threshold and predicts perfectly on separated data', () => {
    const { centroids } = fitCentroids(samples, themes);
    const thresholds = fitThresholds(centroids, themes, samples);
    const metrics = evaluateLexical(centroids, themes, thresholds, samples);
    expect(metrics.microF1).toBeGreaterThan(0.9);
  });

  it('always returns at least one theme', () => {
    const { centroids } = fitCentroids(samples, themes);
    const thresholds = new Float32Array(themes.length).fill(1.1); // nothing may pass
    const metrics = evaluateLexical(centroids, themes, thresholds, samples, { minThemes: 1 });
    // Silence would be a hole in the data; the most confident theme is a better
    // answer, and the metrics have to show that it was chosen.
    expect(metrics.predicted).toBe(samples.length);
  });
});
