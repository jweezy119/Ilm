import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The citations endpoint.
 *
 * The dangerous failure here is not an error, it is a confident wrong claim. A
 * citation is a pair of passages with no ordering between them, so anything that
 * infers direction produces a statement about lineage that the data cannot support
 * — and a reader who catches one has cause to distrust the other 3,688. These
 * tests guard the two ways that could happen: saying who quotes whom in the copy,
 * and filtering the wrong rows out.
 */

const citations = readFileSync(join(__dirname, '../src/services/citations.ts'), 'utf8');
const crossrefs = readFileSync(join(__dirname, '../src/services/crossrefs.ts'), 'utf8');

/** Comments explain the decisions; the assertions have to be about the code. */
function code(of: string): string {
  return of.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('citations', () => {
  it('claims no direction', () => {
    // The stored direction is 'bidirectional' on purpose. Any word implying
    // lineage in the response — "quotes", "cites", "borrows", "derived from" — is
    // a claim the pair cannot support.
    const body = code(citations);
    for (const word of ['quotes', 'cites', 'borrows', 'derivedFrom', 'sourceOf']) {
      expect(body.toLowerCase(), `response code contains "${word}"`).not.toContain(word);
    }
  });

  it('returns both texts so a reader can check the claim', () => {
    // The stored matched string is the whole reason this data is worth keeping.
    // An endpoint that returns only "these are related" has thrown away the only
    // checkable part.
    const body = code(citations);
    expect(body).toContain('ownText');
    expect(body).toContain('otherText');
    expect(body).toContain('sharedText');
  });

  it('serves only cross-corpus quotations', () => {
    const body = code(citations);
    expect(body).toContain("const CITATION_TYPE = 'quotation'");
    // parallel and duplicate are real matches and are not errors, but neither is
    // lineage, and 44,000 of them would bury the 3,689 that are.
    expect(body).not.toContain("'parallel'");
    expect(body).not.toContain("'duplicate'");
  });

  it('filters inside the query, not after it', () => {
    // `take` runs before any filtering. Filtering afterwards would return eight
    // rows of which none are citations and the page would look empty rather than
    // quiet — the exact failure this endpoint exists to fix.
    expect(code(citations)).toMatch(/type:\s*CITATION_TYPE[\s\S]{0,200}include:/);
    expect(code(citations)).not.toMatch(/\.filter\([^)]*type/);
  });

  it('reads both directions of the stored edge', () => {
    // The edge is a pair and neither side was stored as the citer, so querying
    // only `sourcePassageId` would return a different answer depending on which
    // end happened to sort first.
    expect(code(citations)).toContain('OR: [{ sourcePassageId: passageId }, { targetPassageId: passageId }]');
  });

  it('clamps the limit', () => {
    // limit=0 would return nothing and look like a passage with no citations.
    expect(code(citations)).toMatch(/Math\.min\(MAX_CITATIONS,\s*Math\.max\(1,/);
  });

  it('groups by corpus', () => {
    // "the Talmud says this too" is the useful shape of the answer; a flat list
    // of twelve loses it.
    expect(code(citations)).toContain('CitationGroup');
    expect(code(citations)).toMatch(/byCorpus\.get|byCorpus\.set/);
  });
});

describe('cross-reference list', () => {
  it('excludes self-reference types by default', () => {
    // 44,341 parallels and 1,311 duplicates against 3,689 citations. Mixed into
    // one list of eight, the strongest-looking entries are a book agreeing with
    // itself or the Pentateuch counted twice in `torah` and `ot`.
    expect(code(crossrefs)).toContain('SELF_REFERENCE_TYPES');
    expect(code(crossrefs)).toMatch(/NOT:\s*\{\s*type:\s*\{\s*in:\s*SELF_REFERENCE_TYPES/);
  });

  it('keeps the excluded types out of the query rather than the response', () => {
    expect(code(crossrefs)).not.toMatch(/\.filter\([^)]*SELF_REFERENCE_TYPES/);
  });
});
