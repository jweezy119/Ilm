import { describe, expect, it } from 'vitest';
import { isLexiconCandidate, normalizeHebrewWord } from '../src/services/lexicon';

describe('normalizeHebrewWord', () => {
  it('strips vowel points so one root is one lookup', () => {
    // Same root, three vocalisations. Without stripping these are three requests
    // and three cache rows for the same word.
    expect(normalizeHebrewWord('חֶסֶד')).toBe(normalizeHebrewWord('חָסֵד'));
    expect(normalizeHebrewWord('וַיֹּאמֶר')).toBe(normalizeHebrewWord('ויאמר'));
  });

  it('strips cantillation accents, which are chanting marks not letters', () => {
    // Genesis 1:1 as it comes back from Sefaria, accents included.
    expect(normalizeHebrewWord('בְּרֵאשִׁ֖ית')).toBe('בראשית');
    expect(normalizeHebrewWord('אֱלֹהִ֑ים')).toBe('אלהים');
  });

  it('treats a maqaf-joined compound as one word', () => {
    // Vowels is one token joined by U+05BE, not two.
    expect(normalizeHebrewWord('עַל־פְּנֵיהֶ֑ם')).toBe('עלפניהם');
  });

  it('leaves an unpointed word alone', () => {
    expect(normalizeHebrewWord('משה')).toBe('משה');
  });
});

describe('isLexiconCandidate', () => {
  it('accepts a pointed Hebrew word', () => {
    expect(isLexiconCandidate('חֶסֶד')).toBe(true);
  });

  it('rejects single letters, which are prefixes and particles', () => {
    // The vav prefix and the bet preposition are the most common tokens in the
    // corpus and no lexicon has them. Rejecting here means they never reach the
    // network at all.
    expect(isLexiconCandidate('וּ')).toBe(false);
    expect(isLexiconCandidate('וַ')).toBe(false);
    expect(isLexiconCandidate('בְּ')).toBe(false);
  });

  it('rejects words with no Hebrew letters', () => {
    expect(isLexiconCandidate('mercy')).toBe(false);
    expect(isLexiconCandidate('رحمة')).toBe(false);
    expect(isLexiconCandidate('λόγος')).toBe(false);
  });
});
