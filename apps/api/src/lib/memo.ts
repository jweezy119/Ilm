/**
 * A small bounded memo for values that are pure functions of their input.
 *
 * Used for the Jev calls that depend on nothing but the text typed into the search
 * box — intent classification and theme expansion. The home page offers a fixed set
 * of theme chips and suggested terms, so the same handful of queries repeat
 * constantly, and each repeat was costing a request to arrive at the same answer.
 *
 * Deliberately in-process and unbounded in time but bounded in size: a restart
 * costs one request per distinct query, which is the right trade for not adding a
 * table and a migration to cache a classification.
 *
 * Not for anything that depends on the passage shortlist, the reader's weights, or
 * anything else that can change between two identical queries — that belongs in
 * Postgres, where it survives a restart.
 */
export function createBoundedMemo<T>(maxEntries: number): (key: string, compute: () => T) => T {
  const store = new Map<string, T>();

  return (key, compute) => {
    const hit = store.get(key);
    if (hit !== undefined) {
      // Refresh recency so the eviction below drops the coldest keys, not the
      // first ones inserted.
      store.delete(key);
      store.set(key, hit);
      return hit;
    }

    const value = compute();

    /*
     * When T is a promise, a rejection must not be cached.
     *
     * Intent classification and theme expansion both memoize a Promise, and both
     * can fail transiently - a malformed judge response, a timeout surfacing as
     * a throw. A rejected promise that stayed in the map would be handed to every
     * later identical query for as long as it survived eviction, so one bad
     * moment would turn one search term into a permanently broken one. The value
     * is still returned to the caller that asked for it; only the cache forgets it,
     * so the next identical query recomputes.
     */
    if (isThenable(value)) {
      (value as PromiseLike<unknown>).then(undefined, () => {
        if (store.get(key) === value) store.delete(key);
      });
    }

    store.set(key, value);

    // Map preserves insertion order, so the first key is the coldest.
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }

    return value;
  };
}

function isThenable(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
