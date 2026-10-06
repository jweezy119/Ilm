'use client';

/**
 * Speaking text, whichever engine is available.
 *
 * Extracted from the read-aloud control so that the bilingual Quran player can
 * speak its English half through exactly the same machinery — the same voice
 * choice, the same fallback, the same loading of the built-in engine. Two copies
 * of that would drift, and the copy that matters most is the one nobody looks at.
 *
 * Resolution order, and why: a voice from the operating system is always better
 * and always free, so it is used whenever there is one. The built-in WebAssembly
 * engine is the fallback, and it is only ever loaded when there is genuinely
 * nothing. Asking for a built-in voice before trying the device voice would load
 * 1.8 MB for readers who did not need it.
 */

import { pickVoice, voiceMatchesLanguage, splitForSpeech, type SpeechVoice } from './speech';
import { createRoboticVoice, roboticVoicePossible, type RoboticVoice } from './robotic-voice';

/**
 * The voice list, waiting briefly for it to arrive if it has not.
 *
 * `getVoices()` returns an empty array until the browser has loaded the system's
 * voices and announces it with `voiceschanged`. Chrome does this on a cold page and
 * Firefox does it on some platforms, so reading it once at press time told
 * readers with perfectly good voices that they had none — because they pressed
 * within the second of the page opening.
 */
export async function voicesWhenReady(
  synth: SpeechSynthesis,
  timeoutMs = 1500
): Promise<SpeechVoice[]> {
  const immediate = synth.getVoices() as SpeechVoice[];
  if (immediate.length > 0) return immediate;

  // Some engines populate silently and never fire the event, so the list is read
  // again on the timer as well as on the event.
  return new Promise<SpeechVoice[]>((resolve) => {
    let settled = false;
    const finish = (voices: SpeechVoice[]) => {
      if (settled) return;
      settled = true;
      synth.removeEventListener('voiceschanged', onChanged);
      clearTimeout(timer);
      resolve(voices);
    };
    const onChanged = () => finish(synth.getVoices() as SpeechVoice[]);
    const timer = setTimeout(() => finish(synth.getVoices() as SpeechVoice[]), timeoutMs);
    try {
      synth.addEventListener('voiceschanged', onChanged);
    } catch {
      // An engine without events still gets polled by the timer.
    }
  });
}

/** One piece of a queue: text, and the reference a listener should hear first. */
export interface SpeechPiece {
  label?: string;
  text: string;
}

export interface SpeakOptions {
  rate?: number;
  /** Called before each piece, for announcing where the reader is. */
  onPiece?: (piece: SpeechPiece, index: number) => void;
  onDone?: () => void;
  onError?: (error: unknown) => void;
}

export interface SpeechEngine {
  readonly kind: 'device' | 'robotic' | 'cloud';
  /** Resolves when the queue has finished, been stopped, or failed. */
  speakQueue(pieces: SpeechPiece[], options?: SpeakOptions): Promise<void>;
  stop(): void;
  /** True when the device's language does not match and it will be off-accent. */
  readonly wrongLanguage: string | null;
}

/**
 * An engine for `langTag`, preferring the device's own voices.
 *
 * Throws when nothing can speak — no speech synthesis at all, or a built-in engine
 * that would not load — so a caller can say so rather than leaving a button that
 * does nothing.
 */
export async function createSpeechEngine(langTag = 'en'): Promise<SpeechEngine> {
  if (typeof window === 'undefined') throw new Error('speech: no window');

  // We default to the natural Cloud TTS proxy
  return cloudEngine(langTag);
}

function cloudEngine(langTag: string): SpeechEngine {
  let cancelled = false;
  let currentAudio: HTMLAudioElement | null = null;

  const stop = () => {
    cancelled = true;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.removeAttribute('src');
      currentAudio.load();
      currentAudio = null;
    }
  };

  return {
    kind: 'cloud',
    wrongLanguage: null,
    stop,
    speakQueue(pieces, options) {
      return new Promise<void>((resolve) => {
        stop();
        cancelled = false;

        let index = 0;
        const next = () => {
          if (cancelled) {
            resolve();
            return;
          }
          const piece = pieces[index];
          if (!piece) {
            options?.onDone?.();
            resolve();
            return;
          }
          options?.onPiece?.(piece, index);

          const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(langTag)}&client=tw-ob&q=${encodeURIComponent(piece.text)}`;
          const audio = new window.Audio(audioUrl);
          currentAudio = audio;

          if (options?.rate) {
            audio.playbackRate = options.rate;
            audio.defaultPlaybackRate = options.rate;
          }

          audio.onended = () => {
            if (cancelled) return;
            index += 1;
            next();
          };

          audio.onerror = async () => {
            if (cancelled) return;
            // Fallback to device or robotic engine
            console.warn('Cloud TTS failed, falling back...');
            try {
              const fallback = await createFallbackEngine(langTag);
              await fallback.speakQueue(pieces.slice(index), options);
            } catch (err) {
              options?.onError?.(new Error('speech: all engines failed'));
            }
            resolve();
          };

          audio.play().catch(async (err) => {
            if (cancelled) return;
            console.warn('Cloud TTS playback failed, falling back...', err);
            try {
              const fallback = await createFallbackEngine(langTag);
              await fallback.speakQueue(pieces.slice(index), options);
            } catch (fallbackErr) {
              options?.onError?.(err);
            }
            resolve();
          });
        };

        next();
      });
    },
  };
}

export async function createFallbackEngine(langTag = 'en'): Promise<SpeechEngine> {
  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  if (synth) {
    const available = await voicesWhenReady(synth);
    if (available.length > 0) {
      const voice = pickVoice(available, langTag);
      return deviceEngine(synth, voice, voiceMatchesLanguage(voice, langTag) ? null : voice?.lang ?? null);
    }
  }

  if (roboticVoicePossible()) {
    const voice = await createRoboticVoice();
    return roboticEngine(voice);
  }

  throw new Error('speech: no engine available');
}

function deviceEngine(
  synth: SpeechSynthesis,
  voice: SpeechVoice | undefined,
  wrongLanguage: string | null
): SpeechEngine {
  let cancelled = false;

  const stop = () => {
    cancelled = true;
    synth.cancel();
  };

  return {
    kind: 'device',
    stop,
    wrongLanguage,
    speakQueue(pieces, options) {
      return new Promise<void>((resolve) => {
        synth.cancel();
        cancelled = false;

        let index = 0;
        const next = () => {
          if (cancelled) {
            resolve();
            return;
          }
          const piece = pieces[index];
          if (!piece) {
            options?.onDone?.();
            resolve();
            return;
          }
          options?.onPiece?.(piece, index);

          const utterance = new SpeechSynthesisUtterance(piece.text);
          utterance.lang = voice?.lang ?? 'en';
          /*
           * Guarded, because the setter validates its argument and the list
           * changes while the page is open — a voice can be installed or removed
           * between being read and being used.
           *
           * A rejected assignment throws out of here, which is swallowed by the
           * promise chain the speech API uses, so the queue stops in silence: a
           * reader hears the Arabic and then nothing at all, with no error and no
           * explanation. Losing the voice is cheap; losing the explanation of the
           * verse they asked to hear is not.
           */
          if (voice) {
            try {
              utterance.voice = voice as unknown as SpeechSynthesisVoice;
            } catch {
              // The browser picks for itself.
            }
          }
          utterance.rate = options?.rate ?? 1;
          utterance.onend = () => {
            index += 1;
            next();
          };
          utterance.onerror = () => {
            options?.onError?.(new Error('speech: playback failed'));
            resolve();
          };
          synth.speak(utterance);
        };

        next();
      });
    },
  };
}

function roboticEngine(voice: RoboticVoice): SpeechEngine {
  return {
    kind: 'robotic',
    // The built-in engine carries an English voice only, so a request in another
    // language would be pronounced with the wrong one. Saying so is better than
    // hearing it.
    wrongLanguage: null,
    stop: () => voice.stop(),
    async speakQueue(pieces, options) {
      for (let index = 0; index < pieces.length; index += 1) {
        const piece = pieces[index];
        options?.onPiece?.(piece, index);
        try {
          await voice.speak(piece.text, { rate: options?.rate });
        } catch (error) {
          options?.onError?.(error);
          return;
        }
      }
      options?.onDone?.();
    },
  };
}

/**
 * Turn a passage into speakable pieces, splitting long text so a browser does not
 * abandon it partway through.
 *
 * Exported because the split is a decision worth making once: browsers give up on
 * anything much over fifteen seconds and then say nothing, which reads as a broken
 * button rather than a long passage.
 */
export function toSpeechPieces(
  segments: Array<{ label: string; text: string }> | undefined,
  text: string | undefined
): SpeechPiece[] {
  if (segments?.length) {
    return segments.flatMap((segment) =>
      splitForSpeech(segment.text).map((chunk) => ({ label: segment.label, text: chunk }))
    );
  }
  return splitForSpeech(text ?? '').map((chunk) => ({ text: chunk }));
}
