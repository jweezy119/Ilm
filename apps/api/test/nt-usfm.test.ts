import { describe, it, expect } from 'vitest';
import { stripUsfm, parseUsfm } from '../scripts/ingest-nt-original';

/**
 * The USFM parser.
 *
 * This exists because the first ingest of the Greek NT stored markup in every one
 * of its 7,950 verses — `Οὕτω \+w γὰρ|strong="G1063"\+w*` — and it reached
 * production before anyone looked at a rendered verse. The cause was one
 * character in a regex, which is exactly the kind of thing that has no test and
 * then silently corrupts a corpus.
 *
 * These are the two failure modes that happened, plus the one that would happen
 * next.
 */

describe('stripUsfm', () => {
  it('removes Strong’s word markup', () => {
    // The bug: `\\[a-z0-9]+` cannot match a backslash followed by a literal plus,
    // so both the `\w` and the `\+w` marker form survived into the database.
    expect(stripUsfm('\\+w καὶ|strong="G2532"\\+w* πάντες')).toBe('καὶ πάντες');
    expect(stripUsfm('\\w καὶ|strong="G2532"\\w* πάντες')).toBe('καὶ πάντες');
  });

  it('removes every attribute form, not just strong', () => {
    // |x-morph="..." and friends would otherwise be stored as literal text.
    expect(stripUsfm('λόγος|x-morph="N-NSM" θεός')).toBe('λόγος θεός');
  });

  it('does not leave a space before punctuation', () => {
    // Inline markers sit against a word. Replacing them with a space — the
    // obvious fix for the markup above — produces "κόσμον , ὥστε", which reads as
    // broken to anyone who knows the language.
    expect(stripUsfm('τὸν κόσμον\\+bd, ὥστε')).toBe('τὸν κόσμον, ὥστε');
  });

  it('separates words for standalone commands', () => {
    // The counterpart: \par and \nb do divide words and need the space.
    expect(stripUsfm('ἀρχὴ\\par γένεσις')).toBe('ἀρχὴ γένεσις');
  });

  it('leaves no space before punctuation', () => {
    // eBible writes `Χριστοῦ \f* , υἱοῦ` — space, marker, space, comma. The
    // first ingest stored 6,217 of 7,950 verses with a space before their
    // punctuation, which reads as a conversion artefact to anyone who knows the
    // language. Some verses also carry the space with no marker at all, so this
    // is a backstop rather than a fix for one construct.
    expect(stripUsfm('Χριστοῦ \\f* , υἱοῦ')).toBe('Χριστοῦ, υἱοῦ');
    expect(stripUsfm('γράφω ὑμῖν , ἰδοὺ')).toBe('γράφω ὑμῖν, ἰδοὺ');
  });

  it('keeps the space before a closing quote', () => {
    // Correct in Greek, so the punctuation rule must not swallow it.
    expect(stripUsfm("φωνή ᾽ ἱκανή")).toBe("φωνή ᾽ ἱκανή");
  });

  it('drops footnote blocks whole', () => {
    // eBible wraps apparatus in \f ... \f*, and a fragment of it inside a word
    // is worse than no footnote at all.
    expect(stripUsfm('καὶ \\f + \\fr 1:16 \\ft note text \\f* οὕτω')).toBe('καὶ οὕτω');
  });

  it('strips critical-apparatus characters', () => {
    expect(stripUsfm('λόγῳ⸀')).toBe('λόγῳ');
  });

  it('leaves plain Greek untouched', () => {
    const greek = 'Οὕτω γὰρ ἠγάπησεν ὁ Θεὸς τὸν κόσμον';
    expect(stripUsfm(greek)).toBe(greek);
  });

  it('leaves nothing that could be markup behind', () => {
    const result = stripUsfm('\\+w καὶ|strong="G2532"\\+w* \\+bd πάντες\\+bd* \\f + \\fr 1 \\ft x \\f* λόγῳ⸀');
    expect(result).not.toMatch(/[\\|]/);
    expect(result).not.toContain('strong');
  });
});

describe('parseUsfm', () => {
  const source = [
    '\\c 1',
    '\\v 1 \\f + \\fr 1:1 \\ft note \\f* Βίβλος γενέσεως',
    '\\v 2 καὶ Ἀβραὰμ',
    '\\s1 Title',
    '\\c 2',
    '\\v 1 Λαβὼν δὲ αὐτὸ',
  ].join('\n');

  it('assigns verses to their chapter', () => {
    const verses = parseUsfm(source);
    expect(verses.map((v) => `${v.chapter}:${v.verse}`)).toEqual(['1:1', '1:2', '2:1']);
  });

  it('appends a wrapped continuation to the verse above', () => {
    expect(parseUsfm(source)[1].text).toBe('καὶ Ἀβραὰμ');
  });

  it('excludes section headings from the verse text', () => {
    // \s1 lines do not start with a backslash, so a naive "append the line"
    // rule puts an English heading into a Greek-only field.
    expect(parseUsfm(source).every((v) => !v.text.includes('Title'))).toBe(true);
  });
});
