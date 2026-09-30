import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The wordmark.
 *
 * It used to show the Latin name and the locale's own word — "Ilm علم" to an
 * English reader, "Ilm דַּעַת" to a Hebrew one. Both readings were wrong in the
 * same way: the mark said the app belonged to whichever script the reader happened
 * to be in, when the corpus is read in three scripts at once and the name is the
 * same word in all of them. It now shows all three, with the reader's own
 * emphasised.
 *
 * These assertions are about the code's shape because the mark is a two-second
 * glance; a regression here is not worth a rendering test to catch.
 */

const shell = readFileSync(join(__dirname, 'Shell.tsx'), 'utf8');
const messages = ['en', 'ar', 'he'].map((locale) =>
  JSON.parse(readFileSync(join(__dirname, '../../messages', `${locale}.json`), 'utf8'))
);

describe('the wordmark', () => {
  it('names the app in all three of the corpus languages, in every locale', () => {
    // A new locale added without marks would show the Latin name alone, which is
    // the exact state this replaced.
    for (const data of messages) {
      expect(Object.keys(data.brand.marks).sort()).toEqual(['arabic', 'hebrew', 'latin']);
    }
  });

  it('uses one name, not three translations to keep in sync', () => {
    // علم and דַּעַת are knowledge in Arabic and Hebrew; Ilm is the romanisation
    // of the first. They are not interchangeable renderings of a tagline and must
    // not be edited independently.
    const [en, ar, he] = messages;
    expect(en.brand.marks.arabic).toBe(ar.brand.marks.arabic);
    expect(en.brand.marks.hebrew).toBe(he.brand.marks.hebrew);
    expect(en.brand.marks.latin).toBe(ar.brand.marks.latin);
  });

  it('renders every mark rather than the locale word alone', () => {
    // The regression guard: a mapping over the marks, not a lookup of one.
    expect(shell).toContain('Object.keys(tb.raw(\'marks\'))');
    expect(shell).not.toMatch(/Ilm\s*<span className="ms-1\.5/);
  });

  it('emphasises the reader’s own script and quiets the rest', () => {
    // The locale keys map one for one onto the scripts, so the emphasis is read
    // off the locale rather than a second piece of state that can disagree.
    expect(shell).toContain('script === locale');
    expect(shell).toContain("'font-medium text-fg'");
    expect(shell).toContain("'font-medium text-fg-faint'");
  });

  it('gives each script its own direction', () => {
    // A Hebrew or Arabic word left in an LTR run renders its punctuation and
    // neutral characters on the wrong side, which is visible on the wordmark
    // because it is the one place three scripts sit next to each other.
    expect(shell).toContain("dir={script === 'latin' ? 'ltr' : 'rtl'}");
  });
});
