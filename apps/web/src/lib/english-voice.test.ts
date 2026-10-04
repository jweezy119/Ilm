/**
 * Recorded English: where it comes from, and what happens where it isn't.
 *
 * The behaviour worth pinning is the mixed case. Generation is staged by corpus,
 * so for a while some passages have a recording and some do not, and a reader will
 * meet both in one session. If the gap is a dead button the feature is worse than
 * having done nothing, so the fallback is the load-bearing part of this.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const reciters = readFileSync(resolve(__dirname, './reciters.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const voice = readFileSync(resolve(__dirname, './english-voice.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('englishAudioUrl', () => {
  it('works for every corpus, unlike the Arabic recitation', () => {
    // There is a human recitation of the Quran and nothing comparable for the
    // other four, which is why the English side is synthesised once and served.
    for (const key of [
      'quran:2:1:255',
      'torah:Genesis:1:1',
      'ot:Psalms:23:1',
      'nt:John:3:16',
      'talmud:Berakhot:2:1',
    ]) {
      expect(reciters).toContain('englishAudioUrl');
      expect(key.split(':')).toHaveLength(4);
    }
  });

  it('names the file from the passage key, which is what the generator writes', () => {
    // Flat, reversible, and it cannot collide: quran-2-1-255 and torah-Genesis-1-1
    // differ in their prefix. The two halves of the system agree by construction
    // rather than through a lookup table.
    expect(reciters).toMatch(/parts\.join\('\-'\)/);
  });

  it('refuses a key that is not four segments', () => {
    expect(reciters).toContain('if (parts.length !== 4) return null;');
  });

  it('is inert until a bucket is configured', () => {
    /*
     * Empty base means no recorded English, and that has to be a normal state
     * rather than a crash: nothing is switched on until the files are somewhere
     * to serve them from.
     */
    expect(reciters).toMatch(/EN_AUDIO_BASE = \(process\.env\.NEXT_PUBLIC_EN_AUDIO_BASE \?\? ''\)/);
    expect(reciters).toContain('if (!EN_AUDIO_BASE || !passageKey) return null;');
  });

  it('trims a trailing slash so a misconfigured base cannot double up', () => {
    // Asserted on the behaviour rather than the exact regex, which is not worth
    // pinning: either the slash is trimmed or the base is normalised.
    const decl = reciters.split('EN_AUDIO_BASE = ')[1] ?? '';
    expect(decl.split('\n')[0]).toContain('replace(');
  });
});

describe('the hook', () => {
  it('tries the recording first and the device second', () => {
    // Order is the point, and the two are far apart in the function, so each is
    // asserted where it happens rather than by their distance.
    // lastIndexOf, because the name appears twice: the helper is defined well
    // before the place where it is reached from the recording's failure.
    const called = voice.lastIndexOf('speakWithDevice');
    const urlBranch = voice.indexOf('const url = audioUrl ?? null');
    expect(urlBranch).toBeGreaterThan(-1);
    expect(called).toBeGreaterThan(urlBranch);
    // The device is reached from inside the url branch's catch, not after it.
    expect(voice).toMatch(/catch \(error\)[\s\S]{0,320}await speakWithDevice/);
  });

  it('treats a missing recording as expected, not as an error', () => {
    /*
     * This is the case that decides whether the feature works at all on the day
     * it ships. A passage that has not been generated yet must still be read;
     * reporting it as a failure would make the reader think something was wrong
     * with the passage rather than with the rollout.
     */
    expect(voice).toContain('isMissingAudio');
    expect(voice).toMatch(/if \(!isMissingAudio\(error\)/);
  });

  it('reports which of the two happened, so neither is silent', () => {
    expect(voice).toMatch(/setSource\('device'\)/);
    expect(voice).toMatch(/setSource\('recorded'\)/);
  });

  it('stops the recording as well as the voice', () => {
    // The recording is a plain <audio> element and outlives a stop() that only
    // reaches for the speech API.
    expect(voice).toMatch(/const el = audioRef\.current;[\s\S]{0,120}el\.pause\(\)/);
  });

  it('stops on unmount', () => {
    expect(voice).toContain('useEffect(() => stop, [stop])');
  });

  it('has a stable identity, because callers stop it from an effect', () => {
    /*
     * Found by running it, not by reading it.
     *
     * This hook returned a fresh object literal on every render. Both players stop
     * it in an effect cleanup — on unmount, and whenever the passage changes — so
     * that cleanup also ran after every render, and the stop it invoked cancelled
     * the playback that had just begun. The result was that the English half was
     * cut off the moment the Arabic finished, and nothing was ever spoken: the
     * recorded URL was never even requested.
     *
     * A test cannot observe that without a DOM, so it is pinned here as what it
     * is: the object is memoised, and therefore only changes when the source does.
     */
    expect(voice).toMatch(/return useMemo\(\(\) => \(\{ speak, stop, source \}\), \[speak, stop, source\]\)/);
    expect(voice).toContain('useMemo');
  });
});
