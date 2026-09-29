import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Original-language search.
 *
 * The corpus is 23% non-English by verse count and was entirely unsearchable in
 * its own script: `search_vector` is built with the 'english' configuration over
 * the English translation, so a reader searching الرحمن was shown the empty state,
 * which reads as "the corpus does not discuss this" rather than "the app cannot
 * search Arabic".
 *
 * These assertions are about the code's shape, not its results, because the
 * results live in a database a unit test cannot see. The measured recall is in
 * the commit message: 18 common Arabic terms, 8 Hebrew, 5 Greek.
 */

const postgres = readFileSync(join(__dirname, '../src/search/postgres.ts'), 'utf8');
const search = readFileSync(join(__dirname, '../src/services/search.ts'), 'utf8');
const backfill = readFileSync(join(__dirname, '../scripts/index-original-text.ts'), 'utf8');

function code(of: string): string {
  return of.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('original-language search', () => {
  it('queries a second vector, not the English one twice', () => {
    expect(code(postgres)).toContain("websearch_to_tsquery('simple', ${normalizeForSearch(query)})");
    expect(code(postgres)).toContain('p.search_vector_original');
  });

  it('normalises the query with the same function the index used', () => {
    // Two implementations of "unvocalise" would drift, and the drift is invisible:
    // English keeps working and every other script silently returns nothing.
    const indexImport = code(backfill).includes('expandForIndex');
    expect(indexImport).toBe(true);
    expect(code(postgres)).toContain('normalizeForSearch');
  });

  it('matches either vector, and sums both ranks', () => {
    // A passage matching the term in its original *and* its translation is a
    // better answer than one matching in either, and picking the larger rank
    // would throw away the evidence for half the corpus.
    expect(code(postgres)).toContain('p.search_vector @@ ${tsq} OR p.search_vector_original @@ ${origQ}');
    expect(code(postgres)).toContain('ts_rank_cd(p.search_vector, ${tsq}) + ts_rank_cd(p.search_vector_original, ${origQ})');
  });

  it('says which field matched, rather than leaving it to be inferred', () => {
    // A reader who searched a Hebrew word and is shown an English translation has
    // no way to tell whether the match was real or a keyword overlap in a
    // paraphrase.
    expect(code(postgres)).toContain('AS matched_original');
    expect(code(postgres)).toContain('AS matched_translation');
    expect(code(postgres)).toContain('matchedIn');
  });

  it('scores coverage against the original text too', () => {
    /*
     * The bug this guards, and the subtlest of the whole change.
     *
     * The index matched الرحمن and returned the verse; then `termCoverage` checked
     * the English translation only, scored the hit zero, and the "a passage that
     * contains none of the query's words is not a weak match" filter threw the
     * verse away. Search appeared to work — the total was right — and returned
     * nothing. Coverage has to read the same fields the index reads.
     */
    expect(code(search)).toContain('matchesAnyReading(passage.originalText');
  });

  it('accepts any reading on both sides of a comparison', () => {
    // Both the text and the term are compared in every reading, or the canonical
    // form of one meets a non-canonical form of the other and misses.
    expect(code(search)).toContain('matchesAnyReading');
  });

  it('reports an original-only match as such', () => {
    expect(code(search)).toContain("fields.push('original')");
  });

  it('builds the vector with the simple configuration, at the point it is built', () => {
    // Not a language configuration: there is no `hebrew` configuration in this
    // database, and stemming strips the prefixes that carry Arabic meaning.
    expect(code(backfill)).toContain("to_tsvector('simple'");
  });

  it('populates the column from a script, not from the migration', () => {
    // The normalisation is TypeScript. A SQL copy of those ranges in the migration
    // would be a second implementation of the one rule that decides whether
    // Arabic search works at all.
    expect(code(backfill)).toContain('search_vector_original IS NULL');
    expect(code(backfill)).toContain('CREATE INDEX IF NOT EXISTS passages_search_vector_original_idx');
  });

  it('is re-runnable and bounded', () => {
    expect(code(backfill)).toContain('const BATCH = 500');
    expect(code(backfill)).toContain('--reindex');
  });

  it('leaves English search exactly as it was', () => {
    // The one regression to fear: the english vector, the english configuration
    // and the trigram typo pass must all be untouched.
    expect(code(postgres)).toContain("websearch_to_tsquery('english', ${query})");
    expect(code(postgres)).toContain('p.primary_translation %>>');
  });
});
