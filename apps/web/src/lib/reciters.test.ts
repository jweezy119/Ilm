/**
 * The URL is derived from the passage key rather than stored, so the shapes it has
 * to refuse matter as much as the one it builds: a non-Quran passage, a hadith key
 * and a malformed key should all return null so the player is simply not offered,
 * rather than firing a request the CDN will 404.
 */

import { describe, it, expect } from 'vitest';
import { ayahAudioUrl, verseLabel, RECITERS, reciterById, DEFAULT_RECITER } from './reciters';

describe('ayahAudioUrl', () => {
  it('builds the CDN path from a Quran passage key', () => {
    expect(ayahAudioUrl('quran:2:1:255', 'alafasy')).toBe(
      'https://everyayah.com/data/Alafasy_128kbps/002255.mp3'
    );
    expect(ayahAudioUrl('quran:112:1:1', 'alafasy')).toBe(
      'https://everyayah.com/data/Alafasy_128kbps/112001.mp3'
    );
  });

  it('pads surah and verse to three digits', () => {
    expect(ayahAudioUrl('quran:1:1:1', 'alafasy')).toContain('/001001.mp3');
    expect(ayahAudioUrl('quran:114:1:6', 'alafasy')).toContain('/114006.mp3');
  });

  it('refuses passages from other corpora', () => {
    expect(ayahAudioUrl('nt:Matthew:3:16', 'alafasy')).toBeNull();
    expect(ayahAudioUrl('torah:Genesis:1:1', 'alafasy')).toBeNull();
    expect(ayahAudioUrl('talmud:Berakhot:2:1', 'alafasy')).toBeNull();
  });

  it('refuses a malformed or empty key', () => {
    expect(ayahAudioUrl('', 'alafasy')).toBeNull();
    expect(ayahAudioUrl('2:255', 'alafasy')).toBeNull();
    expect(ayahAudioUrl('quran:2:255', 'alafasy')).toBeNull();
    expect(ayahAudioUrl('quran:a:b:c', 'alafasy')).toBeNull();
  });

  it('refuses a Quran key whose chapter is not 1, which the CDN does not address', () => {
    expect(ayahAudioUrl('quran:2:7:255', 'alafasy')).toBeNull();
  });

  it('falls back to the default reciter for an unknown id, rather than building a dead URL', () => {
    expect(ayahAudioUrl('quran:2:1:255', 'does-not-exist')).toBe(
      ayahAudioUrl('quran:2:1:255', DEFAULT_RECITER.id)
    );
  });

  it('gives every reciter a distinct folder, so the select cannot collapse to one voice', () => {
    const folders = RECITERS.map((r) => r.folder);
    expect(new Set(folders).size).toBe(folders.length);
  });

  it('has no duplicate ids', () => {
    const ids = RECITERS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('verseLabel', () => {
  it('names the surah, not the chapter segment', () => {
    /*
     * A Quran key is quran:surah:1:ayah — chapter is pinned to 1. Reading the
     * chapter segment announced "1:255" for the second surah, which is not a
     * reference anyone could look up.
     */
    expect(verseLabel('quran:2:1:255')).toBe('2:255');
    expect(verseLabel('quran:112:1:1')).toBe('112:1');
    expect(verseLabel('quran:1:1:1')).toBe('1:1');
  });

  it('strips leading zeros', () => {
    expect(verseLabel('quran:002:1:255')).toBe('2:255');
  });

  it('hands back a key that is not a passage key rather than inventing a reference', () => {
    // It now shares passageReference's contract: a raw key is better than a
    // wrong reference, because a wrong one looks like something to look up.
    // passage-ref.test.ts covers this in full.
    expect(verseLabel('2:255')).toBe('2:255');
    expect(verseLabel('')).toBe('');
  });
});

describe('reciterById', () => {
  it('returns the default for an unknown id', () => {
    expect(reciterById('nope')).toBe(DEFAULT_RECITER);
  });
});