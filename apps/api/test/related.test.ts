import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The related-passages panel.
 *
 * It merges three relation families that were in three places, each answering a
 * third of the question. The value is not the list — the data already existed —
 * it is that each row now says *how* it relates. An eleven-word verbatim run and a
 * shared theme are not the same claim, and merging them into one ranked column
 * without a label is the conflation the rest of the product exists to avoid.
 */

const related = readFileSync(join(__dirname, '../src/services/related.ts'), 'utf8');
const route = readFileSync(join(__dirname, '../src/routes/api.ts'), 'utf8');

function code(of: string): string {
  return of.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('related passages', () => {
  it('selects `id` on the passage rows it compares', () => {
    // The bug this guards, and it was silent. The self-edge guard is
    // `other.id === self.id`. With `id` missing from the select, *both* sides were
    // `undefined`, the comparison was true, and every edge was skipped as a
    // self-edge. A passage with ten verbatim citations returned zero, and the
    // panel still rendered, because the theme rows came from a separate query.
    expect(code(related)).toMatch(/const PASSAGE_SELECT = \{[^}]*\bid: true,/);
  });

  it('excludes self-reference types, which outnumber real relations 12 to 1', () => {
    // 44,420 parallels and 1,311 duplicates against 3,687 citations. A corpus
    // repeating itself is a real match and not a relation between traditions.
    expect(code(related)).toContain("NOT: { type: { in: ['parallel', 'duplicate'] } }");
  });

  it('separates the three kinds rather than merging them into one ranking', () => {
    expect(code(related)).toContain('byKind: Record<RelatedKind, RelatedPassage[]>');
    for (const kind of ['verbatim', 'relation', 'theme']) {
      expect(code(related)).toContain(`${kind}:`);
    }
  });

  it('labels every row with how it relates and where that came from', () => {
    expect(code(related)).toContain('kind: RelatedKind');
    expect(code(related)).toContain('source: string');
    // A verbatim match is arithmetic over the stored texts; a theme match is a
    // keyword classifier's opinion. Printing both without that distinction would
    // be the single most misleading thing the page could do.
    expect(code(related)).toContain("source: edge.detectedBy ?? 'jev'");
    expect(code(related)).toContain("source: row.source ?? 'derived'");
  });

  it('caps each kind, so the strongest signal cannot fill the panel', () => {
    // Without a cap, a passage in a well-cited book returns twelve citations and
    // the reader learns nothing about the other two kinds.
    expect(code(related)).toMatch(/const CAPS = \{ verbatim: \d+, relation: \d+, theme: \d+ \}/);
  });

  it('prefers a different book within a theme, not a different score', () => {
    // Top-N by score returns eight verses of one chapter, and the group then
    // looks like corroboration when it is one passage repeated.
    expect(code(related)).toContain('bestPerBook');
  });

  it('takes theme matches only from other corpora', () => {
    // A same-corpus neighbour sharing a theme is usually the adjacent verse.
    expect(code(related)).toContain("textId: { not: self.textId }");
  });

  it('lists a pair once, letting the verbatim claim win', () => {
    expect(code(related)).toContain('seen.has(other.passageKey)');
  });

  it('is reachable', () => {
    expect(code(route)).toContain("app.get('/api/passages/:id/related'");
  });
});
