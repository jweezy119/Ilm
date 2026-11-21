import { describe, expect, it } from 'vitest';
import {
  CompactBm25Index,
  decodeVarints,
  encodeVarints,
  type CompactDocInput,
} from '../src/search/compact-bm25';
import { CompactVectorIndex, popcount32 } from '../src/search/compact-vectors';
import { buildCompactFromPack, fuseHybridHits } from '../src/search/compact';
import {
  buildColumnarPayload,
  decodeIlmPack,
  encodeIlmPack,
} from '../src/lib/ilm-pack';
import { PackStore } from '../src/lib/pack-store';

const SAMPLE_DOCS: CompactDocInput[] = [
  {
    passageKey: 'quran:1:1:1',
    textId: 'quran',
    book: '1',
    chapter: 1,
    verse: 1,
    translation: 'In the name of God, the Entirely Merciful, the Especially Merciful.',
    originalText: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ',
    language: 'arabic',
    verseOrder: 1,
    themes: ['mercy', 'compassion'],
    density: 0.9,
  },
  {
    passageKey: 'torah:genesis:1:1',
    textId: 'torah',
    book: 'genesis',
    chapter: 1,
    verse: 1,
    translation: 'In the beginning God created the heavens and the earth with wisdom.',
    originalText: 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ חָכְמָה',
    language: 'hebrew',
    verseOrder: 100,
    themes: ['creation', 'wisdom'],
    density: 0.95,
  },
  {
    passageKey: 'nt:john:3:16',
    textId: 'nt',
    book: 'john',
    chapter: 3,
    verse: 16,
    translation: 'For God so loved the world that he gave his only Son, showing mercy and forgiveness.',
    originalText: 'οὕτως γὰρ ἠγάπησεν ὁ θεὸς τὸν κόσμον',
    language: 'greek',
    verseOrder: 200,
    themes: ['love', 'mercy', 'forgiveness'],
    density: 0.92,
  },
  {
    passageKey: 'nt:matthew:5:9',
    textId: 'nt',
    book: 'matthew',
    chapter: 5,
    verse: 9,
    translation: 'Blessed are the peacemakers, for they shall be called children of God.',
    originalText: 'μακάριοι οἱ εἰρηνοποιοί ὅτι αὐτοὶ υἱοὶ θεοῦ κληθήσονται',
    language: 'greek',
    verseOrder: 201,
    themes: ['peace'],
    density: 0.8,
  },
];

describe('compact compressed search & pack format', () => {
  it('round-trips LEB128 varint posting deltas losslessly', () => {
    const pairs: Array<[number, number]> = [
      [0, (3 << 2) | 1],
      [1, (1 << 2) | 2],
      [512, (12 << 2) | 3],
      [46463, (63 << 2) | 1],
    ];
    const encodedNums: number[] = [];
    let prev = 0;
    for (const [docId, packed] of pairs) {
      encodedNums.push(docId - prev, packed);
      prev = docId;
    }
    const bytes = encodeVarints(encodedNums);
    const decoded: Array<[number, number]> = [];
    decodeVarints(bytes, (docId, packed) => decoded.push([docId, packed]));
    expect(decoded).toEqual(pairs);
    // Compact: 4 pairs with docId up to 46,463 take well under 15 bytes
    expect(bytes.byteLength).toBeLessThan(15);
  });

  it('searches English, Arabic, Hebrew, and Greek (surface > stem) accurately', () => {
    const idx = new CompactBm25Index(SAMPLE_DOCS);

    // Vocalized Arabic matched by unvocalized query
    const ar = idx.search('الرحمن');
    expect(ar.hits.length).toBe(1);
    expect(idx.getPassageKey(ar.hits[0].docId)).toBe('quran:1:1:1');
    expect(ar.hits[0].matchedIn).toBe('original');

    // Vocalized Hebrew matched by unvocalized query
    const he = idx.search('חכמה');
    expect(he.hits.length).toBe(1);
    expect(idx.getPassageKey(he.hits[0].docId)).toBe('torah:genesis:1:1');

    // Greek: querying θεοῦ matches exact surface (matthew:5:9) FIRST and inflected θεὸς (john:3:16) SECOND
    const gr = idx.search('θεοῦ');
    expect(gr.hits.length).toBe(2);
    expect(idx.getPassageKey(gr.hits[0].docId)).toBe('nt:matthew:5:9');
    expect(idx.getPassageKey(gr.hits[1].docId)).toBe('nt:john:3:16');

    // Typo / prefix fallback ("forgiv" -> "forgiveness", "merce" -> "mercy")
    const prefix = idx.search('forgiv');
    expect(prefix.matchMode).toBe('relaxed');
    expect(prefix.hits.some((h) => idx.getPassageKey(h.docId) === 'nt:john:3:16')).toBe(true);

    // O(1) theme bitset + textId filtering
    const filtered = idx.search('', { textIds: ['nt'], themes: ['mercy'] });
    expect(filtered.matchMode).toBe('filters-only');
    expect(filtered.hits.map((h) => idx.getPassageKey(h.docId))).toEqual(['nt:john:3:16']);
  });

  it('quantizes vectors with 1-bit BQ + Int8 SQ8 and preserves nearest-neighbor ranking', () => {
    expect(popcount32(0xffffffff)).toBe(32);
    expect(popcount32(0xaaaaaaaa)).toBe(16);

    const dims = 384;
    const vecs = new CompactVectorIndex(4, dims, 128);

    // Deterministic synthetic semantic directions
    const makeVec = (seed: number, mix?: number[]): number[] => {
      const v = new Array<number>(dims);
      for (let i = 0; i < dims; i += 1) {
        v[i] = Math.sin((i + 1) * seed) * 0.7 + Math.cos((i + 3) * seed * 1.3) * 0.3;
        if (mix) v[i] = v[i] * 0.2 + mix[i] * 0.8;
      }
      return v;
    };

    const topicMercy = makeVec(1.7);
    const topicCreation = makeVec(4.9);
    const topicPeace = makeVec(9.3);

    vecs.set(0, topicMercy);
    vecs.set(1, topicCreation);
    vecs.set(2, makeVec(2.1, topicMercy)); // close neighbor to mercy
    vecs.set(3, topicPeace);

    // Serialize & deserialize round-trip
    const blob = vecs.serialize();
    const restored = CompactVectorIndex.deserialize(blob);
    expect(restored.size).toBe(4);
    expect(restored.dims).toBe(384);
    expect(restored.sqDims).toBe(128);

    const results = restored.search(topicMercy, { limit: 4 });
    expect(results[0].docId).toBe(0);
    expect(results[0].score).toBeGreaterThan(0.95);
    expect(results[1].docId).toBe(2);
    expect(results[1].score).toBeGreaterThan(results[2].score);

    // Filter excludes doc 0
    const filtered = restored.search(topicMercy, { limit: 2, filter: (id) => id !== 0 });
    expect(filtered[0].docId).toBe(2);
  });

  it('fuses lexical and semantic hits via RRF without saturating scores', () => {
    const fused = fuseHybridHits(
      [
        { docId: 10, score: 8.5, matchedIn: 'translation' },
        { docId: 20, score: 5.0, matchedIn: 'translation' },
      ],
      [
        { docId: 20, score: 0.91 },
        { docId: 30, score: 0.84 },
      ]
    );
    // Doc 20 appears in both lexical and semantic -> ranked #1
    expect(fused[0].docId).toBe(20);
    // Pure semantic hit (doc 30) is preserved and tagged 'semantic'
    const semOnly = fused.find((h) => h.docId === 30);
    expect(semOnly?.matchedIn).toBe('semantic');
    // Ordering is strictly differentiated
    expect(fused[0].score).toBeGreaterThan(fused[1].score);
    expect(fused[1].score).toBeGreaterThan(fused[2].score);
  });

  it('round-trips a Brotli .ilm.pack.br bundle with embedded vectors and PackStore reads', () => {
    const payload = buildColumnarPayload({
      books: [
        { textId: 'quran', bookId: '1', name: 'Al-Fatihah', chapterCount: 1, verseCount: 7, order: 1 },
        { textId: 'torah', bookId: 'genesis', name: 'Genesis', chapterCount: 50, verseCount: 1533, order: 1 },
      ],
      passages: SAMPLE_DOCS.slice(0, 2).map((d) => ({
        id: d.passageKey,
        passageKey: d.passageKey,
        textId: d.textId,
        bookSlug: d.book,
        chapter: d.chapter,
        verse: d.verse,
        originalText: d.originalText,
        translation: d.translation,
        primaryTranslationName: 'Test Translation',
        language: d.language,
        verseOrder: d.verseOrder,
        density: d.density,
        themes: d.themes.map((t) => ({ theme: t, score: 0.8, confidence: 0.7, source: 'derived' })),
      })),
      xlingualTerms: [{ theme: 'mercy', language: 'arabic', term: 'الرحمن', inPassages: 57, specificity: 1 }],
    });

    const vecs = new CompactVectorIndex(2, 64, 64);
    vecs.set(0, Array.from({ length: 64 }, (_, i) => Math.sin(i + 1)));
    vecs.set(1, Array.from({ length: 64 }, (_, i) => Math.cos(i + 1)));

    const compressed = encodeIlmPack(payload, vecs.serialize(), 6);
    const decoded = decodeIlmPack(compressed);
    expect(decoded.payload.count).toBe(2);
    expect(decoded.vectorBlob).not.toBeNull();

    // Zero-Postgres PackStore reads
    const store = new PackStore(decoded);
    const q1 = store.getPassageByKey('quran:1:1:1');
    expect(q1?.translation).toContain('Entirely Merciful');
    expect(q1?.themes.map((t) => t.theme)).toContain('mercy');
    expect(store.getBooks('quran')[0].name).toBe('Al-Fatihah');
    expect(store.getXlingualTermsForTheme('mercy')[0].term).toBe('الرحمن');
    expect(store.getCorpusStats().totals.passages).toBe(2);

    // Compact hybrid search builds directly from decoded pack
    const built = buildCompactFromPack(decoded);
    expect(built.bm25.count).toBe(2);
    expect(built.vectors?.size).toBe(2);
  });
});
