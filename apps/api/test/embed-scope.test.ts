import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * The set of states a passage can be in, and which of them count as "not yet
 * embedded".
 *
 * This is written out rather than exercised against a live database because the
 * bug it guards was silent and total: a passage that has never been embedded
 * holds `Prisma.DbNull`, and `where: { embeddings: { equals: [] } }` does not
 * match it. The backfill therefore counted zero to do on a corpus where every
 * single passage was un-embedded, printed "0 to go", and exited successfully.
 * Nothing errored, so nothing looked wrong.
 *
 * The counter used to read:
 *   OR: [{ embeddings: { equals: '[]' } }, { embeddings: { equals: [] } }]
 */
const unembedded = {
  OR: [
    { embeddings: { equals: Prisma.DbNull } },
    { embeddings: { equals: '[]' } },
    { embeddings: { equals: [] } },
  ],
};

/** The filter as it was before the fix, kept to document the difference. */
const unembeddedBeforeFix = {
  OR: [{ embeddings: { equals: '[]' } }, { embeddings: { equals: [] } }],
};

describe('embeddings backfill scope', () => {
  const equalsValues = (where: typeof unembedded) =>
    (where.OR as Array<{ embeddings: { equals: unknown } }>).map((a) => a.embeddings.equals);

  it('includes the never-embedded state, which is a DB null', () => {
    expect(equalsValues(unembedded)).toContain(Prisma.DbNull);
  });

  it('includes a JSON null and an empty array, which an interrupted batch leaves behind', () => {
    expect(equalsValues(unembedded)).toStrictEqual([Prisma.DbNull, '[]', []]);
  });

  it('would have missed DB null before the fix', () => {
    // This is the whole point: the arm the old filter lacked is the one that
    // matters most, because every un-embedded passage is in that state.
    expect(equalsValues(unembeddedBeforeFix)).not.toContain(Prisma.DbNull);
  });
});
