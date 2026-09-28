/**
 * Quotation and lineage detection.
 *
 * Sacred texts quote each other constantly, and the existing cross-reference table
 * had 34 rows for 45,453 passages — which is to say it had almost none. The
 * passages that matter most in this corpus are recognisable because they share
 * long, rare word sequences with a passage elsewhere: Amos 5 in Acts 17, Genesis
 * 12 in Galatians, Isaiah 53 in Mark 15.
 *
 * This finds them by n-gram matching rather than by asking a model. That is a
 * deliberate choice, not a cheap one:
 *
 *   - It is verifiable. Every claim carries the exact matched strings and their
 *     offsets, so a reader can open both passages and check. A model cannot offer
 *     that, and on this particular question models are confidently wrong in ways
 *     that are hard to catch, because a fabricated quotation looks exactly like a
 *     real one.
 *   - It costs nothing per call and needs no key.
 *   - It has a principled precision/recall dial: the n-gram size.
 *
 * The hard part is not finding shared words. It is not reporting every pair of
 * passages that both contain "the lord said unto him", which is why a minimum run
 * length and a document-frequency ceiling are the two parameters that matter.
 */

/** Words of contiguous overlap required before a pair is called a quotation. */
export const DEFAULT_MIN_RUN = 6;

/**
 * An n-gram appearing in more passages than this is treated as stock phrasing
 * and ignored. Without the ceiling, "and he said unto him" links thousands of
 * passages and the output is worthless.
 */
export const DEFAULT_MAX_DOCUMENT_FREQUENCY = 8;

export interface NormalisedPassage {
  words: string[];
  /** Original text, kept so matched segments can quote what was actually said. */
  raw: string;
}

/**
 * Reduce a translation to comparable words.
 *
 * Three things are removed, and each one would otherwise cost real quotations:
 *
 *   Bracketed interpolations. Translations insert "O Muhammad", "Jesus", "the
 *   Christ" into verses, and differently per translation. Left in, the shared
 *   sequence between a Hebrew and an English witness of the same verse is broken
 *   at exactly the point a quoter would have included it.
 *
 *   Punctuation and case. Attributive "the LORD" and "the Lord" are the same word.
 *
 *   The square-bracket markers themselves, which are editorial, not textual.
 */
export function normalise(text: string): string[] {
  return text
    // Square brackets contain editorial insertions, never part of the verse.
    .replace(/\[[^\]]*\]/g, ' ')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * A 32-bit hash of a word sequence.
 *
 * Hashing rather than storing the strings keeps the index small enough to run over
 * the whole corpus at once: ~1.1M n-grams of strings is a few hundred megabytes,
 * of 32-bit ints it is about 5 MB. Collisions are possible and acceptable — a
 * collision can only ever add a candidate pair, never a matched segment, because
 * the text is compared directly afterwards.
 */
export function hashWords(words: string[], start: number, size: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < size; i += 1) {
    const word = words[start + i];
    for (let c = 0; c < word.length; c += 1) {
      h ^= word.charCodeAt(c);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2f; // separator, so "a bc" and "ab c" differ
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface CandidateHit {
  passageIndex: number;
  /** Word offset of the n-gram within that passage. */
  offset: number;
  /** Hash of the n-gram. Shared n-grams are found by matching these, not offsets. */
  hash: number;
}

/**
 * Index every n-gram in a passage: hash to the offsets where it occurs.
 *
 * Joining candidates on *offset* is the obvious thing and it is wrong — the same
 * quotation sits at a different word position in each passage, so an offset join
 * only ever finds a quote that happens to start at the same index. Joining on the
 * n-gram's hash is what actually identifies shared wording.
 */
export function indexNgrams(words: string[], size: number): Map<number, number[]> {
  const index = new Map<number, number[]>();
  for (let i = 0; i + size <= words.length; i += 1) {
    const hash = hashWords(words, i, size);
    const offsets = index.get(hash);
    if (offsets) offsets.push(i);
    else index.set(hash, [i]);
  }
  return index;
}

export interface QuotationCandidate {
  /** Longest run of contiguous shared words, in words. */
  longestRun: number;
  /** Total shared words across all runs, which rewards several separate quotes. */
  totalShared: number;
  segments: MatchedSegment[];
}

export interface MatchedSegment {
  textA: string;
  textB: string;
  startA: number;
  startB: number;
  /** Length of this run, in words. */
  length: number;
}

/**
 * Find quotations between two passages, given their n-gram indexes.
 *
 * Offsets are merged into maximal runs because a quoter copies a phrase, not a
 * scatter of n-grams: five overlapping six-word matches in a row is one thirty
 * word quotation, and treating it as five separate ones would both overstate the
 * number of citations and understate their length.
 *
 * Three things are checked before anything is reported, because the failure mode
 * of this approach is a flood of false pairs:
 *
 *   1. The words are compared directly, so a hash collision cannot become a
 *      matched segment.
 *   2. A run must be at least `size` words long. A shorter chain of n-grams is a
 *      run of three words that happens to sit inside a six-word window, not a
 *      quotation.
 *   3. Runs are only merged while both offsets advance together. A constant gap is
 *      what makes it contiguous.
 */
export function findQuotation(
  aIndex: Map<number, number[]>,
  bIndex: Map<number, number[]>,
  aWords: string[],
  bWords: string[],
  size: number
): QuotationCandidate | null {
  // Every (offsetA, offsetB) pair that shares an n-gram.
  const pairs: Array<{ offA: number; offB: number }> = [];
  for (const [hash, aOffsets] of aIndex) {
    const bOffsets = bIndex.get(hash);
    if (!bOffsets) continue;
    for (const offA of aOffsets) {
      for (const offB of bOffsets) pairs.push({ offA, offB });
    }
  }
  if (pairs.length === 0) return null;

  pairs.sort((x, y) => x.offA - y.offA || x.offB - y.offB);

  type Run = { startA: number; startB: number; pairs: number };
  const runs: Run[] = [];
  let current: Run = { startA: pairs[0].offA, startB: pairs[0].offB, pairs: 1 };
  for (const pair of pairs.slice(1)) {
    const contiguous = pair.offA === current.startA + current.pairs && pair.offB === current.startB + current.pairs;
    if (contiguous) {
      current.pairs += 1;
      continue;
    }
    runs.push(current);
    current = { startA: pair.offA, startB: pair.offB, pairs: 1 };
  }
  runs.push(current);

  // n consecutive overlapping n-grams span n + size - 1 words.
  const verified = runs
    .map((run) => ({
      startA: run.startA,
      startB: run.startB,
      length: run.pairs + size - 1,
    }))
    .filter((run) => {
      if (run.length < size) return false;
      for (let i = 0; i < run.length; i += 1) {
        if (aWords[run.startA + i] !== bWords[run.startB + i]) return false;
      }
      return true;
    });
  if (verified.length === 0) return null;

  const longestRun = verified.reduce((max, run) => Math.max(max, run.length), 0);
  const totalShared = verified.reduce((sum, run) => sum + run.length, 0);

  return {
    longestRun,
    totalShared,
    segments: verified.map((run) => ({
      textA: aWords.slice(run.startA, run.startA + run.length).join(' '),
      textB: bWords.slice(run.startB, run.startB + run.length).join(' '),
      startA: run.startA,
      startB: run.startB,
      length: run.length,
    })),
  };
}

/**
 * Confidence for a detected quotation.
 *
 * Length carries most of the weight, because a long verbatim run is what
 * distinguishes a quotation from shared idiom. It saturates rather than growing
 * without limit, because the difference between 12 and 20 shared words is much
 * less significant than between 6 and 12, and a scale that does not saturate would
 * report a 60-word match as more certain than a 12-word one and imply a precision
 * that does not exist.
 */
export function scoreQuotation(longestRun: number, totalShared: number): number {
  /*
   * Calibrated against what the runs actually look like, not chosen to look
   * reasonable.
   *
   * The first version put a ten-word verbatim run at 0.36, which is a confident
   * citation rendered as a weak suggestion — the worst of both, because the reader
   * discounts a real finding and is invited to trust a longer one that may be
   * formulaic. Measuring the corpus put the marks where they belong:
   *
   *   6 words   the shortest run that clears shared idiom   ~0.30
   *   10 words  unmistakably a citation                     ~0.67
   *   14 words  would check this against a concordance     ~0.90
   *   16+ words saturation, where more words stop meaning more
   *
   * The square root is what gives the low end room: the gap between 6 and 10 words
   * matters far more than the gap between 14 and 18, and a linear scale would
   * report the latter as the confident one.
   */
  const linear = Math.min(1, Math.max(0, (longestRun - 5) / 11));
  const byLength = Math.sqrt(linear);
  // Additional separate runs are weak corroboration: a text that quotes twice is
  // a little more certain than one that quotes once, not a different claim.
  const corroboration = Math.min(0.08, Math.max(0, totalShared - longestRun) / 80);
  return Math.min(1, Number((byLength + corroboration).toFixed(4)));
}
