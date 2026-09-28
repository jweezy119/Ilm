import { afterEach, describe, expect, it } from 'vitest';
import { getEmbeddingConfig, isEmbeddingConfigured, cosineSimilarity } from '../src/services/embeddings';

describe('getEmbeddingConfig', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('prefers the local model when explicitly requested, with no key needed', () => {
    process.env.EMBEDDING_PROVIDER = 'local';
    const config = getEmbeddingConfig();
    expect(config?.provider).toBe('local');
    expect(config?.apiKey).toBe('');
    // Multilingual, because the corpus is not monolingual.
    expect(config?.model).toContain('multilingual');
  });

  it('reports nothing configured when no provider is named, so the app still runs', () => {
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(getEmbeddingConfig()).toBeNull();
    expect(isEmbeddingConfigured()).toBe(false);
  });

  it('ignores placeholder keys', () => {
    delete process.env.EMBEDDING_PROVIDER;
    process.env.OPENROUTER_API_KEY = 'your_key_here';
    expect(getEmbeddingConfig()).toBeNull();
  });

  it('uses a hosted provider when one is configured', () => {
    delete process.env.EMBEDDING_PROVIDER;
    process.env.OPENROUTER_API_KEY = 'sk-real';
    expect(getEmbeddingConfig()?.provider).toBe('openrouter');
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for a vector against itself', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('is 0 when the dimensions disagree, rather than comparing garbage', () => {
    // A passage embedded before a model change will not match one embedded after.
    // Reading past the end of the shorter vector would invent a number.
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('is 0 for empty or zero vectors rather than NaN', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
