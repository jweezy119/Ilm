'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { englishAudioUrl } from './reciters';
import { createSpeechEngine, toSpeechPieces, type SpeechEngine } from './speech-engine';

/**
 * Reading a passage aloud in English: the recorded version if there is one, the
 * reader's own voice if there is not.
 *
 * Both are wanted, and neither replaces the other. The recording is the same every
 * time, costs nothing to serve, and works with no speech engine installed — which
 * is the reader this was built for. A device voice is better than a recording for
 * some people and worse for others, and it is the only option for a passage that
 * has not been generated yet. So the recording is tried first and the device is
 * the fallback, and which one happened is reported rather than assumed.
 *
 * The fallback matters more than it looks. Generation is staged by corpus, so for
 * weeks after switching this on some passages have a recording and some do not.
 * A reader who hits one without it should not meet a dead button, and the
 * difference is invisible unless it is announced.
 */

export type EnglishSource = 'recorded' | 'device' | 'none';

export interface SpeakEnglishOptions {
  /** Where a recording would be, or null. */
  audioUrl?: string | null;
  /** The passage's text, for when there is no recording or it fails. */
  text: string;
  rate?: number;
  onSource?: (source: EnglishSource) => void;
  onDone?: () => void;
  onError?: (error: unknown) => void;
}

export interface EnglishVoice {
  speak: (options: SpeakEnglishOptions) => Promise<void>;
  stop: () => void;
  source: EnglishSource;
}

/** True when the recorded file could not be loaded, which is not a failure. */
function isMissingAudio(error: unknown): boolean {
  const media = error as { code?: number } | null;
  // MEDIA_ERR_SRC_NOT_SUPPORTED / NETWORK. A 404 surfaces as one of these, and
  // the only correct response is to read it another way.
  return Boolean(media && (media.code === 3 || media.code === 2 || media.code === 4));
}

export function useEnglishVoice(): EnglishVoice {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const engineRef = useRef<SpeechEngine | null>(null);
  const stoppedRef = useRef(false);
  const [source, setSource] = useState<EnglishSource>('none');

  const stop = useCallback(() => {
    stoppedRef.current = true;
    const el = audioRef.current;
    if (el) {
      el.onended = null;
      el.onerror = null;
      el.pause();
    }
    engineRef.current?.stop();
    setSource('none');
  }, []);

  useEffect(() => stop, [stop]);

  const speakWithDevice = useCallback(async (text: string, rate: number | undefined) => {
    let engine = engineRef.current;
    if (!engine) {
      engine = await createSpeechEngine('en');
      engineRef.current = engine;
    }
    setSource('device');
    await engine.speakQueue(toSpeechPieces(undefined, text), { rate });
  }, []);

  const speak = useCallback(
    async (options: SpeakEnglishOptions) => {
      const { audioUrl, text, rate, onSource, onDone, onError } = options;
      stoppedRef.current = false;

      const url = audioUrl ?? null;
      if (url) {
        try {
          await new Promise<void>((resolve, reject) => {
            const el = new Audio(url);
            audioRef.current = el;
            el.preload = 'auto';
            el.playbackRate = rate ?? 1;
            el.onended = () => resolve();
            el.onerror = () => reject({ code: el.error?.code ?? 4 });
            el.play().catch(reject);
          });
          if (stoppedRef.current) return;
          setSource('recorded');
          onSource?.('recorded');
          onDone?.();
          return;
        } catch (error) {
          // A passage with no recording yet is the expected case while the
          // corpus is still being generated, so it is not reported as an error.
          if (!isMissingAudio(error) && !stoppedRef.current) {
            onError?.(error);
          }
          if (stoppedRef.current) return;
        }
      }

      try {
        await speakWithDevice(text, rate);
      } catch (error) {
        if (!stoppedRef.current) onError?.(error);
        return;
      }
      if (stoppedRef.current) return;
      onDone?.();
    },
    [speakWithDevice]
  );

  /*
   * Stable identity, deliberately.
   *
   * A fresh object literal here changes on every render, and a caller that stops
   * this hook in an effect cleanup — which both players do on unmount and whenever
   * the passage changes — then runs that cleanup after every render too. The stop
   * it invokes cancels the very playback that just started, so the English half
   * was cut off the moment the Arabic finished and nothing was ever spoken.
   *
   * Nothing here is recreated, so the object only changes when the source does.
   */
  return useMemo(() => ({ speak, stop, source }), [speak, stop, source]);
}

/**
 * The recorded reading for a passage key, or null.
 *
 * Named separately so a component that already has a key does not have to know
 * about the filename shape, and so the "is this switched on" question is asked in
 * one place.
 */
export function recordedFor(passageKey: string | null | undefined): string | null {
  return passageKey ? englishAudioUrl(passageKey) : null;
}
