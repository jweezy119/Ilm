/**
 * Which retrieval engine this process uses.
 *
 * Two implementations, one interface:
 *
 *   postgres  Full-text search in the database. Default. Holds no index in the
 *             API's memory, so it covers the whole corpus on a 512 MB instance
 *             and does not rebuild on boot.
 *   orama     The in-process index. Kept, and kept working, because the switch
 *             between them changed what "search" means: the Orama index never
 *             contained the scripture, only theme names, book slugs and
 *             translation names. Rolling back is a one-word environment change
 *             if the new ranking proves worse.
 *
 *   SEARCH_ENGINE=orama      use the in-process index
 *   SEARCH_ENGINE=postgres   full corpus (default)
 */

import * as orama from './orama';
import * as postgres from './postgres';

const ENGINE = (process.env.SEARCH_ENGINE ?? 'postgres').toLowerCase();

/** Which engine is live, for /health. */
export const engineName: 'postgres' | 'orama' = ENGINE === 'orama' ? 'orama' : 'postgres';

const active = engineName === 'orama' ? orama : postgres;

export const {
  searchIndex,
  getIndexedPassage,
  getIndexedThemes,
  initializeOramaIndex,
  isIndexReady,
} = active;

/** Type re-exports, so callers import from here and never touch an engine directly. */
export type { PassageDoc, IndexFilters, IndexSearchOptions, IndexSearchResult, IndexHit } from './postgres';

/**
 * Texts this process has in its index, or null when it has all of them.
 *
 * The Orama engine answers this by configuration, because it can only hold a
 * subset on a small instance. Postgres has no such limit, so it reports null and
 * the interface renders nothing as unsearchable.
 */
export async function indexedTextIds(): Promise<string[] | null> {
  if (engineName === 'orama') return orama.indexedTextIds();
  return null;
}

export async function invalidateOramaIndex(): Promise<void> {
  if (engineName === 'orama') return orama.invalidateOramaIndex();
}
