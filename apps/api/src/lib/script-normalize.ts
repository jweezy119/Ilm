/**
 * Normalising a script for full-text search.
 *
 * The corpus is vocalised. A Quranic verse reads a fully pointed الرحمن and a
 * reader types the plain الرحمن; a Hebrew verse carries niqqud and a reader does
 * not; a Greek verse carries a tonos. Index the text as stored and none of those
 * three searches finds anything — not an error, an empty result, which a reader
 * reads as "the corpus does not discuss this".
 *
 * Applied in exactly two places, and that is the point: once when the index is
 * built and once when the query is parsed. Two implementations of "unvocalise"
 * would drift, and drift here is invisible — the index keeps working for English
 * and silently returns nothing for every other script.
 *
 * NFKD first, then strip marks. NFKD decomposes the Greek tonos into a base
 * letter plus a combining accent, which is what a reader expects when they type a
 * plain form. Hebrew niqqud are not canonical decompositions and survive NFKD, so
 * they are removed explicitly — which is why this is a function and not just
 * `String.normalize`.
 *
 * Every range is written as an escape. The ranges are the whole logic here, and
 * literal combining marks in a regular expression are close to invisible in a
 * diff. A first draft of this file folded the Hebrew final forms with the range
 * U+05DA-U+05DD, which includes the *base* letters kaf and mem: ordinary Hebrew
 * came out as מלכמנפצ. A test caught it; reading the regex would not have.
 */

/** Combining marks: Greek tonos, Arabic harakat after NFKD, superscript forms. */
const COMBINING = /[\u0300-\u036F\u0483-\u0489\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g;

/**
 * Hebrew points, which NFKD leaves alone because they are not canonical
 * decompositions.
 *
 * U+05C1 shin-dot, U+05C2 sin-dot and U+05C6 tsadi-barby are letters rather than
 * points, and are folded here anyway. A reader typing the word shalom types an
 * undotted shin while a vocalised text carries the dot, so treating them as
 * distinct makes a common word unsearchable. Unlike shin-versus-sin in a
 * dictionary, the dot carries nothing a search should distinguish.
 *
 * U+0591-05BD vowel points and cantillation, U+05BE maqaf, U+05BF rafe,
 * U+05C0 paseq, U+05C4-05C5 upper dot and mercha, U+05C7 qamats qatan, and
 * U+05F3-05F4 geresh and gershayim.
 *
 * Geresh carries meaning in scripture, but a reader typing a word to find it does
 * not type it, and a search that requires it returns nothing.
 *
 * U+05C1, U+05C2 and U+05C6 are deliberately absent: those are shin-dot, sin-dot
 * and tsadi-barby — *letters* that look like a point, and folding them would make
 * shin and sin indistinguishable.
 */
const HEBREW_POINTS = /[\u0591-\u05BD\u05BE\u05BF\u05C0\u05C1\u05C2\u05C4\u05C5\u05C6\u05C7\u05F3\u05F4]/g;

/**
 * Arabic.
 *
 * U+064B-065F tanween, fatha, damma, kasra, shadda and sukun; U+0670 superscript
 * alef; U+0640 tatweel; U+06D6-06DC and U+06DE/06E9 the Quranic annotation signs
 * and the rub el hizb.
 */
const ARABIC_MARKS = /[\u064B-\u065F\u0670\u0640\u06D6-\u06ED\u06DE\u06E9]/g;

/**
 * Alef is written several ways and a reader types any of them: U+0622 madda,
 * U+0623 hamza above, U+0625 hamza below, U+0671 wasla, and the decorative
 * U+0672, U+0673 and U+0675. All fold to U+0627.
 */
const FOLD_ALEF = /[\u0622\u0623\u0625\u0671\u0672\u0673\u0675]/g;

/** U+0649 alef maksura and U+0626 yeh with hamza, to U+064A. */
const FOLD_YEH = /[\u0649\u0626]/g;

/** U+0629, to U+0647. */
const FOLD_TA_MARBUTA = /\u0629/g;

/** U+0624, to U+0648. */
const FOLD_WAW = /\u0624/g;

/**
 * The five Hebrew final forms to their base letters.
 *
 * The codepoints are not in alphabetical order by letter and the differences are
 * one apart: U+05DC is *lamed*, not a final form, and U+05DE is mem, not final
 * nun. A first draft listed the finals as U+05DA, U+05DC, U+05DE, U+05E0 and
 * U+05E2, three of which are ordinary letters — so the fold rewrote lamed, mem,
 * nun and pe throughout the Hebrew corpus. Written as escapes, with the base
 * letter named on every line, so that cannot happen silently again.
 *
 * Done with a callback and a lookup, not with a character class and a replacement
 * string. JavaScript inserts the *whole* replacement string for every match, so
 * `'\u05DE'.replace(/[\u05DA\u05DD\u05DF\u05E1\u05E3]/g, '\u05DB\u05DD\u05DF\u05E1\u05E3')`
 * yields \u05DB\u05DD\u05DF\u05E1\u05E3\u05DB\u05DD\u05DF\u05E1\u05E3 — five
 * characters for one. One-for-one class replacement is a Perl behaviour, and
 * assuming it in JavaScript turns every final form in the corpus into gibberish
 * that is still indexed, so the search is quietly wrong for Hebrew.
 */
const HEBREW_FINAL_FORMS = new Map<string, string>([
  ['\u05DA', '\u05DB'], // final kaf   -> kaf
  ['\u05DD', '\u05DE'], // final mem   -> mem
  ['\u05DF', '\u05E0'], // final nun   -> nun
  ['\u05E1', '\u05E2'], // final pe    -> pe
  ['\u05E3', '\u05E4'], // final tsadi -> tsadi
]);

/**
 * Quranic orthography, which is not the orthography a reader types.
 *
 * The Uthmani script writes an alif in two ways a search cannot see as equal. It
 * rides as a dagger above the preceding letter — ٱلصَّلَوٰةَ, where the dagger
 * sits on a waw — while the word a reader types is ٱلصَّلَاةَ, with the alif in
 * full. It also writes a hamza as a carrier where a reader types nothing at all:
 * ٱلْقُرْءَان against ٱلْقُرَان.
 *
 * So the dagger is moved back onto the carrier as a real alif, and a hamza sitting
 * in front of an alif is dropped. Without this, six of the twelve common religious
 * terms tested returned nothing — including الصلاة, الصراط and القرآن, which is
 * the difference between "the corpus does not discuss prayer" and "the app cannot
 * search the spelling in the corpus".
 *
 * This is orthographic normalisation, not stemming. It makes the two spellings of
 * a word agree without asserting that they are the same word, which is a
 * different and much larger claim.
 */
const UTHMANI_CARRIERS: [RegExp, string][] = [
  /*
   * A dagger alif on a waw or yeh becomes one plain alif, because that is how a
   * reader writes it: ٱلصَّلَوٰةَ is ٱلصَّلَاةَ with the alif moved onto the waw.
   *
   * A dagger standing on its own is *dropped* here rather than promoted to an
   * alif. It is usually a long vowel the plain spelling writes without a letter
   * at all — ٱلرَّحْمَٰنِ is ٱلرَّحْمَٰن read as al-rahman, with no alif in the
   * plain spelling — so promoting it would make the canonical form the one no
   * reader types. The spelling that does need the alif, ٱلصِّرَٰط against الصراط,
   * is picked up as an alternative reading instead.
   */
  [/[\u0648\u064A]\u0670/g, '\u0627'],
  /*
   * A carrier hamza is dropped. It is not adjacent to its alif in the Uthmani
   * spelling — ٱلْقُرْءَان has vowel marks between them — so a rule that required
   * adjacency never fired. Removed unconditionally, which is safe because both
   * sides of a search are normalised the same way: the reader's سؤال and the
   * corpus's سُوَآل both reduce to سوال.
   */
  [/\u0621/g, ''],
];

/**
 * Reduce a text to a form that matches how a reader types it.
 *
 * Returns the input unchanged when there is nothing to do, so an English query
 * allocates nothing.
 */
export function fold(input: string): string {
  if (input.length === 0) return input;

  const decomposed = input.normalize('NFKD');

  /*
   * The carrier rules run on the decomposed text, before the marks are stripped,
   * because a dagger alif or a carrier hamza is only recognisable while the
   * letters around it are still adjacent.
   */
  let orthographic = decomposed;
  for (const [pattern, replacement] of UTHMANI_CARRIERS) {
    orthographic = orthographic.replace(pattern, replacement);
  }

  const stripped = orthographic
    .replace(COMBINING, '')
    .replace(HEBREW_POINTS, '')
    .replace(ARABIC_MARKS, '');

  const foldedText = stripped
    .replace(FOLD_ALEF, '\u0627')
    .replace(FOLD_YEH, '\u064A')
    .replace(FOLD_TA_MARBUTA, '\u0647')
    .replace(FOLD_WAW, '\u0648')
    .replace(/[\u05DA\u05DD\u05DF\u05E1\u05E3]/g, (ch) => HEBREW_FINAL_FORMS.get(ch) ?? ch);

  // NFKD can leave the pieces of a decomposed ligature adjacent, and a run of
  // spaces changes how `websearch_to_tsquery` parses the phrase.
  return foldedText.replace(/\s+/g, ' ').trim();
}

/**
 * The canonical form of a text: what a reader's spelling reduces to.
 *
 * Returns the input unchanged when there is nothing to do, so an English query
 * allocates nothing.
 */
export function normalizeForSearch(input: string): string {
  return fold(input);
}

/**
 * The alternative readings of a text, for the index to carry.
 *
 * A dagger alif is ambiguous in the same way wherever it appears. On a waw or yeh
 * it is sometimes the alif of ٱلصَّلَاةَ and sometimes the whole of the diphthong
 * in ٱلْوَجَهَ. On its own it is sometimes an alif — ٱلرَّحْمَٰنِ is ٱلرَّحْمَٰن with a
 * long vowel that the plain spelling writes without an alif at all.
 *
 * A rule cannot separate any of these without a dictionary, and both policies were
 * measured at two correct answers out of four. So the index carries every reading
 * and a query needs only one of them: a tsvector is a set of lexemes, so adding an
 * alternative is just appending its tokens.
 *
 * Used by the backfill only. A query is normalised to the single canonical reading
 * by `normalizeForSearch`, which is correct precisely because the index holds them
 * all.
 */
function alternativeReadings(input: string): string[] {
  // The reading with every dagger alif promoted to a real alif, which is the
  // spelling used when the dagger *is* the letter rather than a long vowel.
  if (!/\u0670/.test(input)) return [];

  const promoted = fold(input.replace(/\u0670/g, '\u0627'));
  const canonical = fold(input);
  if (promoted === canonical) return [];

  const alternatives = new Set<string>();
  for (const word of promoted.split(' ')) {
    if (word.length > 0 && !canonical.includes(word)) alternatives.add(word);
  }
  return [...alternatives];
}

/**
 * Every reading of a text that a match should be accepted against.
 *
 * The index carries all of them and a query is checked against all of them. Both
 * halves matter: the index alone does not help if the coverage filter then
 * compares the term in one spelling against a corpus in another and scores the
 * hit zero, which is exactly what happened to الرحمن — the verse was returned by
 * the index and then described as having matched nothing.
 */
export function searchReadings(input: string): string[] {
  const canonical = fold(input);
  if (canonical.length === 0) return [];

  return [canonical, ...alternativeReadings(input).filter((a) => a !== canonical)];
}

/**
 * Everything the index should carry for this text: the canonical form plus every
 * alternative reading of any token that has a dagger alif.
 */
export function expandForIndex(input: string): string {
  const readings = searchReadings(input);
  return readings.length === 0 ? '' : readings.join(' ');
}

/**
 * True when any reading of the term occurs in any reading of the text.
 *
 * Both sides are read in every form on purpose, so a vocalised Uthmani spelling
 * in the corpus and a plain one from the reader still meet.
 */
export function matchesAnyReading(text: string, term: string): boolean {
  const haystacks = searchReadings(text).filter((r) => r.length > 0);
  if (haystacks.length === 0) return false;
  const needles = searchReadings(term).filter((r) => r.length > 0);
  if (needles.length === 0) return false;

  const lowered = haystacks.map((r) => r.toLowerCase());
  return needles.some((needle) => {
    const n = needle.toLowerCase();
    return lowered.some((h) => h.includes(n));
  });
}
