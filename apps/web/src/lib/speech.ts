/**
 * Read aloud, for every corpus.
 *
 * Recitation and speech synthesis are different things and this file keeps them
 * apart. A recitation is a human voice, and the Quran has one for free from the
 * everyayah CDN. No other corpus here does: there is no free per-verse Hebrew,
 * Aramaic or Greek recitation, so "add audio to the Talmud" cannot honestly mean
 * the same thing.
 *
 * What it can mean is reading the text aloud with a voice the reader's own device
 * already has. That is not a recitation and the UI says so — a synthetic voice
 * presenting itself as one would be the same overstatement this library is built
 * against, just in the other direction.
 *
 * The consequence for design: Quran passages get both, and the reciter is the
 * default because it is the better thing. Every other passage gets read aloud
 * only. Nobody is told a recitation exists where none does.
 *
 * What is read is the translation — the thing on screen. The original text is a
 * separate, script-specific rendering and a reader following the translation does
 * not expect to be answered in Hebrew.
 */

/** What the control is doing, so the UI can name it honestly. */
export type SpeechKind = 'recitation' | 'read-aloud';

export interface CorpusLanguage {
  /** BCP-47 tag for SpeechSynthesis. */
  tag: string;
  /** Shown in the voice picker and to a screen reader. */
  label: string;
  /** RTL, so an utterance in it is still played and described correctly. */
  rtl: boolean;
}

/**
 * The language of the *translation*, which is what read aloud speaks.
 *
 * Every translation in this corpus is English — Sahih, Pickthall and Yusuf Ali
 * for the Quran, KJV for the Hebrew Bible and the New Testament, Sefaria's
 * English for the Talmud — so the answer is English everywhere, including for
 * the Quran.
 *
 * That last one is the trap. The Quran's *original* is Arabic, and a reader
 * following the translation is reading English; tagging its speech as `ar` asks
 * the browser to pronounce an English translation with an Arabic voice. It is
 * also the quiet version of the mistake this file exists to avoid, because a
 * wrong `lang` produces something that sounds wrong rather than an error.
 *
 * The Quran's Arabic is not lost to this: it is what the recitation plays, from
 * a human, which is a better answer anyway.
 *
 * Kept per corpus because it is the one place to change if a corpus gains a
 * translation in another language, and because "which language is this?" is a
 * question worth answering in one function rather than at every call site.
 */
export function speechLanguage(textId: string): CorpusLanguage {
  switch (textId) {
    default:
      return { tag: 'en', label: 'English', rtl: false };
  }
}

/** A voice as far as this module cares. Narrow on purpose, so it is testable. */
export interface SpeechVoice {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

/**
 * Rank a voice for a language.
 *
 * Exact tag first, then the same base language, then anything. A device with
 * `en-GB` and `en-US` reading English does not care which it gets; a device with
 * only `ar` voices should not be handed an English passage and called helpful.
 * Local voices win ties because they cost nothing and work offline.
 *
 * Returns -1 for "not usable", so a caller can filter with one comparison.
 */
export function voiceScore(voice: SpeechVoice, tag: string): number {
  const voiceLang = (voice.lang || '').toLowerCase().replace('_', '-');
  const want = (tag || '').toLowerCase().replace('_', '-');
  if (!want) return voice.default ? 1 : 0;

  if (voiceLang === want) {
    return (voice.localService ? 40 : 20) + (voice.default ? 5 : 0);
  }

  const voiceBase = voiceLang.split('-')[0];
  const wantBase = want.split('-')[0];
  if (voiceBase && voiceBase === wantBase) {
    // A regional variant of the right language: usable, but below an exact match.
    return (voice.localService ? 15 : 8) + (voice.default ? 2 : 0);
  }

  // Nothing in this language. A default voice is a last resort rather than -1,
  // because refusing to speak at all is worse than speaking in the wrong accent,
  // and the caller is told which happened by the language it reports back.
  return voice.default ? 0.5 : -1;
}

export function pickVoice(voices: SpeechVoice[], tag: string): SpeechVoice | undefined {
  let best: SpeechVoice | undefined;
  let bestScore = 0;
  for (const voice of voices) {
    const score = voiceScore(voice, tag);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Whether the chosen voice actually speaks the language.
 *
 * Reported separately from the voice itself so the UI can say "read aloud in a
 * voice for a different language" rather than quietly mispronouncing. A wrong
 * accent is a small problem; an unannounced one is a rude one.
 */
export function voiceMatchesLanguage(voice: SpeechVoice | undefined, tag: string): boolean {
  if (!voice) return false;
  const voiceBase = (voice.lang || '').toLowerCase().split('-')[0];
  const wantBase = (tag || '').toLowerCase().split('-')[0];
  return Boolean(voiceBase && voiceBase === wantBase);
}

/**
 * Split text into utterance-sized pieces.
 *
 * Browsers stop long utterances partway through — Chrome gives up around
 * fifteen seconds — and then say nothing, which reads as a broken button. Sentence
 * boundaries keep each piece short enough to finish, and the split is on
 * punctuation so the wording is unchanged.
 */
export function splitForSpeech(text: string, maxChars = 220): string[] {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.match(/[^.!?؟۔。]+[.!?؟۔。]*\s*/g) ?? [clean];
  const out: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (buffer && buffer.length + trimmed.length + 1 > maxChars) {
      out.push(buffer);
      buffer = trimmed;
    } else if (buffer) {
      buffer = `${buffer} ${trimmed}`;
    } else {
      buffer = trimmed;
    }

    // A single sentence longer than the budget is split on a comma rather than
    // cut mid-word, which would be audible.
    if (buffer.length > maxChars) {
      const parts = buffer.match(/[^,;:،؛]+[,;:،؛]?\s*/g) ?? [buffer];
      buffer = '';
      for (const part of parts) {
        const t = part.trim();
        if (!t) continue;
        if (t.length > maxChars) {
          out.push(...t.match(new RegExp(`.{1,${maxChars}}(\\s|$)`, 'g'))?.map((s) => s.trim()) ?? [t]);
        } else {
          out.push(t);
        }
      }
    }
  }

  if (buffer) out.push(buffer);
  return out.filter(Boolean);
}

/** RATE at 1 is the platform default; below that is legible, above it is not. */
export const SPEECH_RATES = [0.75, 1, 1.25] as const;