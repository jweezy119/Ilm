/**
 * Voice choice and utterance chunking are pure string work, and both have a
 * failure mode that is invisible until a reader with the wrong voices opens the
 * page: an Arabic passage read by an English voice, or a paragraph that stops
 * halfway and says nothing.
 */

import { describe, it, expect } from 'vitest';
import {
  speechLanguage,
  voiceScore,
  pickVoice,
  voiceMatchesLanguage,
  splitForSpeech,
  SPEECH_RATES,
  type SpeechVoice,
} from './speech';

const v = (name: string, lang: string, extra: Partial<SpeechVoice> = {}): SpeechVoice => ({
  name,
  lang,
  localService: true,
  default: false,
  ...extra,
});

describe('speechLanguage', () => {
  it('speaks the language of the translation, not of the original or the interface', () => {
    /*
     * Every translation in this corpus is English, including the Quran's — a
     * reader following Sahih is reading English. Tagging it `ar` asks the
     * browser to pronounce English with an Arabic voice, which is a wrong answer
     * delivered without an error. The Quran's Arabic is the recitation's job.
     */
    for (const id of ['quran', 'torah', 'talmud', 'ot', 'nt', 'bukhari', 'muslim']) {
      expect(speechLanguage(id).tag, `${id} should speak its translation`).toBe('en');
      expect(speechLanguage(id).rtl).toBe(false);
    }
  });

  it('never tags the Quran as Arabic, which is the mistake this guards', () => {
    expect(speechLanguage('quran').tag).not.toBe('ar');
  });

  it('gives every corpus a real BCP-47 tag', () => {
    for (const id of ['quran', 'torah', 'talmud', 'ot', 'nt', 'bukhari', 'muslim']) {
      expect(speechLanguage(id).tag).toMatch(/^[a-z]{2}(-[A-Za-z]+)?$/);
    }
  });
});

describe('voiceScore', () => {
  it('prefers an exact language match over a neighbouring one', () => {
    const exact = voiceScore(v('A', 'ar-EG'), 'ar');
    const wrong = voiceScore(v('B', 'en-US'), 'ar');
    expect(exact).toBeGreaterThan(wrong);
  });

  it('prefers a local voice over a remote one at the same language', () => {
    const local = voiceScore(v('L', 'ar-EG', { localService: true }), 'ar');
    const remote = voiceScore(v('R', 'ar-EG', { localService: false }), 'ar');
    expect(local).toBeGreaterThan(remote);
  });

  it('treats a regional variant as usable but below an exact match', () => {
    const exact = voiceScore(v('A', 'en-GB'), 'en-GB');
    const variant = voiceScore(v('B', 'en-AU'), 'en-GB');
    expect(exact).toBeGreaterThan(variant);
    expect(variant).toBeGreaterThan(-1);
  });

  it('refuses a voice in an unrelated language', () => {
    expect(voiceScore(v('A', 'en-US'), 'ar')).toBe(-1);
    expect(voiceScore(v('A', 'he-IL'), 'ar')).toBe(-1);
  });

  it('will fall back to a default voice rather than refusing to speak', () => {
    // Refusing outright is worse than a wrong accent, and the caller is told
    // which happened by voiceMatchesLanguage.
    expect(voiceScore(v('A', 'en-US', { default: true }), 'ar')).toBeGreaterThan(0);
  });

  it('ignores case and underscore formatting', () => {
    expect(voiceScore(v('A', 'en_US'), 'en-US')).toBe(voiceScore(v('A', 'en-US'), 'EN-us'));
  });
});

describe('pickVoice', () => {
  it('picks the best voice for the language', () => {
    const voices = [v('En', 'en-US'), v('Ar', 'ar-EG', { localService: false }), v('ArLocal', 'ar-EG')];
    expect(pickVoice(voices, 'ar')?.name).toBe('ArLocal');
    expect(pickVoice(voices, 'en')?.name).toBe('En');
  });

  it('is undefined when there are no voices at all', () => {
    // Which is the state a headless browser is in, and a device with no engine.
    expect(pickVoice([], 'en')).toBeUndefined();
  });
});

describe('voiceMatchesLanguage', () => {
  it('reports a mismatch rather than hiding it', () => {
    expect(voiceMatchesLanguage(v('A', 'en-US'), 'ar')).toBe(false);
    expect(voiceMatchesLanguage(v('A', 'ar-EG'), 'ar')).toBe(true);
    expect(voiceMatchesLanguage(undefined, 'ar')).toBe(false);
  });
});

describe('splitForSpeech', () => {
  it('leaves a short text in one piece', () => {
    expect(splitForSpeech('And how can you have patience')).toEqual(['And how can you have patience']);
  });

  it('never exceeds the budget, so a browser cannot abandon it partway', () => {
    const long = 'And there are signs in the creation of the heavens and the earth. '.repeat(40);
    for (const piece of splitForSpeech(long, 220)) {
      expect(piece.length).toBeLessThanOrEqual(220);
    }
  });

  it('breaks on sentence boundaries so the wording is unchanged', () => {
    const parts = splitForSpeech(
      'Allah - there is no deity except Him. To Him belongs whatever is in the heavens and the earth. Who is it that can intercede with Him except by His permission?',
      60
    );
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toBe('Allah - there is no deity except Him.');
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(
      'Allah - there is no deity except Him. To Him belongs whatever is in the heavens and the earth. Who is it that can intercede with Him except by His permission?'
    );
  });

  it('keeps the Arabic full stop as a boundary', () => {
    const parts = splitForSpeech('بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ۔الحمد لله رب العالمين ۔', 20);
    expect(parts.length).toBeGreaterThan(1);
  });

  it('splits a single enormous sentence on commas rather than mid-word', () => {
    const parts = splitForSpeech(
      'a'.repeat(40) + ',' + 'b'.repeat(40) + ',' + 'c'.repeat(40),
      50
    );
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(50);
  });

  it('collapses whitespace so a passage with line breaks reads as prose', () => {
    expect(splitForSpeech('  And   how\n can you  ')).toEqual(['And how can you']);
  });

  it('returns nothing for empty text', () => {
    expect(splitForSpeech('')).toEqual([]);
    expect(splitForSpeech('   ')).toEqual([]);
  });
});

describe('SPEECH_RATES', () => {
  it('offers slower and slightly faster, not unreadably fast', () => {
    expect(SPEECH_RATES).toContain(1);
    expect(Math.min(...SPEECH_RATES)).toBeLessThan(1);
    expect(Math.max(...SPEECH_RATES)).toBeLessThanOrEqual(1.25);
  });
});