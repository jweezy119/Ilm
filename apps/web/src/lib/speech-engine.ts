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
  volume?: number;
  /** Called before each piece, for announcing where the reader is. */
  onPiece?: (piece: SpeechPiece, index: number) => void;
  /** Live playback time updates for the active audio chunk (seconds). */
  onProgress?: (currentTime: number, duration: number) => void;
  onDone?: () => void;
  onError?: (error: unknown) => void;
}

export interface SpeechEngine {
  readonly kind: 'device' | 'robotic' | 'cloud';
  /** Resolves when the queue has finished, been stopped, or failed. */
  speakQueue(pieces: SpeechPiece[], options?: SpeakOptions): Promise<void>;
  stop(): void;
  /** Adjust volume (0-1) live without restarting playback. */
  setVolume?(volume: number): void;
  /** Adjust playback rate live without restarting playback. */
  setRate?(rate: number): void;
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
  let runId = 0;
  let currentAudio: HTMLAudioElement | null = null;
  let activeFallback: SpeechEngine | null = null;
  let activeResolve: (() => void) | null = null;
  let liveVolume = 1;
  let liveRate = 1;

  const setVolume = (volume: number) => {
    liveVolume = Math.max(0, Math.min(1, volume));
    if (currentAudio) currentAudio.volume = liveVolume;
    activeFallback?.setVolume?.(liveVolume);
  };

  const setRate = (rate: number) => {
    liveRate = Math.max(0.5, Math.min(3, rate));
    if (currentAudio) {
      currentAudio.playbackRate = liveRate;
      currentAudio.defaultPlaybackRate = liveRate;
    }
    activeFallback?.setRate?.(liveRate);
  };

  const stop = () => {
    runId += 1;
    if (currentAudio) {
      // Detach handlers before pausing/clearing so stopping never triggers
      // an asynchronous `onerror` or fallback cascade.
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.ontimeupdate = null;
      currentAudio.onloadedmetadata = null;
      currentAudio.pause();
      currentAudio.removeAttribute('src');
      currentAudio = null;
    }
    if (activeFallback) {
      activeFallback.stop();
      activeFallback = null;
    }
    if (activeResolve) {
      const done = activeResolve;
      activeResolve = null;
      done();
    }
  };

  return {
    kind: 'cloud',
    wrongLanguage: null,
    stop,
    setVolume,
    setRate,
    speakQueue(pieces, options) {
      return new Promise<void>((resolve) => {
        stop();
        const myRun = runId;
        if (typeof options?.volume === 'number') {
          liveVolume = Math.max(0, Math.min(1, options.volume));
        }
        if (typeof options?.rate === 'number') {
          liveRate = Math.max(0.5, Math.min(3, options.rate));
        }
        const finish = () => {
          if (activeResolve === finish) activeResolve = null;
          resolve();
        };
        activeResolve = finish;

        let index = 0;
        const next = () => {
          if (myRun !== runId) {
            finish();
            return;
          }
          const piece = pieces[index];
          if (!piece) {
            options?.onDone?.();
            finish();
            return;
          }
          options?.onPiece?.(piece, index);

          const audioUrl = `/api/tts?text=${encodeURIComponent(piece.text)}&lang=${encodeURIComponent(langTag)}`;
          const audio = new window.Audio(audioUrl);
          currentAudio = audio;

          audio.volume = liveVolume;
          audio.playbackRate = liveRate;
          audio.defaultPlaybackRate = liveRate;

          const reportProgress = () => {
            if (myRun !== runId) return;
            const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
            options?.onProgress?.(audio.currentTime || 0, dur);
          };
          audio.ontimeupdate = reportProgress;
          audio.onloadedmetadata = reportProgress;

          // Both `audio.onerror` and `audio.play().catch()` fire on HTTP/network
          // failures in Chromium and Firefox; deduplicate so at most one fallback
          // engine starts, and track it so `stop()` silences it cleanly.
          let handledFailure = false;
          const handleFailure = async (err: unknown) => {
            if (handledFailure || myRun !== runId) return;
            handledFailure = true;
            audio.onended = null;
            audio.onerror = null;
            audio.ontimeupdate = null;
            audio.onloadedmetadata = null;
            audio.pause();
            if (currentAudio === audio) currentAudio = null;

            console.warn('Cloud TTS failed, falling back...', err);
            try {
              const fallback = await createFallbackEngine(langTag);
              if (myRun !== runId) {
                fallback.stop();
                finish();
                return;
              }
              activeFallback = fallback;
              fallback.setVolume?.(liveVolume);
              fallback.setRate?.(liveRate);
              await fallback.speakQueue(pieces.slice(index), { ...options, rate: liveRate, volume: liveVolume });
              if (activeFallback === fallback) activeFallback = null;
            } catch (fallbackErr) {
              if (myRun === runId) {
                options?.onError?.(fallbackErr instanceof Error ? fallbackErr : new Error('speech: all engines failed'));
              }
            }
            finish();
          };

          audio.onended = () => {
            if (myRun !== runId) return;
            audio.ontimeupdate = null;
            audio.onloadedmetadata = null;
            if (currentAudio === audio) currentAudio = null;
            index += 1;
            next();
          };

          audio.onerror = () => {
            void handleFailure(new Error('speech: cloud audio failed'));
          };

          audio.play().catch((err) => {
            void handleFailure(err);
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
  let runId = 0;
  let activeResolve: (() => void) | null = null;
  let liveVolume = 1;
  let liveRate = 1;

  const stop = () => {
    runId += 1;
    synth.cancel();
    if (activeResolve) {
      const done = activeResolve;
      activeResolve = null;
      done();
    }
  };

  return {
    kind: 'device',
    stop,
    setVolume: (v) => {
      liveVolume = Math.max(0, Math.min(1, v));
    },
    setRate: (r) => {
      liveRate = Math.max(0.5, Math.min(3, r));
    },
    wrongLanguage,
    speakQueue(pieces, options) {
      return new Promise<void>((resolve) => {
        stop();
        const myRun = runId;
        if (typeof options?.volume === 'number') liveVolume = Math.max(0, Math.min(1, options.volume));
        if (typeof options?.rate === 'number') liveRate = Math.max(0.5, Math.min(3, options.rate));
        const finish = () => {
          if (activeResolve === finish) activeResolve = null;
          resolve();
        };
        activeResolve = finish;

        let index = 0;
        const next = () => {
          if (myRun !== runId) {
            finish();
            return;
          }
          const piece = pieces[index];
          if (!piece) {
            options?.onDone?.();
            finish();
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
          utterance.rate = liveRate;
          utterance.volume = liveVolume;
          utterance.onend = () => {
            if (myRun !== runId) return;
            index += 1;
            next();
          };
          utterance.onerror = (event) => {
            if (myRun !== runId) return;
            // Calling synth.cancel() fires `canceled` / `interrupted` asynchronously;
            // those are intentional stops, not playback failures.
            const code = (event as { error?: string } | undefined)?.error;
            if (code === 'canceled' || code === 'interrupted') {
              finish();
              return;
            }
            options?.onError?.(new Error('speech: playback failed'));
            finish();
          };
          synth.speak(utterance);
        };

        next();
      });
    },
  };
}

function roboticEngine(voice: RoboticVoice): SpeechEngine {
  let runId = 0;
  return {
    kind: 'robotic',
    // The built-in engine carries an English voice only, so a request in another
    // language would be pronounced with the wrong one. Saying so is better than
    // hearing it.
    wrongLanguage: null,
    stop: () => {
      runId += 1;
      voice.stop();
    },
    async speakQueue(pieces, options) {
      runId += 1;
      const myRun = runId;
      for (let index = 0; index < pieces.length; index += 1) {
        if (myRun !== runId) return;
        const piece = pieces[index];
        options?.onPiece?.(piece, index);
        try {
          await voice.speak(piece.text, { rate: options?.rate });
        } catch (error) {
          if (myRun === runId) options?.onError?.(error);
          return;
        }
      }
      if (myRun === runId) options?.onDone?.();
    },
  };
}

/**
 * Turn a passage into speakable pieces, splitting long text so a browser does not
 * abandon it partway through.
 *
 * Kept at 180 characters so every piece also fits inside Google Translate TTS's
 * 200-character upstream ceiling without extra server-side round trips.
 */
export function toSpeechPieces(
  segments: Array<{ label: string; text: string }> | undefined,
  text: string | undefined
): SpeechPiece[] {
  if (segments?.length) {
    return segments.flatMap((segment) =>
      splitForSpeech(segment.text, 180).map((chunk) => ({ label: segment.label, text: chunk }))
    );
  }
  return splitForSpeech(text ?? '', 180).map((chunk) => ({ text: chunk }));
}
