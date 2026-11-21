/**
 * Which retrieval engine this process uses.
 *
 * Three implementations, one interface:
 *
 *   postgres  Full-text search in the database. Default. Holds no index in the
 *             API's memory, so it covers the whole corpus on a 512 MB instance
 *             and does not rebuild on boot.
 *   compact   Ultra-light compressed in-process hybrid engine (~15-30 MB RAM):
 *             delta+varint BM25+ across English & original scripts + optional
 *             2-stage Binary/Int8 quantized semantic vectors with RRF fusion.
 *             Automatically selected when `ILM_STORAGE=pack`.
 *   orama     The legacy in-process index. Kept reachable for rollback.
 *
 *   SEARCH_ENGINE=compact    compressed in-process hybrid index
 *   SEARCH_ENGINE=orama      use the legacy in-process index
 *   SEARCH_ENGINE=postgres   full corpus in Postgres (default)
 */

import * as orama from './orama';
import * as postgres from './postgres';
import * as compact from './compact';
import { isPackStorageEnabled } from '../lib/pack-store';

const EXPLICIT_ENGINE = process.env.SEARCH_ENGINE?.trim().toLowerCase();
const ENGINE = (process.env.SEARCH_ENGINE ?? 'postgres').toLowerCase();

/** Which engine is live, for /health. */
export const engineName: 'postgres' | 'orama' | 'compact' =
  ENGINE === 'orama'
    ? 'orama'
    : ENGINE === 'compact' || (!EXPLICIT_ENGINE && isPackStorageEnabled())
      ? 'compact'
      : 'postgres';

const active = engineName === 'orama' ? orama : engineName === 'compact' ? compact : postgres;

export const {
  searchIndex,
  getIndexedPassage,
  getIndexedThemes,
  initializeOramaIndex,
  isIndexReady,
} = active;

export { compactIndexStats } from './compact';

/** Type re-exports, so callers import from here and never touch an engine directly. */
export type { PassageDoc, IndexFilters, IndexSearchOptions, IndexSearchResult, IndexHit } from './postgres';

/**
 * Texts this process has in its index, or null when it has all of them.
 *
 * The Orama engine answers this by configuration, because it can only hold a
 * subset on a small instance. Postgres and Compact cover the whole corpus.
 */
export async function indexedTextIds(): Promise<string[] | null> {
  if (engineName === 'orama') return orama.indexedTextIds();
  if (engineName === 'compact') return compact.indexedTextIds();
  return null;
}

export async function invalidateOramaIndex(): Promise<void> {
  if (engineName === 'orama') return orama.invalidateOramaIndex();
  if (engineName === 'compact') return compact.invalidateOramaIndex();
}
