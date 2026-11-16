import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/*
 * The cache directory is read from the environment when the module is imported,
 * so each test points it at a fresh temporary directory and re-imports. The
 * upstream is stubbed: these tests are about whether the audio is fetched again,
 * not about Google.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ilm-tts-'));
  vi.resetModules();
  vi.stubEnv('TTS_CACHE_DIR', dir);
  vi.stubEnv('TTS_CACHE_MAX_BYTES', '1000');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

function stubUpstream(status = 200, bytes = [1, 2, 3], delayMs = 0) {
  // mockImplementation, not mockResolvedValue: a Response body can only be read
  // once, and a shared instance would make the second call fail for a reason
  // that has nothing to do with the cache.
  //
  // delayMs stands in for the network. Without it the stub answers in a
  // microtask, the in-flight entry is gone before the next caller looks, and a
  // test of the dedupe would be measuring nothing.
  return vi.fn().mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(new Response(new Uint8Array(bytes), { status })), delayMs),
      ),
  );
}

describe('tts cache', () => {
  it('synthesises once, and serves the second call off disk', async () => {
    const upstream = stubUpstream();
    vi.stubGlobal('fetch', upstream);

    const { synthesise } = await import('../src/services/tts');

    const first = await synthesise('The words of the blessing of Enoch', 'en');
    const second = await synthesise('The words of the blessing of Enoch', 'en');

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(second.audio.equals(first.audio)).toBe(true);

    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.mp3$/);
  });

  it('keys on the language as well as the text, so nothing is heard in the wrong one', async () => {
    const upstream = stubUpstream();
    vi.stubGlobal('fetch', upstream);

    const { synthesise } = await import('../src/services/tts');

    await synthesise('blessing', 'en');
    await synthesise('blessing', 'ar');

    expect(upstream).toHaveBeenCalledTimes(2);
    expect(await readdir(dir)).toHaveLength(2);
  });

  it('does not cache a failed upstream call', async () => {
    const upstream = stubUpstream(502);
    vi.stubGlobal('fetch', upstream);

    const { synthesise } = await import('../src/services/tts');

    await expect(synthesise('mercy', 'en')).rejects.toThrow('502');
    // Nothing written, so a later retry is not stuck with a cached failure.
    expect(await readdir(dir)).toHaveLength(0);
  });

  it('shares one upstream call between simultaneous readers of the same verse', async () => {
    const upstream = stubUpstream(200, [1, 2, 3], 25);
    vi.stubGlobal('fetch', upstream);

    const { synthesise } = await import('../src/services/tts');

    const results = await Promise.all([
      synthesise('watchers', 'en'),
      synthesise('watchers', 'en'),
      synthesise('watchers', 'en'),
    ]);

    expect(upstream).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.audio.length === 3)).toBe(true);
  });
});
