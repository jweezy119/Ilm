import { api, type Health } from './api';

/**
 * Index coverage, fetched once and shared.
 *
 * Two places need it — the search filters and the settings page — and both need
 * the answer before they can render honestly. Fetching it separately would mean
 * two round trips and two chances to disagree, and caching it per call site would
 * mean the settings page could show a different answer from the filters.
 *
 * The promise is cached rather than the result, so concurrent callers share one
 * request. It is deliberately not revalidated: coverage only changes when
 * something is ingested or the process restarts, and a stale answer here is
 * better than a spinner in the filter row.
 */
let pending: Promise<Health | null> | null = null;

export function fetchCoverage(): Promise<Health | null> {
  pending ??= api.health().catch(() => null);
  return pending;
}

/** Test seam: forget the cached answer. */
export function resetCoverage(): void {
  pending = null;
}
