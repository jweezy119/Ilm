import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The weights live in one place.
 *
 * This file reads the source rather than importing it, because the drift it guards
 * is invisible to the type checker: both copies were valid
 * `RecommendationWeights`, so nothing complained while they disagreed.
 *
 * The web store declared its own `DEFAULT_WEIGHTS`, a copy that was correct when
 * written and then fell behind the shared one. Nothing about that was visible from
 * the running app either — the settings page rendered the store's copy and looked
 * perfectly reasonable, showing five sensible numbers. It was only wrong against
 * the engine, which is the only thing the numbers are for.
 *
 * It was not cosmetic. Those sliders are what Save posts back to the API, so a
 * reader who opened settings and pressed save without touching anything would have
 * written the stale weights over the server, silently reverting the engine's
 * defaults. The fix is an alias rather than a copy; this test is what keeps it one.
 */

const store = readFileSync(join(__dirname, 'index.ts'), 'utf8');

/**
 * Comments stripped before matching.
 *
 * Without this the guard fails on the very comment explaining the guard, which is
 * not a useful failure: the explanation of a duplicate has to be able to quote one
 * without tripping the check that there is no duplicate.
 */
const code = store
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('recommendation weights', () => {
  it('does not declare its own copy of the defaults', () => {
    // Any `key: 0.x` inside a weight-shaped object literal in this file is a
    // second source of truth. `MAX_COMPARISON` already had one of these and the
    // comment above it explains why it must not.
    const literal = /(thematic|linguistic|historical|narrative|theological)\s*:\s*0\./;
    expect(code).not.toMatch(literal);
  });

  it('takes them from the shared package', () => {
    expect(code).toMatch(/DEFAULT_WEIGHTS as SHARED_DEFAULT_WEIGHTS/);
    expect(code).toMatch(/const DEFAULT_WEIGHTS = SHARED_DEFAULT_WEIGHTS/);
  });

  it('still explains why, since the next person will want a literal', () => {
    // The MAX_COMPARISON comment above it records that a second copy of a constant
    // drifted once already. This file then made the same mistake with the weights,
    // two lines below that warning, which is worth a word where the alias is.
    expect(store).toMatch(/drifted/);
  });
});
