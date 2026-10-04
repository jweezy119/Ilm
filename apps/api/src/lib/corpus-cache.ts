/**
 * A bounded cache for the corpus, which does not change while people read it.
 *
 * ## Why
 *
 * Measured, not assumed. With the cross-reference joins gone, a passage still took
 * about 2.5 seconds and a chapter about 3.5, and neither the web-to-API hop nor
 * anything in the process accounted for it: calling the API directly was the same
 * speed. What was left was the database round trip, to a Supabase pooler in
 * another continent, paid several times per request.
 *
 * The observation that makes this worth doing is that the text does not change. A
 * verse's translation, its alternative translations, its original text and its
 * scored themes are all written by ingestion and then left alone. Two readers
 * opening 2:255 are reading the same string, and the second of them did not
 * need the database to find it out.
 *
 * ## What is not cached
 *
 * Cross-references, which are computed per request and may be refreshed on demand,
 * and the reader's own library, which changes whenever they do anything. Caching
 * either would serve a stale answer, which on this app is worse than a slow one:
 * a cross-reference is a claim about what two texts say to each other, and the
 * whole product rests on not claiming something it has not checked.
 *
 * ## Invalidation
 *
 * Time-based, and short enough to notice. Ingestion replaces the corpus, and an
 * operator running one will want the change visible without a redeploy; the
 * scripts that ingest call `invalidateCorpusCache()` when they finish. A restart
 * clears it for free, since it lives in the process.
 */

interface Entry<T> {
  value: T;
  at: number;
}

export interface CorpusCacheOptions {
  ttlMs: number;
  max: number;
}

/** Least-recently-used, so the books people are actually reading stay resident. */
export class LruCache<T> {
  private readonly store = new Map<string, Entry<T>>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly options: CorpusCacheOptions) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() - hit.at > this.options.ttlMs) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    // Refresh recency: the Map preserves insertion order.
    this.store.delete(key);
    this.store.set(key, hit);
    this.hits += 1;
    return hit.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, at: Date.now() });
    while (this.store.size > this.options.max) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }

  clear(): void {
    this.store.clear();
  }

  get stats() {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : Math.round((100 * this.hits) / total),
    };
  }
}

const TEN_MINUTES = 10 * 60_000;
const ONE_HOUR = 60 * 60_000;

/**
 * Sized by what the corpus actually holds.
 *
 * A chapter of 286 verses is the largest thing cached, so the ceiling is counted
 * in bytes rather than entries: 64 MB holds a few thousand of the longest
 * chapters and costs nothing on an instance with room to spare, whereas an entry
 * cap would either waste memory on short verses or evict chapters.
 */
export const corpusCache = new LruCache<unknown>({
  ttlMs: Number(process.env.CORPUS_CACHE_TTL_MS ?? TEN_MINUTES),
  max: 1500,
});

/** Books and translation lists change only with a re-ingest, so they last longer. */
export const catalogueCache = new LruCache<unknown>({
  ttlMs: Number(process.env.CATALOGUE_CACHE_TTL_MS ?? ONE_HOUR),
  max: 200,
});

/**
 * Read through the cache, and describe the cost in one place.
 *
 * A miss is a normal miss: the database is still the source of truth and a cache
 * that changes that would be a different and much worse thing.
 */
export async function cached<T>(key: string, load: () => Promise<T>, store = corpusCache): Promise<T> {
  const hit = store.get(key);
  if (hit !== undefined) return hit as T;
  const value = await load();
  store.set(key, value);
  return value;
}

/**
 * Drop everything. Called when ingestion finishes, so a re-index is visible at
 * once rather than whenever the oldest entries happen to expire.
 */
export function invalidateCorpusCache(): void {
  corpusCache.clear();
  catalogueCache.clear();
}
