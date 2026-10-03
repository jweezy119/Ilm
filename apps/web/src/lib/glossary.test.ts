/**
 * The glossary matcher is pure string work, so it is tested directly rather than
 * through a rendered component - the same reason highlighter.ts is separated out.
 *
 * Word boundaries are the part that has to be right: a matcher that fires inside a
 * longer word turns "a lot of" into the prophet Lot, and a matcher that misses a
 * possessive leaves the reader without the one word they most wanted explained.
 */

import { describe, it, expect } from 'vitest';
import { GLOSSARY, segmentForGlossary, glossaryEntry, glossaryTermsIn, GLOSSARY_TEXTS } from './glossary';

describe('glossary data', () => {
  it('has no duplicate terms, since the first would shadow the second', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const entry of GLOSSARY) {
      if (seen.has(entry.term)) duplicates.push(entry.term);
      seen.add(entry.term);
    }
    expect(duplicates).toEqual([]);
  });

  it('gives every entry a one-line gloss and at least one variant', () => {
    for (const entry of GLOSSARY) {
      expect(entry.short.length, `${entry.term} has no short gloss`).toBeGreaterThan(0);
      // One is enough for a proper name like "Allah"; a term with several English
      // forms needs all of them.
      expect(entry.variants.length, `${entry.term} has no variants`).toBeGreaterThanOrEqual(1);
    }
  });

  it('cites verses as textId:book:chapter:verse keys', () => {
    for (const entry of GLOSSARY) {
      for (const ref of entry.refs ?? []) {
        expect(ref, `${entry.term} cites ${ref}`).toMatch(/^quran:\d+:\d+:\d+$/);
      }
    }
  });

  it('covers the terms a reader meets most often in the translations', () => {
    for (const term of ['Allah', 'Lord', 'Merciful', 'Patience', 'Prayer', 'Guidance']) {
      expect(glossaryEntry(term), `${term} should be in the glossary`).toBeDefined();
    }
  });
});

describe('segmentForGlossary', () => {
  const terms = (text: string) =>
    segmentForGlossary(text)
      .filter((s) => s.kind === 'term')
      .map((s) => (s as { entry: { term: string } }).entry.term);

  it('marks a term in ordinary prose', () => {
    expect(terms('And how can you have patience for what you do not encompass')).toContain('Patience');
  });

  it('matches case-insensitively', () => {
    expect(terms('The LORD is merciful')).toEqual(expect.arrayContaining(['Lord', 'Merciful']));
  });

  it('marks a possessive, which a \\b boundary would miss', () => {
    expect(terms("the believer's prayer")).toContain('Believer');
  });

  it('marks next to an apostrophe', () => {
    // "Qur'an" is written with one, so the boundary has to hold either side of it.
    expect(terms("the Qur'an's meaning")).toContain('Quran');
  });

  it('does not fire inside a longer word', () => {
    expect(terms('a lot of water')).toEqual([]);
    expect(terms('reincarnation')).toEqual([]);
  });

  it('keeps the prophet Lot apart from an ordinary lot', () => {
    expect(terms('a lot of noise')).not.toContain('Lot');
    expect(terms('the people of Lot')).toContain('Lot');
  });

  it('returns the text unchanged when nothing matches', () => {
    const segments = segmentForGlossary('a plain sentence about nothing in particular');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ kind: 'plain', text: 'a plain sentence about nothing in particular' });
  });

  it('never overlaps two terms, so one word gets one definition', () => {
    const segments = segmentForGlossary(
      'In the name of Allah, the Entirely Merciful, the Especially Merciful.'
    );
    const marked = segments.filter((s) => s.kind === 'term');
    // "the Light of the heavens" is a phrase in one entry; "the" alone is not a term,
    // so the phrase must survive whole rather than being split.
    expect(marked.map((s) => s.text)).toContain('Especially Merciful');
  });

  it('round-trips: the segments rejoin into the original text', () => {
    const text =
      'Allah - there is no deity except Him, the Ever-Living, the Sustainer of [all] existence.';
    expect(segmentForGlossary(text).map((s) => s.text).join('')).toBe(text);
  });

  it('marks a term the corpus spells with a macron', () => {
    // The translation writes "Allāh" with U+0101. Without folding, the single most
    // common word in the Quran would never be marked.
    expect(terms('Allāh - there is no deity except Him')).toContain('Allah');
    expect(terms('Allāh, Allāh, Allāh')).toContain('Allah');
  });

  it('folds diacritics without shifting the surrounding text', () => {
    // Folding the whole string with NFD would shorten it wherever the source
    // already carries combining marks, and every later offset would land inside
    // the wrong word. This checks the segments still rejoin exactly.
    const text = 'Allāh said: "Āmin, rabb al-ʿālamīn" — and Allāh heard.';
    expect(segmentForGlossary(text).map((s) => s.text).join('')).toBe(text);
    const marked = segmentForGlossary(text).filter((s) => s.kind === 'term');
    expect(marked.map((s) => s.text)).toContain('Allāh');
  });

  it('leaves text with combining marks intact and correctly indexed', () => {
    // A decomposed "a" plus a combining macron is two code points; folding it must
    // not leave a hole in the returned segments.
    const text = 'Alla\u0304h\u0301 is merciful';
    const segments = segmentForGlossary(text);
    expect(segments.map((s) => s.text).join('')).toBe(text);
  });

  it('handles empty input', () => {
    expect(segmentForGlossary('')).toEqual([]);
  });
});

describe('glossaryTermsIn', () => {
  it('lists each term once however often it occurs', () => {
    const found = glossaryTermsIn('mercy and mercy and more mercy');
    expect(found.filter((t) => t === 'Merciful')).toHaveLength(1);
  });
});

describe('GLOSSARY_TEXTS', () => {
  it('covers only the Quran, because the entries gloss Quranic senses', () => {
    expect(GLOSSARY_TEXTS.has('quran')).toBe(true);
    for (const other of ['torah', 'talmud', 'ot', 'nt']) {
      expect(GLOSSARY_TEXTS.has(other), `${other} should not offer the Quranic glossary`).toBe(false);
    }
  });
});
