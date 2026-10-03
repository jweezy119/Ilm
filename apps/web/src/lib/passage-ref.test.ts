/**
 * One rule for how a passage is written down, because getting it wrong looks like
 * a reference nobody can look up.
 *
 * A Quran key is quran:surah:1:ayah — the chapter segment is pinned to 1 — so the
 * naive `chapter:verse` prints "1:255" for Al-Baqarah 2:255. The recitation player
 * did exactly that until a browser test listened to it announce "Now playing
 * 1:255", and the same mistake would have put it on the graph and in the journey
 * list next.
 */

import { describe, it, expect } from 'vitest';
import { passageReference } from './passage-ref';

describe('passageReference', () => {
  it('reads the surah from the book segment, because the Quran chapter is pinned', () => {
    expect(passageReference('quran:2:1:255')).toBe('2:255');
    expect(passageReference('quran:112:1:1')).toBe('112:1');
    expect(passageReference('quran:1:1:1')).toBe('1:1');
  });

  it('does not mistake the surah for the chapter', () => {
    // The failure this exists to prevent: chapter is 1 for every Quran verse, so
    // anything reading it prints "1:255".
    expect(passageReference('quran:2:1:255')).not.toBe('1:255');
    expect(passageReference('quran:18:1:68')).not.toBe('1:68');
  });

  it('uses chapter:verse for every other corpus', () => {
    expect(passageReference('nt:Matthew:5:14')).toBe('5:14');
    expect(passageReference('torah:Genesis:1:1')).toBe('1:1');
    expect(passageReference('talmud:Berakhot:2:1')).toBe('2:1');
  });

  it('strips leading zeros', () => {
    expect(passageReference('quran:002:1:255')).toBe('2:255');
    expect(passageReference('nt:Matthew:05:09')).toBe('5:9');
  });

  it('handles a book slug', () => {
    expect(passageReference('nt:Matthew:05:09')).toBe('5:9');
  });

  it('returns the key unchanged when it is not a passage key', () => {
    // Better a raw key than a wrong reference.
    expect(passageReference('2:255')).toBe('2:255');
    expect(passageReference('')).toBe('');
    expect(passageReference('nonsense')).toBe('nonsense');
  });
});