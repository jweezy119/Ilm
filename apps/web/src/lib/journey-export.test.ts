import { describe, expect, it } from 'vitest';
import type { JourneyGraph } from '@ilm/shared';
import {
  buildJourneyShareUrl,
  decodeJourneyShare,
  encodeJourneyShare,
  journeyToMarkdown,
} from './journey-export';

const SAMPLE_GRAPH: JourneyGraph = {
  journey: {
    id: 'j_1',
    name: 'Mercy Across Traditions',
    description: 'Tracing divine compassion across Quran and Gospel.',
    nodeCount: 2,
    corpora: ['quran', 'nt'],
    nodeKeys: ['quran:1:1:1', 'nt:matthew:5:7'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  nodes: [
    {
      passageKey: 'quran:1:1:1',
      textId: 'quran',
      book: '1',
      chapter: 1,
      verse: 1,
      position: 0,
      note: 'Opening invocation of mercy.',
      preview: 'In the name of God, the Entirely Merciful, the Especially Merciful.',
      originalText: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ',
      language: 'arabic',
      missing: false,
    },
    {
      passageKey: 'nt:matthew:5:7',
      textId: 'nt',
      book: 'matthew',
      chapter: 5,
      verse: 7,
      position: 1,
      note: null,
      preview: 'Blessed are the merciful, for they shall receive mercy.',
      originalText: '',
      language: 'greek',
      missing: false,
    },
  ],
  edges: [
    {
      from: 'quran:1:1:1',
      to: 'nt:matthew:5:7',
      kind: 'shared-theme',
      strength: 0.72,
      provenance: 'derived',
      theme: 'mercy',
    },
  ],
  suggested: [],
};

describe('journey share codec & Markdown study guide export', () => {
  it('round-trips UTF-8 journey titles, descriptions, keys, and notes via portable URL token', () => {
    const token = encodeJourneyShare({
      name: 'الرحمة & Mercy',
      description: 'Notes across Arabic and English',
      keys: ['quran:1:1:1', 'nt:matthew:5:7', 'quran:1:1:1'],
      notes: { 'quran:1:1:1': 'Opening verse' },
    });

    const decoded = decodeJourneyShare(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.name).toBe('الرحمة & Mercy');
    expect(decoded!.description).toBe('Notes across Arabic and English');
    // Deduplicated
    expect(decoded!.keys).toEqual(['quran:1:1:1', 'nt:matthew:5:7']);
    expect(decoded!.notes).toEqual({ 'quran:1:1:1': 'Opening verse' });
  });

  it('rejects malformed or empty tokens defensively', () => {
    expect(decodeJourneyShare(null)).toBeNull();
    expect(decodeJourneyShare('')).toBeNull();
    expect(decodeJourneyShare('not-valid-base64!!!')).toBeNull();
    expect(decodeJourneyShare(encodeJourneyShare({ name: 'Empty', keys: [] }))).toBeNull();
  });

  it('builds QR-safe shareable URLs and drops long notes automatically when needed', () => {
    const built = buildJourneyShareUrl('https://ilm.app', 'en', SAMPLE_GRAPH);
    expect(built.url).toContain('https://ilm.app/en/journeys?import=');
    expect(built.notesIncluded).toBe(true);
    expect(built.qrSafe).toBe(true);

    const token = built.url.split('?import=')[1];
    const decoded = decodeJourneyShare(token);
    expect(decoded?.name).toBe('Mercy Across Traditions');
    expect(decoded?.keys).toEqual(['quran:1:1:1', 'nt:matthew:5:7']);
  });

  it('exports a clean Markdown study guide with texts, user notes, and detected relations', () => {
    const md = journeyToMarkdown(SAMPLE_GRAPH, 'https://ilm.app/en/journeys?import=abc');
    expect(md).toContain('# Mercy Across Traditions');
    expect(md).toContain('Tracing divine compassion across Quran and Gospel.');
    expect(md).toContain('بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ');
    expect(md).toContain('> In the name of God, the Entirely Merciful, the Especially Merciful.');
    expect(md).toContain('**Note:** Opening invocation of mercy.');
    expect(md).toContain('## Detected Relations (1)');
    expect(md).toContain('shared theme: mercy *(found by derived)*');
  });
});
