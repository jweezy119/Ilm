import { describe, it, expect } from 'vitest';
import { buildCitation } from './CopyCitation';
import type { Passage } from '@ilm/shared';

/**
 * The exported citation.
 *
 * This is the artefact that leaves the app, and it carries the app's whole claim:
 * the text, the reference, where it can be checked, and the score with its source
 * — and no interpretation, because nobody here wrote one.
 *
 * The failure that matters is a bare percentage. "60%" next to a verse reads as a
 * property of the text rather than a statement about how the app ranked it, which
 * is the exact conflation the source labels exist to prevent.
 */

const passage = (over: Partial<Passage> = {}): Passage =>
  ({
    id: 'abc',
    passageKey: 'nt:John:3:16',
    textId: 'nt',
    book: 'John',
    chapter: 3,
    verse: 16,
    originalText: 'Οὕτω γὰρ ἠγάπησεν ὁ Θεὸς τὸν κόσμον',
    translation: 'For God so loved the world, that he gave his only begotten Son',
    alternativeTranslations: [],
    metadata: { language: 'greek' },
    embeddings: [],
    themes: [],
    crossReferences: [],
    ...over,
  }) as unknown as Passage;

const SITE = 'https://ilm.example';

describe('buildCitation', () => {
  it('includes the text, the reference and a resolvable link', () => {
    const out = buildCitation(passage(), 'plain', SITE);
    expect(out).toContain('For God so loved the world');
    expect(out).toContain('John 3:16');
    expect(out).toContain(`${SITE}/passage/nt/John/3/16`);
  });

  it('includes the original text, since the whole point is the original', () => {
    const out = buildCitation(passage(), 'plain', SITE);
    expect(out).toContain('ἠγάπησεν');
  });

  it('omits the original when there is none', () => {
    // An empty bracketed line reads like something was stripped out.
    const out = buildCitation(passage({ originalText: '' }), 'plain', SITE);
    expect(out).not.toMatch(/\[\s*\]/);
  });

  it('never emits a bare percentage', () => {
    // The one thing this must not do: print a number that reads as a property of
    // the verse. Every score is attributed to the ranking that produced it.
    const out = buildCitation(passage(), 'cited', SITE, { score: 0.6, source: 'jev' });
    expect(out).toContain('60%');
    expect(out).toMatch(/60% \(weighted score, jev\)/);
  });

  it('attributes the score when the source is unknown', () => {
    // Defaulting to a real source name would misreport where the number came
    // from, which is worse than admitting it is local.
    const out = buildCitation(passage(), 'cited', SITE, { score: 0.4 });
    expect(out).toContain('derived');
  });

  it('omits the score when there is none', () => {
    // A passage read directly has no query, so no score, and inventing one would
    // be a number about nothing.
    const out = buildCitation(passage(), 'cited', SITE, {});
    expect(out).not.toContain('%');
  });

  it('writes no interpretation in either format', () => {
    // The product rule. A summary, gloss or "significance" line would make every
    // other number on the page look like it came from a model too.
    for (const format of ['plain', 'cited'] as const) {
      const out = buildCitation(passage(), format, SITE, { score: 0.9, source: 'jev' }).toLowerCase();
      for (const word of ['significance', 'meaning', 'interpretation', 'suggests', 'implies', 'therefore']) {
        expect(out, `"${word}" in ${format} output`).not.toContain(word);
      }
    }
  });

  it('escapes nothing and does not mangle the text', () => {
    // The text is pasted into documents that interpret their own characters.
    const out = buildCitation(passage({ translation: 'He said "come" & left' }), 'plain', SITE);
    expect(out).toContain('He said "come" & left');
  });

  it('collapses a trailing slash on the site url', () => {
    expect(buildCitation(passage(), 'plain', `${SITE}/`)).toContain(`${SITE}/passage/`);
    expect(buildCitation(passage(), 'plain', SITE)).not.toContain('//passage/');
  });

  it('names the corpus, not just the book', () => {
    // "John 3:16" alone does not say which John, and the same reference exists in
    // the Hebrew Torah for the Pentateuch.
    expect(buildCitation(passage(), 'plain', SITE)).toContain('New Testament');
  });
});
