import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The health endpoint's embedded-passage count.
 *
 * This exists because the wrong version shipped. `WHERE embeddings IS NOT NULL`
 * is instant and counts every row as embedded, because an empty array is not
 * null. On production it reported 45,453 of 45,453 on a corpus where 16,853
 * passages held `[]`, and the settings page rendered that as fact. Nothing
 * errored; the number was simply wrong, in the one place a reader would look to
 * decide whether comparisons are using real vectors.
 *
 * Asserted against the source because reproducing it needs a database, and the
 * failure mode is a plausible-looking edit that a test with a fixture would not
 * catch anyway.
 */
const routeSource = readFileSync(join(__dirname, '../src/routes/api.ts'), 'utf8');
const migrationSql = readFileSync(
  join(__dirname, '../prisma/migrations/3_passages_embedding_coverage/migration.sql'),
  'utf8'
);

describe('embedded-passage count', () => {
  it('counts by vector length, not by nullness', () => {
    expect(routeSource).toContain('jsonb_array_length(embeddings) > 0');
  });

  it('does not use the instant predicate that counts empty arrays as embedded', () => {
    expect(routeSource).not.toContain('WHERE embeddings IS NOT NULL');
  });

  it('has the index that makes the length check affordable', () => {
    // jsonb_array_length is immutable, so the expression is indexable. Without
    // this the correct query is a 4.3 s full scan, which is how the fast-but-wrong
    // version got written in the first place.
    expect(migrationSql).toContain('jsonb_array_length(embeddings)');
  });

  it('forbids a JSON null, the one value that makes the expression raise', () => {
    // jsonb_array_length('null'::jsonb) is error 22023, not null, so an
    // unguarded length check would throw and take /health down with it.
    expect(migrationSql).toContain("jsonb_typeof(embeddings) = 'array'");
  });
});
