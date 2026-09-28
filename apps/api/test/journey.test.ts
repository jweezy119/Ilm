import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The journey groups passages by the theme they share with the source.
 *
 * These are source-level assertions, matching the style of postgres-search.test.ts:
 * the grouping is decided by an ordering rule that is easy to break by editing a
 * comparator, and the reasons for it are not visible from the code alone.
 */

const source = readFileSync(join(__dirname, '../src/services/journey.ts'), 'utf8');
const route = readFileSync(join(__dirname, '../src/routes/api.ts'), 'utf8');

/**
 * Comments are stripped before asserting on code.
 *
 * These tests guard decisions that are explained in prose next to them, so an
 * assertion like "this file must not contain `include: { passage: true }`" also
 * matches the comment explaining why it was removed. Checking the code alone is
 * the difference between a test that guards the behaviour and one that fails
 * every time somebody documents it properly.
 */
function code(of: string): string {
  return of.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const sourceCode = code(source);

describe('passage journey', () => {
  it('excludes the passage the journey started from', () => {
    // A journey that includes its own source puts the verse you are already
    // reading at the top of its own theme, which reads as a strong match and is
    // just a tautology.
    expect(sourceCode).toContain('passageKey: { not: passage.passageKey }');
  });

  it('prefers breadth within a group over raw score', () => {
    // Taking the top N by score returns eight verses from whichever book scores
    // highest, usually one chapter. The group then looks like corroboration
    // between traditions when it is a single passage repeated.
    expect(sourceCode).toContain('bestPerBook');
    expect(sourceCode).toContain('selectMembers');
  });

  it('deprioritises the corpus the reader is already in', () => {
    expect(sourceCode).toContain('sameText');
  });

  it('orders within a group by corpus, then by that corpus own sequence', () => {
    // verseOrder is only meaningful inside one corpus. Genesis 3 and Quran 19:1
    // have no shared sequence, so sorting purely on it interleaves two unrelated
    // books into an order that does not exist.
    expect(sourceCode).toContain('corpusRank(a.textId) - corpusRank(b.textId)');
    expect(sourceCode).toContain('a.chronologicalOrder - b.chronologicalOrder');
  });

  it('orders the groups by how strongly the source passage carries each theme', () => {
    expect(sourceCode).toContain('b.sourceScore - a.sourceScore');
  });

  it('reports whether a group reaches more than one corpus', () => {
    // A group drawn from one corpus is one book agreeing with itself. That is a
    // weaker finding and the UI labels it as one rather than implying a
    // connection between traditions.
    expect(sourceCode).toContain('crossText: corpora.length > 1');
  });

  it('selects passage columns rather than including them', () => {
    // `include: { passage: true }` also pulls original_text and the embedding
    // vector, which at a few hundred rows pushed a journey past two seconds.
    expect(sourceCode).toContain('select:');
    expect(sourceCode).not.toContain('include: { passage: true }');
  });

  it('takes one query for all themes rather than one per theme', () => {
    // A journey is the same shape as a search: five groups should not be five
    // round trips.
    expect(sourceCode.match(/prisma\.passageTheme\.findMany/g)?.length).toBe(1);
  });

  it('clamps the per-group limit at the route', () => {
    // limit=0 would return no groups and look like a passage with no themes.
    const handler = code(route).slice(code(route).indexOf("app.get('/api/passages/:id/journey'"));
    expect(handler.slice(0, 1200)).toMatch(/clamp\(Number\(request\.query\.limit[^)]*\),\s*1,\s*20\)/);
  });
});
