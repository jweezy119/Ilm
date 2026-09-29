import { describe, it, expect } from 'vitest';
import { parseCitation, isUnambiguousCitation } from '@ilm/shared';

/**
 * Citation parsing.
 *
 * Every assertion here corresponds to a wrong answer this parser actually gave
 * at some point. A citation lookup has one unforgivable failure mode — resolving
 * to a real passage from the wrong tradition, or to a passage that does not
 * exist — and neither shows up as an error. "John 3:16" returned `ot:John:3:16`
 * for a while, which is a valid passage in a valid book and simply the wrong one.
 */

const keys = (input: string) => parseCitation(input).map((m) => m.passageKey);

describe('parseCitation', () => {
  it('puts each book in the corpus it belongs to', () => {
    // The original bug: one object of names, and a loop that filed every book
    // under `ot`. John and Revelation resolved to the Old Testament.
    expect(keys('John 3:16')).toEqual(['nt:John:3:16']);
    expect(keys('Rev 21:4')).toEqual(['nt:Revelation:21:4']);
    expect(keys('Mark 10:45')).toEqual(['nt:Mark:10:45']);
    expect(keys('Jer 31:31')).toEqual(['ot:Jeremiah:31:31']);
    expect(keys('Mic 6:8')).toEqual(['ot:Micah:6:8']);
  });

  it('resolves a Pentateuch book in both corpora it exists in', () => {
    // Genesis is in `torah` (Sefaria Hebrew) and in `ot` (KJV). One reference,
    // two real passages, and the reader chooses.
    expect(keys('Gen 1:1').sort()).toEqual(['ot:Genesis:1:1', 'torah:Genesis:1:1']);
    expect(keys('Exodus 20:13').sort()).toEqual(['ot:Exodus:20:13', 'torah:Exodus:20:13']);
    // A book that is not Pentateuch is unambiguous.
    expect(keys('Joshua 1:1')).toEqual(['ot:Joshua:1:1']);
  });

  it('accepts the abbreviations people actually type', () => {
    expect(keys('Jn 3.16')).toEqual(['nt:John:3:16']);
    expect(keys('1 Cor 13:4')).toEqual(['nt:1 Corinthians:13:4']);
    expect(keys('2 Tim 1:1')).toEqual(['nt:2 Timothy:1:1']);
    expect(keys('Ps 51:1')).toEqual(['ot:Psalms:51:1']);
    expect(keys('1 Pet 5:7')).toEqual(['nt:1 Peter:5:7']);
  });

  it('reads a dot as well as a colon', () => {
    expect(keys('Jn 3.16')).toEqual(keys('Jn 3:16'));
  });

  it('keys a Quran passage as sura:sura:ayah', () => {
    // A sura has no chapters, so the sura is stored in both the book and the
    // chapter position. Getting this wrong is not an error — it is a passage
    // key that exists and is not the verse anyone asked for.
    expect(keys('Q 2:255')).toEqual(['quran:2:2:255']);
    expect(keys('Quran 2:255')).toEqual(['quran:2:2:255']);
    expect(keys('Al-Baqarah 2:255')).toEqual(['quran:2:2:255']);
    expect(keys('Sura 112:1')).toEqual(['quran:112:112:1']);
  });

  it('does not resolve a bare chapter:verse without a corpus', () => {
    // "2:255" is a valid reference in all five corpora. Guessing the Quran would
    // be right most of the time and confidently wrong the rest.
    expect(parseCitation('2:255')).toEqual([]);
  });

  it('resolves tractates and their abbreviations', () => {
    expect(keys('Bava Metzia 2:5')).toEqual(['talmud:Bava Metzia:2:5']);
    expect(keys('BM 2:5')).toEqual(['talmud:Bava Metzia:2:5']);
    expect(keys('BK 2:5')).toEqual(['talmud:Berakhot:2:5']);
    expect(keys('Sotah 7:5')).toEqual(['talmud:Sotah:7:5']);
    expect(keys('Talmud Niddah 2:5')).toEqual(['talmud:Niddah:2:5']);
  });

  it('is case insensitive', () => {
    // A capital letter is the only thing separating a reference from a phrase.
    expect(keys('Talmud Niddah 2:5')).toEqual(keys('talmud niddah 2:5'));
    expect(keys('JOHN 3:16')).toEqual(keys('john 3:16'));
  });

  it('disambiguates suras that share a transliteration', () => {
    // Suras 1 and 45 are both Al-Fatihah. The chapter decides which.
    expect(keys('Al-Fatihah 1:1')).toEqual(['quran:1:1:1']);
    expect(keys('Al-Fatihah 45:1')).toEqual(['quran:45:45:1']);
  });

  it('does not invent a passage when the sura and the chapter disagree', () => {
    // "Al-Baqarah 255:1" names a sura that is not the chapter, and quran:2:255:1
    // does not exist. Dropping the candidate is right; keying it is not.
    expect(keys('Al-Baqarah 255:1')).toEqual([]);
  });

  it('returns nothing for prose', () => {
    for (const phrase of [
      'mercy',
      'what do these texts say about marriage',
      'see also John 3:16',
      'John 3',
      '',
      '   ',
      'is there anything about the poor',
    ]) {
      expect(parseCitation(phrase), `"${phrase}" should not parse`).toEqual([]);
    }
  });

  it('rejects impossible coordinates', () => {
    expect(parseCitation('John 0:0')).toEqual([]);
    expect(parseCitation('John 3:0')).toEqual([]);
  });

  it('rejects a reference that is absurdly long', () => {
    // A guard against a pasted paragraph being read as a book name.
    expect(parseCitation(`John ${'a'.repeat(100)} 3:16`)).toEqual([]);
  });

  it('reports unambiguity for navigation', () => {
    expect(isUnambiguousCitation('John 3:16')).toBe(true);
    expect(isUnambiguousCitation('Gen 1:1')).toBe(false);
    expect(isUnambiguousCitation('mercy')).toBe(false);
  });

  it('carries a display label for each match', () => {
    // The disambiguation list has to say something a reader recognises.
    const [match] = parseCitation('Gen 1:1');
    expect(match.bookLabel).toBe('Genesis');
    expect(match.textId).toBeDefined();
  });
});
