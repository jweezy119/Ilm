import { describe, expect, it } from 'vitest';
import { segmentByPhrases, mergeAdjacent, sharedPhrases, escapeRegExp } from './highlighter';

describe('segmentByPhrases', () => {
  it('returns a single plain segment when there is nothing to mark', () => {
    expect(segmentByPhrases('plain text', [{ phrase: 'absent' }])).toEqual([
      { text: 'plain text', highlighted: false },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(segmentByPhrases('', [{ phrase: 'x' }])).toEqual([]);
  });

  it('marks the matching phrase and leaves the rest plain', () => {
    const segments = segmentByPhrases('the heavens and the earth', [{ phrase: 'heavens and', alignmentId: 'a', type: 'quote' }]);

    expect(segments).toEqual([
      { text: 'the ', highlighted: false },
      { text: 'heavens and', highlighted: true, alignmentId: 'a', type: 'quote' },
      { text: ' the earth', highlighted: false },
    ]);
  });

  it('prefers the longest phrase so a short match does not split a long one', () => {
    const segments = segmentByPhrases('light of the world', [
      { phrase: 'of' },
      { phrase: 'light of the world', alignmentId: 'b' },
    ]);

    const highlighted = segments.filter((s) => s.highlighted);
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].text).toBe('light of the world');
  });

  it('matches case-insensitively but preserves the original casing', () => {
    const segments = segmentByPhrases('The LORD is God', [{ phrase: 'lord' }]);
    const highlighted = segments.find((s) => s.highlighted);
    expect(highlighted?.text).toBe('LORD');
  });

  it('treats phrase characters as literal text, not a pattern', () => {
    // Long enough to clear the default minLength of 4.
    const segments = segmentByPhrases('he gave them (wisdom) and', [{ phrase: '(wisdom)' }]);
    expect(segments.find((s) => s.highlighted)?.text).toBe('(wisdom)');
  });

  it('ignores phrases shorter than minLength', () => {
    expect(segmentByPhrases('ab cd', [{ phrase: 'ab' }], 3)).toEqual([{ text: 'ab cd', highlighted: false }]);
  });
});

describe('mergeAdjacent', () => {
  it('joins neighbours that share a highlight state and type', () => {
    const merged = mergeAdjacent([
      { text: 'a', highlighted: true, type: 'quote' },
      { text: 'b', highlighted: true, type: 'quote' },
    ]);
    expect(merged).toEqual([{ text: 'ab', highlighted: true, type: 'quote' }]);
  });

  it('keeps segments separate when the type differs', () => {
    const merged = mergeAdjacent([
      { text: 'a', highlighted: true, type: 'quote' },
      { text: 'b', highlighted: true, type: 'allusion' },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('sharedPhrases', () => {
  it('finds a phrase present in both texts with its offsets', () => {
    // A contiguous run of three or more words is required.
    const a = 'To Him belongs whatever is in the heavens';
    const b = 'Whatever is in the heavens belongs to Him';
    const found = sharedPhrases(a, b);

    expect(found.length).toBeGreaterThan(0);
    expect(found[0].textA).toBe(a.slice(found[0].indexA, found[0].indexA + found[0].textA.length));
    expect(found[0].textB).toBe(b.slice(found[0].indexB, found[0].indexB + found[0].textB.length));
    expect(found[0].textA.toLowerCase()).toBe(found[0].phrase);
  });

  it('returns nothing when the texts share no three-word run', () => {
    expect(sharedPhrases('alpha beta gamma', 'delta epsilon zeta')).toEqual([]);
  });

  it('returns distinct phrases only, longest first', () => {
    const text = 'wisdom hath founded the earth and understanding established the heavens';
    const found = sharedPhrases(text, text);
    const phrases = found.map((f) => f.phrase);
    expect(new Set(phrases).size).toBe(phrases.length);
    for (let i = 1; i < phrases.length; i += 1) {
      expect(phrases[i - 1].length).toBeGreaterThanOrEqual(phrases[i].length);
    }
  });

  it('reports each text\'s own casing for the same match', () => {
    const [first] = sharedPhrases('to him belongs the earth', 'To Him belongs the Earth');
    expect(first.textA).toBe('to him belongs the earth');
    expect(first.textB).toBe('To Him belongs the Earth');
    expect(first.phrase).toBe(first.textA.toLowerCase());
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
  });
});
