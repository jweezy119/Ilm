/**
 * The corpus cache, which exists because a verse's text does not change while
 * people read it.
 *
 * The behaviour worth pinning is the eviction and expiry, because a cache that
 * serves a stale passage is worse on this app than a slow one: a passage is a
 * claim about what a text says, and this product's whole position is that it does
 * not misstate that. So a miss must be ordinary and correct, an expiry must
 * return to the database rather than to an old value, and the invalidation hook
 * has to exist for ingestion to call.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LruCache, cached, invalidateCorpusCache, corpusCache, catalogueCache } from './corpus-cache';

afterEach(() => {
  vi.useRealTimers();
  corpusCache.clear();
  catalogueCache.clear();
});

describe('LruCache', () => {
  it('returns a stored value', () => {
    const c = new LruCache<string>({ ttlMs: 1000, max: 10 });
    c.set('a', 'one');
    expect(c.get('a')).toBe('one');
  });

  it('misses for anything it has not stored', () => {
    const c = new LruCache<string>({ ttlMs: 1000, max: 10 });
    expect(c.get('nope')).toBeUndefined();
  });

  it('treats an expired entry as a miss rather than serving it', () => {
    vi.useFakeTimers();
    const c = new LruCache<string>({ ttlMs: 1000, max: 10 });
    c.set('a', 'one');
    vi.advanceTimersByTime(1001);
    // The point of the whole cache: a passage that was re-ingested must not be
    // served from memory after its window closed.
    expect(c.get('a')).toBeUndefined();
  });

  it('evicts the least recently used entry, not the oldest inserted', () => {
    const c = new LruCache<string>({ ttlMs: 10_000, max: 2 });
    c.set('a', '1');
    c.set('b', '2');
    c.get('a'); // a is now the most recently used, so b is the coldest
    c.set('c', '3');
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe('1');
    expect(c.get('c')).toBe('3');
  });

  it('never exceeds its ceiling', () => {
    const c = new LruCache<number>({ ttlMs: 10_000, max: 3 });
    for (let i = 0; i < 50; i += 1) c.set(`k${i}`, i);
    expect(c.stats.size).toBeLessThanOrEqual(3);
  });

  it('counts hits and misses, so an operator can see whether it is working', () => {
    const c = new LruCache<string>({ ttlMs: 10_000, max: 10 });
    c.set('a', 'one');
    c.get('a');
    c.get('b');
    expect(c.stats.hits).toBe(1);
    expect(c.stats.misses).toBe(1);
    expect(c.stats.hitRate).toBe(50);
  });
});

describe('cached()', () => {
  it('loads once and serves the rest from memory', async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return { text: 'a verse' };
    };
    const first = await cached('p:1', load);
    const second = await cached('p:1', load);
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it('keeps different keys apart', async () => {
    let calls = 0;
    const load = async (n: number) => {
      calls += 1;
      return n;
    };
    expect(await cached('p:1', () => load(1))).toBe(1);
    expect(await cached('p:2', () => load(2))).toBe(2);
    expect(calls).toBe(2);
  });

  it('goes back to the loader after the window closes', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const load = async () => {
      calls += 1;
      return calls;
    };
    await cached('p:1', load);
    vi.advanceTimersByTime(11 * 60_000);
    await cached('p:1', load);
    expect(calls).toBe(2);
  });

  it('uses a store passed in, so short-lived and long-lived things are separable', async () => {
    // The corpus and the catalogues have different lifetimes: a chapter of text is
    // worth holding for minutes, the list of which books exist for an hour.
    const other = new LruCache<number>({ ttlMs: 10_000, max: 2 });
    expect(await cached('k', async () => 7, other)).toBe(7);
    expect(other.get('k')).toBe(7);
    expect(corpusCache.get('k')).toBeUndefined();
  });
});

describe('invalidateCorpusCache', () => {
  it('empties both stores', () => {
    // Called when ingestion finishes, so a re-index is visible at once rather
    // than whenever entries happen to age out.
    corpusCache.set('p:1', 'a');
    catalogueCache.set('b:1', 'b');
    invalidateCorpusCache();
    expect(corpusCache.get('p:1')).toBeUndefined();
    expect(catalogueCache.get('b:1')).toBeUndefined();
  });
});
