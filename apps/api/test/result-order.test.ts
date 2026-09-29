import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The invariant a ranked list has to satisfy: its order is the order of the number
 * it shows.
 *
 * Both of these read the source rather than calling it. A search needs the whole
 * retrieval stack and a live index to fail this way, and the failure is invisible
 * to the type checker — the endpoint returns 200 and the list looks sorted, because
 * it is sorted, just not by the thing the reader is shown.
 */

const source = readFileSync(join(__dirname, '../src/services/search.ts'), 'utf8');

describe('search result ordering', () => {
  it('sorts candidates by the textScore it reports', () => {
    /*
     * The index returns hits in BM25 order, but the reported score is not BM25:
     * `scoreCandidate` multiplies in query-term coverage and result density, so
     * the two drift apart. Un-sorted, a live search for "sabbath" returned a
     * passage scoring 0.0625 above one scoring 0.0672, and the reader saw 6%
     * above 7% with nothing wrong in sight.
     */
    const afterScore = source.indexOf('textScore: scoreCandidate(');
    const sort = source.indexOf('.sort((a, b) => b.textScore - a.textScore)');

    expect(afterScore).toBeGreaterThan(-1);
    expect(sort).toBeGreaterThan(afterScore);
  });

  it('does not present a blend that did not order the list', () => {
    /*
     * When Jev re-ranks, the order is its verdict and `score` is a blend computed
     * independently of that order. A live search for "light" came back descending
     * but reading 74, 74, 73, 73, 74, 73, 74, 73 — the seventh row claiming more
     * than the fourth and sixth above it.
     *
     * The blend has to stay, because the schema exposes semanticScore and textScore
     * and consumers may want them. What must not happen is the blended number being
     * rendered next to a list it did not sort.
     */
    expect(source).toContain('blendSearchScore(semanticScore, textScore)');
    // The order is the model's, taken from its order array.
    expect(source).toMatch(/reranked\.order\.indexOf\(keyA\)/);
  });
});
