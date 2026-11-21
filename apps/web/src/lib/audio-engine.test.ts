import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSpeechEngine, toSpeechPieces } from './speech-engine';

describe('audio engine reliability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('splits speech pieces to <= 180 characters so Cloud TTS never hits Google 200-char 400 errors', () => {
    const longText =
      'And they shall bless and glorify the Lord of Spirits, and say: ‘Blessed is the Lord of Spirits and the Lord of kings, And the Lord of the mighty and the Lord of the rich, And the Lord of glory and the Lord of wisdom,';
    const pieces = toSpeechPieces(undefined, longText);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(p.text.length).toBeLessThanOrEqual(180);
    }
  });

  it('invokes fallback at most once when both audio.onerror and audio.play() fail, and stop() silences fallback', async () => {
    const spokenUtterances: Array<{ onend?: () => void; onerror?: (e: { error: string }) => void }> = [];
    const cancelSpy = vi.fn();
    const speakSpy = vi.fn((u: { onend?: () => void; onerror?: (e: { error: string }) => void }) => {
      spokenUtterances.push(u);
    });

    class FakeAudio {
      src: string;
      playbackRate = 1;
      defaultPlaybackRate = 1;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.src = url;
      }
      pause() {}
      removeAttribute() {}
      play() {
        // Trigger BOTH onerror and a rejected play() promise, just like browsers on 502/network fail.
        queueMicrotask(() => this.onerror?.());
        return Promise.reject(new Error('network error'));
      }
    }

    class FakeUtterance {
      text: string;
      lang = 'en';
      rate = 1;
      voice: unknown;
      onend?: () => void;
      onerror?: (e: { error: string }) => void;
      constructor(text: string) {
        this.text = text;
      }
    }

    vi.stubGlobal('window', { Audio: FakeAudio });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [{ name: 'Test EN', lang: 'en-US', localService: true, default: true }],
      speak: speakSpy,
      cancel: cancelSpy,
      addEventListener: () => {},
      removeEventListener: () => {},
    });

    const engine = await createSpeechEngine('en');
    const onError = vi.fn();
    const queuePromise = engine.speakQueue([{ text: 'In the beginning' }], { onError });

    // Let fallback initialize and call synth.speak
    await new Promise((r) => setTimeout(r, 20));
    expect(speakSpy).toHaveBeenCalledTimes(1);

    // Stopping must cancel the active fallback engine and simulate the browser's `canceled` event without firing onError.
    engine.stop();
    spokenUtterances[0]?.onerror?.({ error: 'canceled' });
    await queuePromise;

    expect(cancelSpy).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('applies live setVolume and setRate directly to the playing cloud Audio element', async () => {
    let created: { volume: number; playbackRate: number; onended: (() => void) | null } | null = null;

    class FakeAudio {
      src: string;
      volume = 1;
      playbackRate = 1;
      defaultPlaybackRate = 1;
      currentTime = 0;
      duration = 10;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeupdate: (() => void) | null = null;
      onloadedmetadata: (() => void) | null = null;
      constructor(url: string) {
        this.src = url;
        created = this;
      }
      pause() {}
      removeAttribute() {}
      play() {
        return Promise.resolve();
      }
    }

    vi.stubGlobal('window', { Audio: FakeAudio });

    const engine = await createSpeechEngine('en');
    const done = engine.speakQueue([{ text: 'Mercy and peace' }], { rate: 1, volume: 0.8 });

    expect(created).not.toBeNull();
    expect(created!.volume).toBeCloseTo(0.8, 5);
    expect(created!.playbackRate).toBe(1);

    engine.setVolume?.(0.35);
    engine.setRate?.(1.5);
    expect(created!.volume).toBeCloseTo(0.35, 5);
    expect(created!.playbackRate).toBe(1.5);

    created!.onended?.();
    await done;
  });
});
