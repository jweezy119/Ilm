'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bookmark, Check, Loader2, Plus, Search, X } from 'lucide-react';
import { parseCitation, type LibraryEntry, type SearchResult, type TextId } from '@ilm/shared';
import { api, ApiError } from '@/lib/api';
import { TEXT_IDS, cn, getTextLabel, truncate } from '@/lib/utils';
import { passageReference } from '@/lib/passage-ref';

/**
 * In-journey passage finder: search the corpus, jump to a citation (e.g.
 * "Quran 2:255" or "John 3:16"), or pull from your Saved Library without
 * ever leaving the journey you are building.
 */
export function JourneyPassageFinder({
  existingKeys,
  onAddKey,
  onAddBatch,
  onClose,
}: {
  existingKeys: Set<string>;
  onAddKey: (passageKey: string) => Promise<void>;
  onAddBatch: (passageKeys: string[]) => Promise<void>;
  onClose?: () => void;
}) {
  const t = useTranslations('journeys');
  const [tab, setTab] = useState<'search' | 'library'>('search');
  const [query, setQuery] = useState('');
  const [textFilter, setTextFilter] = useState<TextId | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[] | null>(null);
  const [loadingLib, setLoadingLib] = useState(false);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addingAll, setAddingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const citationPreview = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) return null;
    const matches = parseCitation(trimmed);
    return matches[0] ?? null;
  }, [query]);

  const runSearch = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;
      setSearching(true);
      setError(null);
      setSearched(true);
      try {
        // If it parses as one or more direct citations, resolve them immediately!
        const parsedMatches = parseCitation(trimmed).slice(0, 3);
        const directMatches: SearchResult[] = [];
        for (const match of parsedMatches) {
          try {
            const p = await api.passageByKey(match.passageKey);
            if (p) {
              directMatches.push({
                passage: p,
                score: 1,
                matchedFields: ['translation'],
                highlights: {},
              });
            }
          } catch {
            // Fall through to full search
          }
        }

        const res = await api.search({
          query: trimmed,
          filters: textFilter ? { texts: [textFilter] } : undefined,
          limit: 12,
          semantic: true,
          expand: true,
        });
        const merged = [
          ...directMatches,
          ...res.results.filter((r) => !directMatches.some((d) => d.passage.passageKey === r.passage.passageKey)),
        ];
        setResults(merged);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('searchFailed'));
      } finally {
        setSearching(false);
      }
    },
    [query, textFilter, t]
  );

  useEffect(() => {
    if (tab !== 'library' || libraryEntries !== null || loadingLib) return;
    setLoadingLib(true);
    api
      .library()
      .then((d) => setLibraryEntries(d.entries))
      .catch(() => setLibraryEntries([]))
      .finally(() => setLoadingLib(false));
  }, [tab, libraryEntries, loadingLib]);

  const handleAdd = async (key: string) => {
    setAddingKey(key);
    setError(null);
    try {
      await onAddKey(key);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('addFailed'));
    } finally {
      setAddingKey(null);
    }
  };

  const unaddedLibraryKeys = useMemo(
    () =>
      (libraryEntries ?? [])
        .filter((e) => e.passage && !existingKeys.has(e.passageKey))
        .map((e) => e.passageKey),
    [libraryEntries, existingKeys]
  );

  const handleAddAllSaved = async () => {
    if (unaddedLibraryKeys.length === 0) return;
    setAddingAll(true);
    setError(null);
    try {
      await onAddBatch(unaddedLibraryKeys);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('addFailed'));
    } finally {
      setAddingAll(false);
    }
  };

  return (
    <section
      aria-label={t('finderHeading')}
      className="mb-6 rounded-2xl border border-line bg-panel/50 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTab('search')}
            aria-pressed={tab === 'search'}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
              tab === 'search' ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-panel hover:text-fg'
            )}
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            {t('finderSearchTab')}
          </button>
          <button
            type="button"
            onClick={() => setTab('library')}
            aria-pressed={tab === 'library'}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
              tab === 'library' ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-panel hover:text-fg'
            )}
          >
            <Bookmark className="h-3.5 w-3.5" aria-hidden />
            {t('finderLibraryTab')}
          </button>
        </div>

        {onClose ? (
          <button type="button" onClick={onClose} aria-label={t('close')} className="icon-btn">
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {tab === 'search' ? (
        <div className="mt-3">
          <form onSubmit={runSearch} className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('finderPlaceholder')}
              aria-label={t('finderPlaceholder')}
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={!query.trim() || searching}
              className="btn btn-primary shrink-0 px-3.5 py-2 text-xs"
            >
              {searching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
              {t('finderSearchBtn')}
            </button>
          </form>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTextFilter(null)}
              aria-pressed={textFilter === null}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                textFilter === null ? 'bg-accent-soft text-accent' : 'bg-surface text-fg-muted hover:text-fg'
              )}
            >
              {t('filterAll')}
            </button>
            {TEXT_IDS.map((tid) => (
              <button
                key={tid}
                type="button"
                onClick={() => setTextFilter(textFilter === tid ? null : tid)}
                aria-pressed={textFilter === tid}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                  textFilter === tid ? 'bg-accent-soft text-accent' : 'bg-surface text-fg-muted hover:text-fg'
                )}
              >
                {getTextLabel(tid, true)}
              </button>
            ))}
          </div>

          {citationPreview ? (
            <p className="mt-2 text-xs text-accent">
              {t('citationDetected', {
                reference: `${getTextLabel(citationPreview.textId as TextId)} ${citationPreview.bookLabel} ${citationPreview.chapter}:${citationPreview.verse}`,
              })}
            </p>
          ) : null}

          {error ? <p className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p> : null}

          {searched && !searching && results.length === 0 ? (
            <p className="mt-3 text-xs text-fg-muted">{t('finderNoResults')}</p>
          ) : null}

          {results.length > 0 ? (
            <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pe-1">
              {results.map((r) => {
                const key = r.passage.passageKey;
                const added = existingKeys.has(key);
                return (
                  <li
                    key={key}
                    className="flex items-start gap-2.5 rounded-xl border border-line bg-surface p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">
                        <span className="text-accent">{getTextLabel(r.passage.textId, true)}</span>
                        <span className="ms-1.5">{passageReference(key)}</span>
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">
                        {truncate(r.passage.translation, 170)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={added || addingKey !== null}
                      onClick={() => void handleAdd(key)}
                      className={cn(
                        'shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                        added
                          ? 'bg-accent-soft text-accent'
                          : 'border border-line bg-panel text-fg hover:border-accent hover:text-accent'
                      )}
                    >
                      {addingKey === key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : added ? (
                        <span className="inline-flex items-center gap-1">
                          <Check className="h-3.5 w-3.5" aria-hidden /> {t('addedBadge')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Plus className="h-3.5 w-3.5" aria-hidden /> {t('add')}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="mt-3">
          {loadingLib ? (
            <p className="flex items-center gap-2 text-xs text-fg-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {t('loading')}
            </p>
          ) : !libraryEntries || libraryEntries.length === 0 ? (
            <p className="text-xs text-fg-muted">{t('finderLibraryEmpty')}</p>
          ) : (
            <>
              {unaddedLibraryKeys.length > 0 ? (
                <div className="mb-2.5 flex justify-end">
                  <button
                    type="button"
                    disabled={addingAll}
                    onClick={() => void handleAddAllSaved()}
                    className="btn btn-primary px-3 py-1.5 text-xs"
                  >
                    {addingAll ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {t('addAllSaved', { count: unaddedLibraryKeys.length })}
                  </button>
                </div>
              ) : null}
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pe-1">
                {libraryEntries
                  .filter((e) => e.passage)
                  .map((e) => {
                    const p = e.passage!;
                    const added = existingKeys.has(e.passageKey);
                    return (
                      <li
                        key={e.passageKey}
                        className="flex items-start gap-2.5 rounded-xl border border-line bg-surface p-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium">
                            <span className="text-accent">{getTextLabel(p.textId, true)}</span>
                            <span className="ms-1.5">{passageReference(e.passageKey)}</span>
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">
                            {truncate(p.translation, 170)}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={added || addingKey !== null}
                          onClick={() => void handleAdd(e.passageKey)}
                          className={cn(
                            'shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                            added
                              ? 'bg-accent-soft text-accent'
                              : 'border border-line bg-panel text-fg hover:border-accent hover:text-accent'
                          )}
                        >
                          {addingKey === e.passageKey ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : added ? (
                            <span className="inline-flex items-center gap-1">
                              <Check className="h-3.5 w-3.5" aria-hidden /> {t('addedBadge')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Plus className="h-3.5 w-3.5" aria-hidden /> {t('add')}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
