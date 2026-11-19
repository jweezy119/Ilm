import { describe, expect, it } from 'vitest';
import type { Passage } from '@ilm/shared';
import { localQueryCoverage, verdictFromSilence } from '../src/services/typesafe';

function passage(translation: string, originalText = ''): Passage {
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
    metadata: { language: 'arabic', writingSystem: 'Arabic', canonicalOrder: 1, verseOrder: 1 },
    embeddings: [],
    themes: [],
    crossReferences: [],
  };
}

describe('cross-examination without a model', () => {
  it('scores by coverage of the query, on word boundaries', () => {
    const full = localQueryCoverage('mercy and forgiveness', passage(' mercy, forgiveness and guidance '));
    const partial = localQueryCoverage('mercy and forgiveness', passage(' mercy and judgement '));
    const none = localQueryCoverage('mercy and forgiveness', passage(' creation of the heavens '));

    expect(full).toBe(1);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
    expect(none).toBe(0);
  });

  it('reads the original text as well as the translation', () => {
    expect(localQueryCoverage('رحمة', passage('a translation', 'الرحمة'))).toBe(1);
  });

  it('turns coverage into the same verdict thresholds the model uses', () => {
    expect(verdictFromSilence(1 - 1)).toBe('addressed');
    expect(verdictFromSilence(1 - 0.4)).toBe('partial');
    expect(verdictFromSilence(1 - 0)).toBe('unaddressed');
  });
});
