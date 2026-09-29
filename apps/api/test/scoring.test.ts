import { describe, expect, it } from 'vitest';
import type { Passage, TextId } from '@ilm/shared';
import { normalizeWeights } from '../src/services/recommendation';
import { DEFAULT_WEIGHTS } from '@ilm/shared';
import { localIntent, localThemeScores, localQueryTheme, containsKeyword, themeSearchTerms, blendSearchScore, sharedPhrases, significantTerms, properNouns, historicalBaseline, localAffinityScores } from '../src/services/typesafe';

function passage(over: Partial<Passage> = {}): Passage {
  return {
    id: 'p1',
    passageKey: 'quran:1:1:1',
    textId: 'quran',
    book: '1',
    chapter: 1,
    verse: 1,
    originalText: '',
    translation: '',
    alternativeTranslations: [],
    metadata: { language: 'arabic', writingSystem: 'Arabic', canonicalOrder: 1, verseOrder: 1 },
    embeddings: [],
    themes: [],
    crossReferences: [],
    ...over,
  };
}

describe('normalizeWeights', () => {
  it('returns the defaults when nothing is supplied', () => {
    expect(normalizeWeights(undefined)).toEqual({
      thematic: 0.3, linguistic: 0.3, historical: 0, narrative: 0.3, theological: 0.1,
    });
  });

  it('weights the historical dimension at zero, so nothing rides on it', () => {
    // The local fallback for this dimension used to be a hand-written table of
    // corpus-pair proximities: a constant for every pair of passages from the same
    // two corpora, and 0.6 for a passage against another verse of its own book. It
    // must not reach the composite. See historicalBaseline below.
    expect(DEFAULT_WEIGHTS.historical).toBe(0);
    expect(normalizeWeights(undefined).historical).toBe(0);
  });

  it('does not let the theme classifier dominate the composite', () => {
    // thematic and theological both read theme-label overlap, at two scales. Their
    // combined weight used to be 0.5, which put half the score on one keyword
    // classifier. It is now 0.4, and theological is the smaller of the two because
    // it is the narrower reading of the same thing.
    const w = normalizeWeights(undefined);
    expect(w.thematic + w.theological).toBeLessThanOrEqual(0.41);
    expect(w.theological).toBeLessThan(w.thematic);
  });

  it('keeps weights that already sum to one', () => {
    const w = { thematic: 0.5, linguistic: 0.2, historical: 0.1, narrative: 0.1, theological: 0.1 };
    expect(normalizeWeights(w)).toEqual(w);
  });

  it('rescales weights that do not sum to one', () => {
    const result = normalizeWeights({ thematic: 1, linguistic: 1 });
    const total = result.thematic + result.linguistic + result.historical + result.narrative + result.theological;
    expect(total).toBeCloseTo(1, 5);
    expect(result.thematic).toBeCloseTo(result.linguistic, 5);
  });

  it('clamps values outside 0-1 rather than emitting them', () => {
    const result = normalizeWeights({ thematic: 5, linguistic: -2 });
    expect(result.thematic).toBeGreaterThanOrEqual(0);
    expect(result.linguistic).toBeGreaterThanOrEqual(0);
    expect(result.thematic).toBeLessThanOrEqual(1);
  });

  it('falls back to defaults when every weight is zero', () => {
    expect(normalizeWeights({ thematic: 0, linguistic: 0, historical: 0, narrative: 0, theological: 0 })).toEqual({
      thematic: 0.3, linguistic: 0.3, historical: 0, narrative: 0.3, theological: 0.1,
    });
  });
});

describe('localIntent', () => {
  it('detects comparison intent', () => {
    expect(localIntent('compare mercy and justice').intent).toBe('comparison');
  });

  it('detects cross-reference intent', () => {
    expect(localIntent('what is quoted in john 3').intent).toBe('cross_reference');
  });

  it('returns unknown for a bare word with no intent signal', () => {
    const result = localIntent('xyzzy');
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
  });
});

describe('text signals', () => {
  it('drops stop words and short tokens', () => {
    const terms = significantTerms('The Lord is God and the God is love');
    expect(terms.has('the')).toBe(false);
    expect(terms.has('lord')).toBe(false); // on the stop list
    expect(terms.has('love')).toBe(true);
  });

  it('extracts capitalised names lowercased', () => {
    const names = properNouns('Abram met Melchizedek in Salem');
    expect(names.has('abram')).toBe(true);
    expect(names.has('melchizedek')).toBe(true);
  });

  it('reports no historical proximity rather than a fabricated one', () => {
    // Previously a hand-written table asserted that the Torah sat closer to the Old
    // Testament (0.9) than to the Talmud (0.5), which is an editorial claim about
    // the traditions wearing a decimal point, returned identically for every pair
    // of passages from those corpora. The fallback now reports nothing, so an
    // unmeasured dimension reads as zero rather than as a confident constant.
    expect(historicalBaseline('torah', 'ot')).toBe(0);
    expect(historicalBaseline('torah', 'talmud')).toBe(0);
    expect(historicalBaseline('nt', 'quran')).toBe(0);
  });

  it('does not score a passage as historically close to its own corpus', () => {
    // This returned 0.6 for any same-corpus pair, so a passage scored higher
    // against an unrelated verse of its own book than against a demonstrably
    // linked verse elsewhere.
    expect(historicalBaseline('nt', 'nt')).toBe(0);
  });
});

describe('localThemeScores', () => {
  it('tags a passage that talks about mercy', () => {
    const themes = localThemeScores(passage({ translation: 'The mercy of the Lord is everlasting, his compassion endures' }));
    expect(themes.map((t) => t.theme)).toContain('mercy');
  });

  it('tags a passage that talks about Noah', () => {
    const themes = localThemeScores(passage({ translation: 'And God said unto Noah, Come thou into the ark' }));
    expect(themes.map((t) => t.theme)).toContain('noah');
  });

  it('returns nothing for text with no theme vocabulary', () => {
    expect(localThemeScores(passage({ translation: 'qqq zzz www' }))).toEqual([]);
  });

  it('caps the number of themes returned', () => {
    const busy = 'mercy justice love prayer worship fasting charity covenant law sin spirit knowledge wisdom creation light water fire';
    expect(localThemeScores(passage({ translation: busy }), 3)).toHaveLength(3);
  });
});

describe('localAffinityScores', () => {
  const weights = { thematic: 0.3, linguistic: 0.2, historical: 0.15, narrative: 0.15, theological: 0.2 };

  it('does not reward same-language character overlap as linguistic evidence', () => {
    const a = passage({ originalText: 'אֱלֹהִים', metadata: { language: 'hebrew', writingSystem: 'Hebrew', canonicalOrder: 1, verseOrder: 1 } });
    const b = passage({ id: 'p2', passageKey: 'torah:1:1:1', textId: 'torah', originalText: 'אֱלֹהִים', translation: 'God', metadata: { language: 'hebrew', writingSystem: 'Hebrew', canonicalOrder: 1, verseOrder: 1 } });
    expect(localAffinityScores(a, b, weights).linguistic).toBe(0);
  });

  it('scores shared vocabulary', () => {
    const a = passage({ translation: 'mercy and compassion of the Lord' });
    const b = passage({ id: 'p2', passageKey: 'ot:Psalms:1:1', textId: 'ot', translation: 'the mercy and compassion of God' });
    expect(localAffinityScores(a, b, weights).linguistic).toBeGreaterThan(0);
  });

  it('keeps every dimension within 0-1 and the composite as their weighted sum', () => {
    const a = passage({ translation: 'mercy of the Lord', themes: [{ theme: 'mercy', score: 0.9, confidence: 0.9, evidence: [], source: 'derived' }] });
    const b = passage({ id: 'p2', passageKey: 'ot:Psalms:1:1', textId: 'ot', translation: 'the mercy of God', themes: [{ theme: 'mercy', score: 0.8, confidence: 0.8, evidence: [], source: 'derived' }] });
    const scores = localAffinityScores(a, b, weights);

    for (const value of Object.values(scores)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    const expected =
      scores.thematic * weights.thematic +
      scores.linguistic * weights.linguistic +
      scores.historical * weights.historical +
      scores.narrative * weights.narrative +
      scores.theological * weights.theological;
    expect(scores.composite).toBeCloseTo(expected, 6);
  });
});

describe('containsKeyword', () => {
  it('matches a whole word', () => {
    expect(containsKeyword('the nation of Israel', 'nation')).toBe(true);
  });

  it('does not match a keyword buried inside another word', () => {
    // "reincarnation" contains "nation", which would otherwise tag it as being
    // about community.
    expect(containsKeyword('reincarnation', 'nation')).toBe(false);
    expect(containsKeyword('reincarnation', 'car')).toBe(false);
  });

  it('does not match a stem of a longer word', () => {
    expect(containsKeyword('God is merciful', 'mercy')).toBe(false);
    expect(containsKeyword('mercy seat', 'mercy')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(containsKeyword('The LORD God', 'lord')).toBe(true);
  });

  it('handles multi-word keywords', () => {
    expect(containsKeyword('he was born of a virgin', 'born of')).toBe(true);
  });

  it('returns false for an empty keyword', () => {
    expect(containsKeyword('anything', '')).toBe(false);
  });
});

describe('localQueryTheme', () => {
  it('does not invent a theme from a substring accident', () => {
    expect(localQueryTheme('reincarnation').theme).toBeNull();
  });

  it('still recognises a genuine theme mention', () => {
    expect(localQueryTheme('passages about divine forgiveness').theme).toBe('forgiveness');
    expect(localQueryTheme('nation of Israel').theme).toBe('community');
  });

  it('returns null for a bare passage reference', () => {
    expect(localQueryTheme('john 3:16').theme).toBeNull();
  });

  it('exposes usable search terms for the chosen theme', () => {
    expect(themeSearchTerms('covenant')).toContain('covenant');
  });
});

describe('blendSearchScore', () => {
  // Default weight is 0.75 on the semantic score. Stated here so a change to
  // SEARCH_JEV_WEIGHT is a deliberate one.
  const blend = (semantic: number, text: number) => 0.75 * semantic + 0.25 * text;

  it('weights the semantic score at 0.75 and the full-text score at 0.25', () => {
    expect(blendSearchScore(1, 0)).toBeCloseTo(0.75, 10);
    expect(blendSearchScore(0, 1)).toBeCloseTo(0.25, 10);
    expect(blendSearchScore(0.4, 0.8)).toBeCloseTo(blend(0.4, 0.8), 10);
  });

  it('keeps the score strictly below 1 so results stay ordered', () => {
    // A saturating multiplier made every strong result read 100%.
    expect(blendSearchScore(0.95, 0.95)).toBeLessThan(1);
  });

  it('increases with each component', () => {
    expect(blendSearchScore(0.8, 0.2)).toBeGreaterThan(blendSearchScore(0.6, 0.2));
    expect(blendSearchScore(0.5, 0.8)).toBeGreaterThan(blendSearchScore(0.5, 0.4));
  });

  it('ties pairs whose weighted combination is equal', () => {
    // The blend is linear, so it depends on 0.75*semantic + 0.25*text rather than
    // on the plain sum. A passage strong on semantic can therefore tie one that is
    // balanced, which is the intended reading of a weighted average.
    expect(blendSearchScore(0.7, 0.7)).toBeCloseTo(blendSearchScore(0.8, 0.4), 10);
  });
});

describe('sharedPhrases', () => {
  it('returns an empty list when the texts share nothing', () => {
    expect(sharedPhrases('alpha beta gamma delta', 'epsilon zeta eta theta')).toEqual([]);
  });

  it('locates a shared run in both strings', () => {
    // The matcher needs a contiguous run of three or more words.
    const a = 'To Him belongs whatever is in the heavens and the earth';
    const b = 'And the heavens and the earth belong to Him';
    const [first] = sharedPhrases(a, b);
    expect(first).toBeDefined();
    expect(a.slice(first.startA, first.endA)).toBe(first.textA);
    expect(b.slice(first.startB, first.endB)).toBe(first.textB);
  });
});
