import { afterEach, describe, expect, it } from 'vitest';
import type { Passage } from '@ilm/shared';
import { containsKeyword, classifyThemesAndDensity } from '../src/services/typesafe';
import { setJevJudge, resetJevJudge, type JevJudge, type JevQuestion } from '../src/services/typesafe-client';
import { expandForIndex, fold } from '../src/lib/script-normalize';
import { stemGreek, stemGreekTokens } from '../src/lib/greek-stem';

function makePassage(translation: string, originalText = ''): Passage {
  return {
    id: 'p1',
    passageKey: 'quran:1:1:1',
    textId: 'quran',
    book: '1',
    chapter: 1,
    verse: 1,
    originalText,
    translation,
    alternativeTranslations: [],
    embeddings: [],
    themes: [],
    crossReferences: [],
    metadata: { language: 'arabic', writingSystem: 'Arabic', canonicalOrder: 1, verseOrder: 1 },
  };
}

describe('containsKeyword regex cache', () => {
  it('enforces word boundaries consistently across repeated cached lookups', () => {
    expect(containsKeyword('reincarnation is a concept', 'nation')).toBe(false);
    expect(containsKeyword('a righteous nation', 'nation')).toBe(true);
    expect(containsKeyword('A RIGHTEOUS NATION', 'nation')).toBe(true);
    expect(containsKeyword('reincarnation again', 'NATION')).toBe(false);
  });
});

describe('classifyThemesAndDensity Jev batching', () => {
  afterEach(() => {
    resetJevJudge();
  });

  it('batches theme choice and density score into one initial Jev request', async () => {
    const calls: JevQuestion[][] = [];
    const stub: JevJudge = {
      id: 'jev',
      label: 'stub',
      available: true,
      reason: 'stub',
      async verify() {
        return { model: 'stub' };
      },
      async ask(_state, questions) {
        calls.push(questions);
        if (questions.some((q) => q.id === 'themes')) {
          return {
            source: 'jev',
            answers: {
              themes: { value: 0.9, probabilities: { mercy: 0.85, forgiveness: 0.4 }, confidence: 0.9, choice: 'mercy' },
              density: { value: 0.72, probabilities: {}, confidence: 0.85 },
            },
          };
        }
        return {
          source: 'jev',
          answers: {
            s0: { value: 0.88, probabilities: {}, confidence: 0.9 },
            s1: { value: 0.52, probabilities: {}, confidence: 0.8 },
          },
        };
      },
    };
    setJevJudge(stub);

    const res = await classifyThemesAndDensity(makePassage('In the name of God, the Most Merciful'), 5, {
      requireJudge: true,
    });

    // Two total calls: (1) choice + density combined, (2) strength scores
    expect(calls).toHaveLength(2);
    expect(calls[0].map((q) => q.id)).toEqual(['themes', 'density']);
    expect(res.density).toBeCloseTo(0.72, 4);
    expect(res.themes.map((t) => t.theme)).toEqual(['mercy', 'forgiveness']);
    expect(res.themes.every((t) => t.source === 'jev')).toBe(true);
  });

  it('falls back deterministically without Jev credentials', async () => {
    const unavailable: JevJudge = {
      id: 'derived',
      label: 'none',
      available: false,
      reason: 'not configured',
      async verify() {
        throw new Error('unavailable');
      },
      async ask() {
        throw new Error('unavailable');
      },
    };
    setJevJudge(unavailable);

    const res = await classifyThemesAndDensity(makePassage('The mercy and compassion of the Lord endure forever'));
    expect(res.density).toBe(0.5);
    expect(res.themes.length).toBeGreaterThan(0);
    expect(res.themes.every((t) => t.source === 'derived')).toBe(true);
  });
});

describe('original-text normalization and Greek stemming fast paths', () => {
  it('preserves Uthmani alternative readings without duplicate folding drift', () => {
    const expanded = expandForIndex('ٱلرَّحْمَٰنِ ٱلرَّحِيمِ');
    expect(expanded).toContain('الرحمن');
    expect(expanded).toContain('الرحمان');
    expect(fold('  In   the   beginning  ')).toBe('In the beginning');
  });

  it('memoizes Greek stems deterministically across repeated calls', () => {
    const forms = ['θεός', 'θεοῦ', 'θεῷ', 'θεοί', 'θεῶν'];
    const first = forms.map((w) => stemGreek(w));
    const second = forms.map((w) => stemGreek(w));
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(1);
    expect(stemGreek('μου')).toBe('μου');
    // Non-Greek text passes straight through untouched.
    expect(stemGreekTokens('الرحمن الرحيم')).toBe('الرحمن الرحيم');
  });
});
