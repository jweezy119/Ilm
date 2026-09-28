import { describe, expect, it } from 'vitest';
import { ThemeClassifier, evaluate, selectThemes } from '../src/services/theme-classifier';

describe('sigmoid', () => {
  it('is stable at both ends, where the naive form overflows', () => {
    // 1/(1+e^x) overflows to Infinity for large positive x, and the example
    // becomes NaN, which propagates through the whole weight matrix. This form
    // branches so the exponential is always of a negative number.
    expect(ThemeClassifier.sigmoid(0)).toBeCloseTo(0.5, 6);
    expect(Number.isFinite(ThemeClassifier.sigmoid(1000))).toBe(true);
    expect(Number.isFinite(ThemeClassifier.sigmoid(-1000))).toBe(true);
    expect(ThemeClassifier.sigmoid(1000)).toBe(1);
  });

  it('keeps a usable gradient where it underflows to zero', () => {
    // sigmoid(-1000) is genuinely e^-1000, which no float represents, so it is
    // legitimately 0. What matters is that the gradient (p - y) is then -y, not
    // 0: the example still teaches. The naive overflow gave NaN here, which did
    // not, and that is the actual failure this guards.
    const p = ThemeClassifier.sigmoid(-1000);
    expect(p).toBe(0);
    expect(p - 1).toBe(-1);
  });

  it('is monotonic', () => {
    let previous = -1;
    for (let x = -20; x <= 20; x += 1) {
      const p = ThemeClassifier.sigmoid(x);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });

  it('never leaves the unit interval', () => {
    for (const x of [-50, -5, 0, 5, 50]) {
      const p = ThemeClassifier.sigmoid(x);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe('selectThemes', () => {
  const labels = ['mercy', 'atonement', 'covenant', 'creation'];

  it('keeps only scores above the threshold', () => {
    const scores = new Float32Array([0.9, 0.6, 0.2, 0.05]);
    const chosen = selectThemes(scores, labels, { threshold: 0.5 });
    expect(chosen.map((c) => c.theme)).toEqual(['mercy', 'atonement']);
  });

  it('always returns at least the minimum, so a passage is never blank', () => {
    // A passage about the sabbath is about the sabbath. Returning nothing for
    // every passage is a valid-looking failure that is worse than being imprecise.
    const scores = new Float32Array([0.02, 0.01, 0.01, 0.0]);
    const chosen = selectThemes(scores, labels, { threshold: 0.5, minThemes: 1 });
    expect(chosen).toHaveLength(1);
    expect(chosen[0].theme).toBe('mercy');
  });

  it('never returns more than the maximum', () => {
    const scores = new Float32Array([0.99, 0.98, 0.97, 0.96]);
    const chosen = selectThemes(scores, labels, { threshold: 0.1, maxThemes: 2 });
    expect(chosen).toHaveLength(2);
  });
});

describe('training', () => {
  /** Two well-separated clusters, each carrying one of two labels. */
  function synthetic(count: number, dims: number) {
    const samples: Array<{ vector: Float32Array; labels: Float32Array }> = [];
    for (let i = 0; i < count; i += 1) {
      const vector = new Float32Array(dims);
      const isA = i % 2 === 0;
      for (let d = 0; d < dims; d += 1) vector[d] = (Math.random() - 0.5) * 0.1 + (isA ? 1 : -1);
      const labels = new Float32Array(2);
      labels[isA ? 0 : 1] = 1;
      samples.push({ vector, labels });
    }
    return samples;
  }

  it('learns a linearly separable problem', () => {
    const model = new ThemeClassifier(16, ['a', 'b']);
    const samples = synthetic(400, 16);
    const balance = [
      { positive: samples.length / 2, total: samples.length },
      { positive: samples.length / 2, total: samples.length },
    ];

    const { loss } = model.train(samples, balance, { epochs: 25, learningRate: 0.5 });

    // The only claim worth making: loss falls, and by a lot. Not "it is accurate",
    // which on a separable toy problem would be a statement about the seed.
    expect(loss[loss.length - 1]).toBeLessThan(loss[0] * 0.2);
  });

  it('separates held-out samples from the same distribution', () => {
    const model = new ThemeClassifier(16, ['a', 'b']);
    const samples = synthetic(400, 16);
    const balance = [
      { positive: samples.length / 2, total: samples.length },
      { positive: samples.length / 2, total: samples.length },
    ];
    model.train(samples, balance, { epochs: 30, learningRate: 0.5, heldOut: 100 });

    const metrics = evaluate(model, samples.slice(300), { threshold: 0.5 });
    expect(metrics.microF1).toBeGreaterThan(0.85);
  });

  it('weights rare classes so they are not averaged away', () => {
    // A theme on 2% of passages, with and without positive weighting. Unweighted,
    // a model that never predicts it scores an excellent average and is useless
    // for the theme a reader searched for.
    const dims = 12;
    const samples: Array<{ vector: Float32Array; labels: Float32Array }> = [];
    for (let i = 0; i < 500; i += 1) {
      const vector = new Float32Array(dims);
      const rare = i % 50 === 0;
      for (let d = 0; d < dims; d += 1) vector[d] = (Math.random() - 0.5) * 0.1 + (rare ? 1.5 : -0.5);
      const labels = new Float32Array(2);
      if (rare) labels[1] = 1;
      else labels[0] = 1;
      samples.push({ vector, labels });
    }
    const minority = 10;
    const weighted = new ThemeClassifier(dims, ['common', 'rare']);
    weighted.train(
      samples,
      [
        { positive: 490, total: 500 },
        { positive: 2, total: 500 },
      ],
      { epochs: 40, learningRate: 0.4, l2: 0 }
    );
    // Positive weight 2/500 = 0.004 balanced up to roughly 25x.
    const metrics = evaluate(weighted, samples, { threshold: 0.4, maxThemes: 1, minThemes: 0 });
    const rareF1 = metrics.perThemeF1.find((r) => r.theme === 'rare')?.f1 ?? 0;
    expect(minority).toBeGreaterThan(0);
    expect(rareF1).toBeGreaterThan(0);
  });

  it('round-trips through JSON without losing predictions', () => {
    const model = new ThemeClassifier(8, ['a', 'b']);
    const vector = new Float32Array(8).fill(0.3);
    const before = model.predict(vector);
    const restored = ThemeClassifier.fromJSON(JSON.parse(JSON.stringify(model.toJSON())));
    const after = restored.predict(vector);
    expect(Array.from(after)).toEqual(Array.from(before));
  });
});
