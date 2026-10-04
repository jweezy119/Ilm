/**
 * A search is given one budget for the whole of the judge's time, not one per
 * call.
 *
 * The reason this exists is a measurement, not a theory. A search on the deployed
 * service was taking 8.7 seconds, and the breakdown was: 2.5 seconds of text
 * search and hydration, 5.1 seconds of theme expansion, and about 1.2 of rerank.
 * Nothing about that is the size of the corpus — dropping the entire New
 * Testament moved it by one per cent — and a per-call timeout does not help,
 * because three bounded calls still sum to a wait.
 *
 * What matters for the tests is that spending less judge time never changes what
 * the answer claims to be. Every fallback here is local scoring, and every one of
 * them is labelled `derived` rather than `jev`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const search = readFileSync(resolve(__dirname, '../src/services/search.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the search budget', () => {
  it('is a total, not a per-call timeout', () => {
    // A per-call limit bounds each call; it does not bound the search.
    expect(search).toContain('const JUDGE_BUDGET_MS = Number(process.env.SEARCH_JUDGE_BUDGET_MS ?? 2500)');
    expect(search).toContain('const judgeDeadline = startedAt + JUDGE_BUDGET_MS');
    expect(search).toContain('const judgeLeft = () => Date.now() < judgeDeadline');
  });

  it('classifies locally rather than calling the judge when the budget is gone', () => {
    expect(search).toMatch(/judgeLeft\(\) \? classifySearchIntent\(query\.query\) : Promise\.resolve\(localIntent\(query\.query\)\)/);
  });

  it('skips the widening rather than paying five seconds for better recall', () => {
    /*
     * This was the single most expensive step and the least valuable: it fires
     * whenever nothing matched the original text, which for an English query is
     * almost always, and it improves recall rather than correctness.
     */
    expect(search).toMatch(/if \(judgeLeft\(\)\) \{\s*expansion = await expandQueryTheme/);
  });

  it('skips the rerank when the budget is spent', () => {
    expect(search).toContain(
      'query.semantic === false || !judgeLeft() ? null : await rerankForQuery'
    );
  });

  it('does not let a caller switch the budget off by asking twice', () => {
    // The `expand: false` and `semantic: false` flags stay honoured; they are how a
    // caller asks for a fast answer deliberately, and the budget is what applies
    // when they have not.
    expect(search).toContain('query.expand !== false && shouldWiden');
    expect(search).toContain('query.semantic === false');
  });

  it('falls back to something that is already labelled as derived', () => {
    // Local scoring and local intent both report `derived`, so a search that spent
    // no judge time says so rather than implying it was judged.
    expect(search).toContain('localIntent');
    expect(search).toMatch(/let expansion: QueryExpansion = \{ theme: null, confidence: 0, source: 'derived' \}/);
  });
});
