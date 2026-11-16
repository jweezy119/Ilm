/**
 * Spoken audio, synthesised at most once per distinct text.
 *
 * Google's Translate TTS endpoint is free and needs no account, which is why it
 * is the default voice — but it is an unofficial endpoint with no published
 * quota, and it rate-limits and occasionally refuses. Every listener playing
 * the same verse was a separate upstream request, so a chapter read aloud by a
 * few people could spend a hundred requests on ten distinct verses.
 *
 * The cache makes "once" literal: the audio is keyed on the language and the
 * exact text, written to disk on first use, and read from there after. It is
 * shared by every reader rather than living in one browser, so a verse is
 * synthesised once for the whole deployment.
 *
 * Failure is not fatal. A cache that cannot be written makes the app slower;
 * it must never make it unable to speak.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Where the audio lives. `<cwd>/data/tts-cache` by default, which inside the
 * image is /app/data — the directory already created writable for exactly this
 * kind of generated cache.
 */
const CACHE_DIR = (process.env.TTS_CACHE_DIR ?? path.join(process.cwd(), 'data', 'tts-cache')).trim();

/**
 * Stop writing once the directory has grown past this. Zero disables the budget.
 * Oldest-first pruning keeps the cache bounded on a small disk.
 */
const MAX_BYTES = Number(process.env.TTS_CACHE_MAX_BYTES ?? 4_000_000_000);

/** How much has been written since the last prune, so pruning is not an every-write scan. */
const PRUNE_TRIGGER = 256 * 1024 * 1024;

const UPSTREAM = 'https://translate.google.com/translate_tts';

let writtenSincePrune = 0;

/** In-flight synthesises, so ten simultaneous requests for one verse cost one upstream call. */
const inFlight = new Map<string, Promise<Buffer>>();

function keyFor(text: string, lang: string): string {
  return createHash('sha256').update(`${lang}\n${text}`).digest('hex');
}

export interface TtsResult {
  audio: Buffer;
  /** Off disk rather than freshly synthesised. Reported so the saving is visible. */
  cached: boolean;
}

/** The cache directory, for a health check or a cleanup script. */
export function ttsCacheDir(): string {
  return CACHE_DIR;
}

/** Rough size of the cache, for reporting. */
export async function ttsCacheSize(): Promise<number> {
  const entries = await fs.readdir(CACHE_DIR, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.mp3')) continue;
    const stat = await fs.stat(path.join(CACHE_DIR, entry.name)).catch(() => null);
    if (stat) total += stat.size;
  }
  return total;
}

export async function synthesise(text: string, lang: string): Promise<TtsResult> {
  const file = path.join(CACHE_DIR, `${keyFor(text, lang)}.mp3`);

  try {
    const cached = await fs.readFile(file);
    if (cached.length > 0) return { audio: cached, cached: true };
  } catch {
    // Not cached. The normal first-listen path.
  }

  const audio = await fetchOnce(text, lang);
  await writeThrough(file, audio);
  return { audio, cached: false };
}

function fetchOnce(text: string, lang: string): Promise<Buffer> {
  const key = keyFor(text, lang);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const created = fetchUpstream(text, lang)
    .then((audio) => {
      if (audio.length === 0) throw new Error('upstream returned no audio');
      return audio;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, created);
  return created;
}

async function fetchUpstream(text: string, lang: string): Promise<Buffer> {
  const url =
    `${UPSTREAM}?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob` +
    `&q=${encodeURIComponent(text)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://translate.google.com/',
    },
  });

  if (!response.ok) throw new Error(`upstream returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Write to a temporary name and rename, so a reader never sees a half-written
 * file — the rename is atomic on the same filesystem.
 */
async function writeThrough(file: string, audio: Buffer): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, audio);
    await fs.rename(temporary, file);
    writtenSincePrune += audio.length;
    await pruneIfNeeded();
  } catch (error) {
    // Deliberately not fatal: the caller still has the audio in hand.
    console.warn('[tts] could not write the cache:', error);
  }
}

/**
 * Delete the oldest files until the directory is back under budget.
 *
 * Modification time, not last access — `atime` is unreliable and often disabled
 * on the filesystems this runs on. Written-order is a good enough proxy: a file
 * written long ago and never asked for again is the one to drop.
 */
async function pruneIfNeeded(): Promise<void> {
  if (MAX_BYTES <= 0 || writtenSincePrune < PRUNE_TRIGGER) return;
  writtenSincePrune = 0;

  try {
    const entries = await fs.readdir(CACHE_DIR, { withFileTypes: true });
    const aged: Array<{ file: string; mtime: number; size: number }> = [];
    let total = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.mp3')) continue;
      const file = path.join(CACHE_DIR, entry.name);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat || stat.size === 0) continue;
      total += stat.size;
      aged.push({ file, mtime: stat.mtimeMs, size: stat.size });
    }

    if (total <= MAX_BYTES) return;

    aged.sort((a, b) => a.mtime - b.mtime);
    for (const entry of aged) {
      if (total <= MAX_BYTES) break;
      await fs.rm(entry.file, { force: true }).catch(() => false);
      total -= entry.size;
    }
  } catch (error) {
    console.warn('[tts] could not prune the cache:', error);
  }
}
