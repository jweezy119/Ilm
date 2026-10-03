'use client';

/**
 * A fallback voice for devices whose browser has no speech engine.
 *
 * Most browsers can already speak using a voice from the operating system, and
 * that is always preferred: it is the better voice, and it costs nothing. This
 * exists for the rest — Firefox on Linux without speech-dispatcher, headless
 * environments, some webviews — where the alternative is that a reader presses
 * the button and nothing happens at all.
 *
 * It is eSpeak NG, compiled to WebAssembly and bundled into one file on our own
 * origin by `apps/api/scripts/build-robotic-voice.mjs`. It is synthetic and
 * plainly sounds it, which is stated wherever it is offered. A robotic voice
 * reading scripture is worse than a good one and much better than none, and the
 * reader is the only person who can decide which of those they have been given.
 *
 * Three decisions worth recording.
 *
 * It is not bundled into the app. The engine glue is 4.9 MB of emscripten output
 * that Next's bundler refuses to parse at all, and the alternatives are worse:
 * shipping 6 MB to readers who mostly never need it, or pulling it from a CDN at
 * the moment somebody is relying on an accessibility feature. It is loaded from
 * our own origin, once, only on the press that needs it.
 *
 * Playback is ours rather than the library's. meSpeak can play a generated buffer
 * itself, but going through decodeAudioData and a BufferSource means stop is
 * immediate and "finished" is a promise, so a chapter can be read as a queue
 * without polling or timers.
 *
 * And it uses only current Web Audio. The older meSpeak route played through a
 * ScriptProcessorNode, which is deprecated and has been removed from Firefox —
 * so the version this replaces would have failed in exactly one of the two
 * browsers most likely to have no voice installed.
 */

export interface RoboticVoice {
  /** Resolves when the utterance has finished, or immediately after `stop`. */
  speak(text: string, options?: { rate?: number }): Promise<void>;
  /** Stops immediately. Safe to call when nothing is playing. */
  stop(): void;
}

interface EngineGlobal {
  generate(text: string, speed: number): ArrayBuffer | null;
}

declare global {
  interface Window {
    __ilmRoboticVoice?: EngineGlobal;
  }
}

const ENGINE_URL = '/vendor/ilm-robotic-voice.js';

/**
 * The path, named so a test can assert the engine is served from here rather than
 * from wherever it happened to resolve when written.
 */
export const ENGINE_URL_HINT = ENGINE_URL;

/**
 * Words per minute, against the speed control's multipliers.
 *
 * meSpeak's default is 175 wpm, roughly the rate a person reads aloud, so the
 * multipliers mean the same thing whichever engine is speaking.
 */
const BASE_WPM = 175;
const WPM_MIN = 80;
const WPM_MAX = 450;

function wpmFor(rate: number | undefined): number {
  return Math.max(WPM_MIN, Math.min(WPM_MAX, Math.round(BASE_WPM * (rate ?? 1))));
}

let loading: Promise<EngineGlobal> | null = null;

function loadEngine(): Promise<EngineGlobal> {
  if (loading) return loading;

  loading = (async () => {
    if (typeof window === 'undefined') throw new Error('no window');

    const existing = window.__ilmRoboticVoice;
    if (existing) return existing;

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = ENGINE_URL;
      script.async = true;
      // The engine is only worth reaching for if it actually arrived, and a
      // 404 here must not leave a promise pending forever.
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('robotic voice: engine did not load'));
      document.head.appendChild(script);
    });

    const engine = window.__ilmRoboticVoice;
    if (!engine) throw new Error('robotic voice: engine did not register');

    /*
     * Prove it works by making it speak, rather than by asking it whether it is
     * ready.
     *
     * There was a readiness flag, computed from the engine's own isConfigLoaded()
     * and isVoiceLoaded('en') the moment the script ran, and it was always false:
     * the emscripten module initialises asynchronously, so the dictionary is not
     * registered yet at that instant even though generate() works a moment later.
     * Checking a flag rejected a perfectly good engine and sent every reader back
     * to the install-a-voice page.
     */
    const probe = engine.generate('one', BASE_WPM);
    if (!probe || probe.byteLength === 0) {
      throw new Error('robotic voice: engine loaded but produced no audio');
    }
    return engine;
  })();

  return loading.catch((error) => {
    // A failed load must not be cached, or the fallback is dead for the life of
    // the page after one transient failure.
    loading = null;
    throw error;
  });
}

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/**
 * The fallback, ready to use.
 *
 * Throws if it cannot be built — no WebAssembly, a blocked chunk, a network
 * failure — so the caller can say so rather than leaving a button that does
 * nothing.
 */
export async function createRoboticVoice(): Promise<RoboticVoice> {
  const engine = await loadEngine();
  const context = audioContext();
  if (!context) throw new Error('robotic voice: no Web Audio in this browser');

  let current: AudioBufferSourceNode | null = null;

  const stop = () => {
    if (!current) return;
    try {
      current.onended = null;
      current.stop();
    } catch {
      // Already stopped, which is the state being asked for.
    }
    current = null;
    void context.suspend().catch(() => undefined);
  };

  return {
    stop,
    speak(text, options) {
      const trimmed = text.trim();
      if (!trimmed) return Promise.resolve();

      return new Promise<void>((resolve, reject) => {
        try {
          stop();
          void context.resume();

          const wav = engine.generate(trimmed, wpmFor(options?.rate));
          if (!wav) {
            reject(new Error('robotic voice: nothing generated'));
            return;
          }

          const onDecoded = (buffer: AudioBuffer) => {
            if (!buffer || buffer.length === 0) {
              reject(new Error('robotic voice: empty audio'));
              return;
            }
            current = context.createBufferSource();
            current.buffer = buffer;
            current.connect(context.destination);
            current.onended = () => {
              current = null;
              resolve();
            };
            current.start(0);
          };

          const failed = (error: unknown) =>
            reject(error instanceof Error ? error : new Error('robotic voice: could not decode'));

          // Safari only has the callback form, so both shapes are handled rather
          // than assuming the promise.
          const maybe = context.decodeAudioData(wav, onDecoded, failed);
          if (maybe && typeof (maybe as Promise<AudioBuffer>).then === 'function') {
            (maybe as Promise<AudioBuffer>).then(onDecoded, failed);
          }
        } catch (error) {
          reject(error instanceof Error ? error : new Error('robotic voice: failed to speak'));
        }
      });
    },
  };
}

/** Whether it is worth offering the fallback at all. */
export function roboticVoicePossible(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.AudioContext === 'function' &&
    typeof WebAssembly === 'object'
  );
}

/** Exposed for tests: the speed mapping, which is otherwise buried in playback. */
export function wordsPerMinute(rate: number | undefined): number {
  return wpmFor(rate);
}
