import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The recall measurement, and the two numbers it reports.
 *
 * For most of this work there was one figure per corpus, and the Greek one read
 * 53% while every other corpus read 93–100%. That gap drove a lot of decisions —
 * a hand-written suffix stripper, then a full transcription of the Snowball Greek
 * stemmer, then a revert of the first and an index rebuild for the second — and
 * every one of them was aimed at a number that could not answer the question.
 *
 * The measurement defined truth as passages containing the exact string that was
 * typed. A reader who types ἀνθρωποι also means ἀνθρώπων and ἀνθρώπῳ, and neither of
 * those passages contains the string they typed. So a stem-based index was being
 * scored for failing to match a form it was never asked for, and an exact index was
 * being scored for the one thing it is good at. The two cannot be separated by a
 * single figure, and the trade between them is the whole design question.
 */

const measure = readFileSync(join(__dirname, '../scripts/measure-original-recall.ts'), 'utf8');
const stem = readFileSync(join(__dirname, '../src/lib/greek-stem.ts'), 'utf8');

describe('original-language recall, as measured', () => {
  it('scores against surface forms and against meaning, separately', () => {
    expect(measure).toContain('const surface = new Map<string, Set<string>>()');
    expect(measure).toContain('const stemIndex = new Map<string, Set<string>>()');
    expect(measure).toContain('surface, within one page');
    expect(measure).toContain('concept, within one page');
  });

  it('sends the surface form as the query, because that is what a reader types', () => {
    // Stemming the query would make a stem index look perfect and an exact index
    // look broken, which is the same circularity one level up. The reader types a
    // word; making the word findable is the index's job, not the query's.
    expect(measure).toContain('query: term,');
    expect(measure).toMatch(/semantic: false,[\s\S]{0,400}expand: false,/);
  });

  it('reports one number where a script has no inflection, rather than a gap', () => {
    // Arabic, Hebrew and Aramaic have no stemmer here, so their concept set *is*
    // their surface set and both columns show the same figure. That is the correct
    // answer and not a missing measurement.
    expect(measure).toContain('const concept = /\\p{Script=Greek}/u.test(fold(term))');
  });

  it('stems Greek in the measurement and nowhere else in this file', () => {
    // The measurement's stemmer and the index's stemmer must be the same function,
    // or a passage can be a true positive for the measurement and unreachable by
    // the index it is scoring.
    expect(measure).toContain("import { stemGreek } from '../src/lib/greek-stem'");
  });
});

describe('the Greek stemmer', () => {
  it('folds the polytonic accents the published tolower misses', () => {
    // The single most important thing in this file. The spec's tolower is a
    // hand-written table for *monotonic* accents — ά έ ί ό ύ ώ — and the New
    // Testament is polytonic. τὸν, αὐτὸν and Ἰησοῦν pass through it unchanged, and
    // since every suffix rule compares against unaccented Greek, an accented word
    // matches no rule at all. Applied as published the algorithm is very nearly a
    // no-op on this corpus, which would have looked like it had worked.
    expect(stem).toContain('.normalize(\'NFD\').replace(/\\p{M}+/gu, \'\')');
  });

  it('converges the inflections of the commonest nouns', () => {
    // The reason it exists. θεός, θεοῦ, θεῷ, θεοί and θεῶν are five unrelated
    // lexemes for one word in an exact-form index.
    // (asserted behaviourally in the script run; this guards the wiring)
    expect(stem).toContain('export function stemGreek(');
    expect(stem).toContain('word.endsWith(\'οσ\')');
  });

  it('never returns an empty stem', () => {
    // Step 6 contains '{m}{ou}', so μου reduces to the empty string under the
    // canonical algorithm. In a scripture corpus μου is "my" and it is everywhere,
    // and an empty lexeme in a tsvector matches nothing usefully.
    expect(stem).toContain('if (word.length < 2) {');
    expect(stem).toContain('return foldGreek(input);');
  });

  it('splits tokens on Unicode properties, not on something that looks like them', () => {
    // The fourth measurement bug in this area, and the same failure each time: a
    // pattern that compiles, type checks, and silently measures nothing. The first
    // was a doubled backslash in a character class, which matched literal
    // backslashes and the letters p, L and M instead of Unicode properties, so every
    // passage became one token of document frequency 1. The second was
    // `algorithms('greek')` returning an empty array, which is truthy, so Greek was
    // reported as available when it was not.
    expect(stem).toContain('.split(/([^\\p{L}\\p{M}]+)/u)');
    expect(stem).not.toContain('[[:L:]]');
    expect(stem).not.toMatch(/\[\^\\\\p/);
  });
});
