import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { create, insertMultiple, search } from '@orama/orama';

// Mirrors the shipped schema. These fields are only ever equality filters, and an
// `enum` would store them without an inverted index — but Orama refuses `where`
// clauses on enums, so a well-meaning optimisation here silently breaks the most
// used filter in the app. These tests pin that down: if anyone tries to make
// textId or language an enum again, this fails rather than production.
const schema = {
  passageKey: 'string',
  textId: 'string',
  book: 'string',
  chapter: 'number',
  verse: 'number',
  translation: 'string',
  language: 'string',
  verseOrder: 'number',
  themes: 'string[]',
  density: 'number',
} as const;

const doc = (over: Partial<Record<keyof (typeof schema), unknown>> = {}) => ({
  passageKey: 'quran:2:1:255',
  textId: 'quran',
  book: '2',
  chapter: 2,
  verse: 1,
  translation: 'jps',
  language: 'ar',
  verseOrder: 1,
  themes: ['divine justice'],
  density: 0.5,
  ...over,
});

describe('orama index schema', () => {
  const db = create({ schema });

  beforeAll(async () => {
    await insertMultiple(db as never, [
      doc(),
      doc({ passageKey: 'quran:2:2:256', textId: 'quran', chapter: 2, verse: 2, verseOrder: 2, translation: 'sahih', themes: ['law and covenant'] }),
      doc({ passageKey: 'torah:1:1:1', textId: 'torah', book: 'genesis', chapter: 1, verse: 1, verseOrder: 1, language: 'he', themes: ['creation'] }),
      doc({ passageKey: 'ot:1:1:1', textId: 'ot', book: 'genesis', chapter: 1, verse: 1, verseOrder: 1, language: 'en', themes: ['creation', 'beginnings'] }),
    ] as never);
  });

  afterAll(() => {
    /* nothing to release */
  });

  it('filters by textId', async () => {
    const results = await search(db, { term: '', where: { textId: 'quran' } as never, limit: 10, threshold: 0 });
    expect(results.hits).toHaveLength(2);
    expect(results.hits.every((h) => h.document.textId === 'quran')).toBe(true);
  });

  it('filters by language', async () => {
    const results = await search(db, { term: '', where: { language: 'he' } as never, limit: 10, threshold: 0 });
    expect(results.hits).toHaveLength(1);
    expect(results.hits[0]?.document.passageKey).toBe('torah:1:1:1');
  });

  it('filters by a list of values', async () => {
    const results = await search(db, { term: '', where: { textId: ['quran', 'torah'] } as never, limit: 10, threshold: 0 });
    expect(results.hits).toHaveLength(3);
  });

  it('still finds documents by term in translation, book and themes', async () => {
    // The three properties search is pointed at by default. Enums must not have
    // displaced them.
    for (const [term, expected] of [
      ['sahih', 1],
      ['genesis', 2],
      ['covenant', 1],
    ] as const) {
      const results = await search(db, {
        term,
        properties: ['translation', 'book', 'themes'],
        limit: 10,
      });
      expect(results.hits.length, `term ${term}`).toBeGreaterThanOrEqual(expected);
    }
  });

  it('combines a text filter with a term', async () => {
    const results = await search(db, {
      term: 'creation',
      properties: ['translation', 'book', 'themes'],
      where: { textId: 'ot' } as never,
      limit: 10,
    });
    expect(results.hits).toHaveLength(1);
    expect(results.hits[0]?.document.textId).toBe('ot');
  });

  it('cannot be trimmed to an enum: Orama rejects where on enums', async () => {
    // Documents the reason textId stays a string. If a future Orama version lifts
    // the restriction this test will start failing and the optimisation becomes
    // worth reconsidering.
    const enumDb = create({ schema: { ...schema, textId: 'enum' } as never });
    await insertMultiple(enumDb as never, [doc()] as never);
    // Thrown synchronously by search(), not as a rejected promise.
    expect(() =>
      search(enumDb, { term: '', where: { textId: 'quran' } as never, limit: 10, threshold: 0 }),
    ).toThrow(/one operation per filter/);
  });

  it('sorts by verseOrder', async () => {
    const results = await search(db, {
      term: '',
      where: { textId: 'quran' } as never,
      sortBy: { property: 'verseOrder', order: 'DESC' },
      limit: 10,
      threshold: 0,
    });
    expect(results.hits[0]?.document.verse).toBe(2);
  });
});
