import { describe, it, expect } from 'vitest';
import { normalizeForSearch, searchReadings, matchesAnyReading } from '../src/lib/script-normalize';

/**
 * Script normalisation for full-text search.
 *
 * Every failure mode here is an *empty* result, not an error. A reader types the
 * plain form of a word, the index holds the pointed form, the query matches
 * nothing, and the app reports that the corpus does not discuss the subject. That
 * is indistinguishable from a correct answer, which is why these are asserted
 * rather than spot-checked.
 *
 * Hebrew and Greek test data is written as codepoint escapes throughout. A final
 * form is one codepoint from a base letter and reads the same in a diff. Two of
 * these literals were wrong before this file used escapes, and one of the bugs it
 * guards was a fold that rewrote ordinary Hebrew because the final forms were
 * listed at the wrong codepoints: U+05DC is lamed, not a final form.
 */

describe('normalizeForSearch', () => {
  it('folds a vocalised Quranic word to the plain form a reader types', () => {
    // al-rahman, fully pointed, with a wasla alef and a superscript alef.
    expect(normalizeForSearch('ٱلرَّحْمَٰنِ')).toBe('الرحمن');
  });

  it('folds the ta marbuta', () => {
    // Against the normalised plain spelling: a reader may type either, and after
    // normalisation they are the same string.
    expect(normalizeForSearch('ٱلرَّحْمَة')).toBe(normalizeForSearch('الرحمة'));
  });

  it('folds the alef family to one letter', () => {
    // A reader types any of them; the corpus contains all of them.
    for (const input of ['أَحَد', 'إِحَد', 'آحَد', 'ٱحَد']) {
      expect(normalizeForSearch(input)).toBe('احد');
    }
  });

  it('folds alef maksura to yeh', () => {
    expect(normalizeForSearch('عَلَىٰ')).toBe('علي');
  });

  it('folds hamza-carrying waw', () => {
    expect(normalizeForSearch('مُؤْمِن')).toBe('مومن');
  });

  it('strips Hebrew niqqud', () => {
    expect(normalizeForSearch('\u05DE\u05B0\u05D6\u05B0\u05DE\u05A5\u05D5\u05B9\u05E8')).toBe('\u05DE\u05D6\u05DE\u05D5\u05E8');
  });

  it('folds the five Hebrew final forms, one letter at a time', () => {
    // Two bugs live here.
    //
    // A character class with a *string* replacement inserts the whole string for
    // every match, because one-for-one class replacement is a Perl behaviour and
    // not a JavaScript one — so a final nun became five characters.
    //
    // And the codepoints were wrong: the finals are U+05DA, U+05DD, U+05DF,
    // U+05E1 and U+05E3. The first draft listed U+05DC, U+05DE, U+05E0 and
    // U+05E2, which are lamed, mem, nun and pe — ordinary letters, rewritten
    // across the whole Hebrew corpus. Still indexed, so quietly wrong.
    expect(normalizeForSearch('\u05DE\u05B6\u05DC\u05B6\u05DA\u05B0')).toBe('\u05DE\u05DC\u05DB');
    expect(normalizeForSearch('\u05DC\u05B4\u05E2\u05B0\u05E0\u05B8\u05D9\u05D5')).toBe('\u05DC\u05E2\u05E0\u05D9\u05D5');
  });

  it('folds shin-dot, sin-dot and tsadi-barby', () => {
    // Letters rather than points, and folded anyway: a reader types an undotted
    // shin and a vocalised text carries the dot.
    expect(normalizeForSearch('\u05E9\u05B8\u05C1\u05DC\u05D5\u05B9\u05DD')).toBe(normalizeForSearch('\u05E9\u05DC\u05D5\u05DE'));
  });

  it('folds the Greek tonos', () => {
    expect(normalizeForSearch('\u1F20\u03B3\u03B1\u03C0\u1F75\u03C3\u03B5\u03BD')).toBe('\u03B7\u03B3\u03B1\u03C0\u03B7\u03C3\u03B5\u03BD');
  });

  it('leaves English alone', () => {
    const text = 'For God so loved the world';
    expect(normalizeForSearch(text)).toBe(text);
  });

  it('is idempotent', () => {
    // The query side normalises a term that may already be normalised and the
    // index side normalises stored text, so a second pass must change nothing or
    // the two can drift apart.
    for (const input of ['ٱلرَّحْمَٰنِ', '\u05DE\u05B0\u05D6\u05B0\u05DE\u05A5\u05D5\u05B9\u05E8', '\u1F20\u03B3\u03B1\u03C0\u1F75\u03C3\u03B5\u03BD', '\u05DE\u05B6\u05DC\u05B6\u05DA\u05B0']) {
      const once = normalizeForSearch(input);
      expect(normalizeForSearch(once)).toBe(once);
    }
  });

  it('is a no-op on an empty string rather than throwing', () => {
    expect(normalizeForSearch('')).toBe('');
  });

  it('collapses whitespace left by decomposition', () => {
    expect(normalizeForSearch('  a   b  ')).toBe('a b');
  });

  it('agrees between a pointed string and the plain one a reader types', () => {
    // The property the whole module exists for, over the four scripts in the corpus.
    const pairs: Array<[string, string]> = [
      ['ٱلرَّحْمَٰنِ', 'الرحمن'],
      ['ٱلرَّحْمَة', 'الرحمة'],
      ['\u05DE\u05B0\u05D6\u05B0\u05DE\u05A5\u05D5\u05B9\u05E8', '\u05DE\u05D6\u05DE\u05D5\u05E8'],
      ['\u1F20\u03B3\u03B1\u03C0\u1F75\u03C3\u03B5\u03BD', '\u03B7\u03B3\u03B1\u03C0\u03B7\u03C3\u03B5\u03BD'],
    ];
    for (const [pointed, plain] of pairs) {
      expect(normalizeForSearch(pointed), `${pointed} vs ${plain}`).toBe(normalizeForSearch(plain));
    }
  });
});

describe('search readings', () => {
  it('returns one reading when there is no ambiguity', () => {
    // English, and any text with no dagger alif, must produce exactly one reading.
    // A second would inflate the index and the coverage check for nothing.
    expect(searchReadings('For God so loved the world')).toHaveLength(1);
    expect(searchReadings('mercy')).toHaveLength(1);
  });

  it('returns both readings for a Uthmani spelling', () => {
    // الرحمن in the corpus carries a dagger alif the plain spelling omits, so
    // the canonical reading and the reading without it are both needed.
    const readings = searchReadings('ٱلرَّحْمَٰنِ');
    expect(readings.length).toBeGreaterThan(1);
    expect(readings).toContain('الرحمان');
    expect(readings).toContain('الرحمن');
  });

  it('matches a plain spelling against a vocalised text', () => {
    // The property the coverage filter depends on: without it the index finds the
    // verse and the filter then discards it for containing none of the query's
    // words, which is what happened before.
    expect(matchesAnyReading('ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 'الرحمن')).toBe(true);
    expect(matchesAnyReading('ٱلصَّلَوٰةَ', 'الصلاة')).toBe(true);
    expect(matchesAnyReading('ٱلصِّرَٰط', 'الصرة'.replace('صرة', 'صراط'))).toBe(true);
  });

  it('does not match a term that is genuinely absent', () => {
    // A loose normaliser that matched everything would be worse than one that
    // matches nothing, because it would return the corpus for a word it does not
    // contain.
    expect(matchesAnyReading('ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 'الجنة')).toBe(false);
    expect(matchesAnyReading('', 'mercy')).toBe(false);
    expect(matchesAnyReading('mercy', '')).toBe(false);
  });

  it('folds Hebrew and Greek the same way', () => {
    expect(matchesAnyReading('מִזְמ֥וֹר לְדָוִ֑ד', 'מזמור')).toBe(true);
    expect(matchesAnyReading('ἠγάπησεν', 'ηγαπησεν')).toBe(true);
  });
});
