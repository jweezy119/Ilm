/**
 * Waiting for the voice list.
 *
 * The bug this exists for: `getVoices()` returns an empty array until the
 * browser has loaded the system's voices and says so with `voiceschanged`.
 * Reading it once at press time told a reader with perfectly good voices that
 * they had none, because they pressed within the second the page opened — which
 * is the whole feature refusing to work for someone who could have heard it.
 *
 * A fake synthesis object rather than a browser: the house runs vitest in a node
 * environment with no DOM, and this logic is about a list arriving over time,
 * which needs no rendering to prove.
 */

import { describe, it, expect } from 'vitest';
import { voicesWhenReady } from '@/components/ReadAloud';

/**
 * `emits` decides how the list becomes populated: an engine that announces it
 * does so on `load()`, one that does not simply has it by the next read — which
 * is why the timer has to read again rather than only listening.
 */
function fakeSynth(script: unknown[][], emits: boolean): SpeechSynthesis & { load: () => void; fired: boolean } {
  let i = 0;
  let reads = 0;
  const listeners = new Set<() => void>();
  const synth = {
    fired: false,
    getVoices: () => {
      reads += 1;
      if (!emits && reads > 1) i = Math.min(i + 1, script.length - 1);
      return script.length === 0 ? [] : script[Math.min(i, script.length - 1)];
    },
    addEventListener: (e: string, fn: () => void) => {
      if (e === 'voiceschanged') listeners.add(fn);
    },
    removeEventListener: (e: string, fn: () => void) => {
      if (e === 'voiceschanged') listeners.delete(fn);
    },
    dispatchEvent: () => true,
    cancel: () => {},
    speak: () => {},
    pause: () => {},
    resume: () => {},
    get speaking() { return false; },
    get pending() { return false; },
    get paused() { return false; },
    load() {
      i += 1;
      if (emits) {
        synth.fired = true;
        for (const fn of listeners) fn();
      }
    },
  };
  return synth as unknown as SpeechSynthesis & { load: () => void; fired: boolean };
}

const EN = [{ name: 'Real English', lang: 'en-GB', localService: true, default: true }];

describe('voicesWhenReady', () => {
  it('returns immediately when voices are already there', async () => {
    const synth = fakeSynth([EN], true);
    const started = Date.now();
    expect(await voicesWhenReady(synth, 1000)).toEqual(EN);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('waits for voices that arrive after the press', async () => {
    const synth = fakeSynth([[], EN], true);
    const pending = voicesWhenReady(synth, 1000);
    setTimeout(() => synth.load(), 30);
    expect(await pending).toEqual(EN);
    expect(synth.fired).toBe(true);
  });

  it('gives up on an engine that never announces itself', async () => {
    // Some engines populate silently, so the list is read again on the timer as
    // well as on the event — but only the event can end it early.
    const synth = fakeSynth([[], EN], false);
    expect(await voicesWhenReady(synth, 60)).toEqual(EN);
  });

  it('reports genuinely empty rather than waiting out the whole timeout', async () => {
    const synth = fakeSynth([[]], true);
    expect(await voicesWhenReady(synth, 60)).toEqual([]);
  });

  it('removes its listener, so repeated presses do not accumulate them', async () => {
    const synth = fakeSynth([[], EN], true);
    const first = voicesWhenReady(synth, 200);
    synth.load();
    await first;
    // A second press after the first resolved must not be resolved by a stale
    // listener from the first.
    const second = voicesWhenReady(synth, 200);
    expect(await second).toEqual(EN);
  });

  it('survives an engine with no events at all', async () => {
    const bare = {
      getVoices: () => EN,
      addEventListener: () => { throw new Error('no events here'); },
      removeEventListener: () => {},
    } as unknown as SpeechSynthesis;
    expect(await voicesWhenReady(bare, 100)).toEqual(EN);
  });
});
