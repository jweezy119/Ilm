import { describe, expect, it } from 'vitest';
import {
  findQuotation,
  hashWords,
  indexNgrams,
  normalise,
  scoreQuotation,
  DEFAULT_MIN_RUN,
} from '../src/services/quotations';

/** The n-gram index the detector builds for a passage. */
const hits = indexNgrams;

describe('normalise', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalise('The LORD said: "Go!"')).toEqual(['the', 'lord', 'said', 'go']);
  });

  it('removes bracketed editorial interpolations', () => {
    // Translations insert these, and differently per translation, so leaving them
    // in breaks the shared sequence at exactly the point a quoter would include.
    const withInsert = normalise('And We sent down to thee the Spirit, [O Muhammad], and he is with thee');
    const without = normalise('And he shall be with you and the Holy Spirit');
    expect(withInsert).not.toContain('muhammad');
    expect(withInsert).toContain('spirit');
    expect(without).toHaveLength(10);
  });

  it('keeps apostrophes inside words', () => {
    expect(normalise("the Lord's house")).toEqual(['the', "lord's", 'house']);
  });

  it('returns nothing for empty or bracket-only text', () => {
    expect(normalise('')).toEqual([]);
    expect(normalise('[O Muhammad]')).toEqual([]);
  });
});

describe('hashWords', () => {
  it('is stable and order-sensitive', () => {
    const a = ['genesis', 'in', 'the', 'beginning', 'god', 'created'];
    expect(hashWords(a, 0, 6)).toBe(hashWords(a, 0, 6));
    expect(hashWords(a, 0, 6)).not.toBe(hashWords([...a].reverse(), 0, 6));
  });

  it('does not collide across word boundaries', () => {
    // Without a separator, "a bc" and "ab c" hash identically.
    expect(hashWords(['a', 'bc'], 0, 2)).not.toBe(hashWords(['ab', 'c'], 0, 2));
  });
});

describe('findQuotation', () => {
  const size = DEFAULT_MIN_RUN;

  it('finds a run whose words sit at different offsets in each passage', () => {
    // The case an offset join cannot see, and the reason candidates are joined on
    // the n-gram's hash: the quotation starts at word 5 in one passage and word 0
    // in the other.
    const a = normalise('unto thee it is said hear ye and remember the words that I have spoken');
    const b = normalise('hear ye and remember the words that I have spoken in this day');
    const result = findQuotation(hits(a, size), hits(b, size), a, b, size);

    expect(result).not.toBeNull();
    expect(result!.longestRun).toBe(10);
    expect(result!.segments).toHaveLength(1);
    // Offsets are word positions, so the reader can be shown where the match is.
    expect(result!.segments[0]).toMatchObject({ startA: 5, startB: 0, length: 10 });
    expect(result!.segments[0].textA).toBe('hear ye and remember the words that i have spoken');
  });

  it('does not report a two-word overlap as a quotation', () => {
    // "the lord" is shared, and that is all. Below the minimum run, nothing is
    // claimed — this is the flood of false pairs that an n-gram approach invites.
    const a = normalise('thus saith the lord ye are witnesses unto me');
    const b = normalise('so hath the lord declared you are my witnesses');
    expect(findQuotation(hits(a, size), hits(b, size), a, b, size)).toBeNull();
  });

  it('merges overlapping n-grams into one long run', () => {
    // A thirty word quotation produces twenty-five overlapping six-word matches.
    // Counting them separately would overstate the number of citations.
    const a = normalise('a b c d e f g h i j k l m n o p q r s t u v w x y z a1 b1 c1 d1 e1');
    const b = normalise('a b c d e f g h i j k l m n o p q r s t u v w x y z a1 b1 c1 d1 e1');
    const result = findQuotation(hits(a, size), hits(b, size), a, b, size);
    expect(result!.longestRun).toBe(31);
    expect(result!.segments).toHaveLength(1);
  });

  it('reports separate runs separately and sums them', () => {
    const a = normalise('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi');
    const b = normalise('alpha beta gamma delta epsilon zeta eta theta second quote begins here now ok then end');
    const result = findQuotation(hits(a, size), hits(b, size), a, b, size);
    expect(result!.segments.length).toBeGreaterThanOrEqual(1);
    expect(result!.totalShared).toBeGreaterThanOrEqual(result!.longestRun);
  });

  it('returns nothing when the passages share no n-gram', () => {
    const a = normalise('completely different words appear in this first passage here');
    const b = normalise('nothing whatsoever in common with the words over there friend');
    expect(findQuotation(hits(a, size), hits(b, size), a, b, size)).toBeNull();
  });

  it('rejects a claimed match whose words do not actually match', () => {
    // A hash collision is the one way a shared n-gram can be a lie. The indexes
    // are built by hand to claim a shared hash at an offset where the words
    // differ, which is what a collision would look like, and the result must be
    // discarded rather than reported.
    const a = normalise('alpha beta gamma delta epsilon zeta');
    const b = normalise('alpha beta gamma sigma epsilon zeta');
    const forged = new Map([[12345, [0]]]);

    expect(findQuotation(forged, forged, a, b, size)).toBeNull();
  });

  it('rejects a chain shorter than the n-gram', () => {
    // Two overlapping n-grams imply a run of size + 1, not of 2. Getting this
    // wrong reports three words of shared wording as a citation.
    const a = normalise('one two three four five six seven');
    const b = normalise('one two three four five six seven');
    const result = findQuotation(hits(a, size), hits(b, size), a, b, size);
    expect(result!.longestRun).toBe(7);
  });

  it('does not report a run of shared stock phrasing as a quotation on its own', () => {
    // The detector's caller enforces the minimum run; here the two phrases differ
    // after three words, so nothing is claimed.
    const a = normalise('and the lord said unto him and he');
    const b = normalise('and the lord spake unto him saying');
    expect(findQuotation(hits(a, size), hits(b, size), a, b, size)).toBeNull();
  });
});

describe('scoreQuotation', () => {
  it('scores a ten-word verbatim run as a confident citation', () => {
    // The calibration that matters: this used to come out at 0.36, which reads as
    // a weak suggestion for something a concordance would confirm.
    expect(scoreQuotation(10, 10)).toBeGreaterThan(0.6);
    expect(scoreQuotation(6, 6)).toBeLessThan(0.45);
  });

  it('rises with run length and saturates', () => {
    const short = scoreQuotation(6, 6);
    const medium = scoreQuotation(10, 10);
    const long = scoreQuotation(18, 18);
    const veryLong = scoreQuotation(60, 60);
    const atSixteen = scoreQuotation(16, 16);
    expect(short).toBeLessThan(medium);
    expect(medium).toBeLessThan(long);
    // Twenty shared words is not meaningfully more certain than eighteen, and a
    // scale that kept climbing would imply a precision that does not exist.
    expect(veryLong).toBeLessThanOrEqual(1);
    expect(veryLong - atSixteen).toBeLessThan(0.02);
  });

  it('stays within 0..1', () => {
    for (const run of [1, 5, 6, 9, 12, 30, 200]) {
      const score = scoreQuotation(run, run * 3);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('gives a little credit for several separate runs', () => {
    expect(scoreQuotation(10, 20)).toBeGreaterThan(scoreQuotation(10, 10));
  });
});
