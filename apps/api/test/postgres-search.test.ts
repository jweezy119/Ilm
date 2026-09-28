import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards on the Postgres retrieval module.
 *
 * These read the source rather than calling it, because the failures worth
 * guarding here were both invisible to the type checker and only visible as a
 * 500 from the search endpoint: one broke every ordinary search, and the other
 * was a reserved word that no linter in this repo knows about.
 */

const source = readFileSync(join(__dirname, '../src/search/postgres.ts'), 'utf8');
const engine = readFileSync(join(__dirname, '../src/search/engine.ts'), 'utf8');

describe('postgres retrieval', () => {
  it('wraps conditions in WHERE exactly once', () => {
    // The WHERE keyword used to live inside the filters fragment. A search with no
    // filters — every ordinary search — therefore appended its text predicate
    // bare, and Postgres answered "syntax error at or near p". So every search
    // 500'd, and the first thing tried was the one that broke.
    expect(source).toMatch(/conditions\.length > 0 \? Prisma\.sql`WHERE /);
  });

  it('does not alias the relevance column to rank', () => {
    // RANK is reserved in PostgreSQL as a window function, so `ORDER BY rank` is a
    // syntax error (42601). The symptom was a 500 on every search with a term.
    expect(source).toContain('AS relevance');
    expect(source).not.toMatch(/AS rank\b/);
  });

  it('fetches themes after ranking rather than joining them per match', () => {
    // A join is evaluated before LIMIT, so aggregating themes inline ran for
    // every matching row in the corpus rather than the forty on the page.
    //
    // The ranking query lives in the `run` helper now that search falls back
    // from full-text to trigram, so the marker is the $queryRaw call itself and
    // not the `const rows =` binding that used to introduce it.
    const ranked = source.indexOf('prisma.$queryRaw<Array<Record<string, unknown>>>');
    const themes = source.indexOf('const themeRows');
    expect(ranked).toBeGreaterThan(-1);
    expect(themes).toBeGreaterThan(ranked);
  });

  it('keeps a misspelled term findable without loosening the first pass', () => {
    // "merce" must reach the passages containing "mercy", but a search that
    // already works must not pay for the trigram pass or lose its ordering.
    expect(source).toContain('p.primary_translation %>>');
    expect(source).toContain("label: 'exact'");
    expect(source).toContain("label: 'relaxed'");
    // `%>>` is the index-assisted operator. Spelling it as a plain
    // `word_similarity(...) > 0.4` comparison passes review and then scans
    // every row, which is the multi-second case this replaced.
    expect(source).not.toMatch(/word_similarity\([^)]*\)\s*>\s*0?\./);
  });

  it('indexes theme membership as a relation, not a denormalised column', () => {
    expect(source).toContain('FROM passage_themes pt');
  });

  it('defaults to postgres and keeps orama reachable', () => {
    // The rollback path is the reason the Orama module was not deleted.
    expect(engine).toContain("process.env.SEARCH_ENGINE ?? 'postgres'");
    expect(engine).toContain("ENGINE === 'orama'");
  });
});
