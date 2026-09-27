'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, Loader2, AlertTriangle } from 'lucide-react';
import { THEME_TAXONOMY, type TextId } from '@ilm/shared';
import { api, ApiError } from '@/lib/api';
import { Shell, Empty, PageHeader } from '@/components/Shell';
import { PassageCard } from '@/components/PassageCard';
import { useComparisonStore, useSearchStore, MAX_COMPARISON } from '@/store';
import { cn, getTextLabel, TEXT_IDS } from '@/lib/utils';

const SUGGESTED = ['mercy', 'covenant', 'forgiveness', 'light', 'creation', 'justice', 'prayer', 'wisdom'];

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [semantic, setSemantic] = useState(true);

  const { query, response, activeTexts, recent, setQuery, setResponse, toggleText, remember, clear } = useSearchStore();
  const { passageKeys, toggle, has } = useComparisonStore();

  const runSearch = useCallback(
    async (term: string, texts: TextId[], useSemantic = semantic) => {
      const trimmed = term.trim();
      if (!trimmed) return;

      setLoading(true);
      setError(null);

      try {
        const result = await api.search({
          query: trimmed,
          limit: 40,
          semantic: useSemantic,
          filters: texts.length < TEXT_IDS.length ? { texts } : undefined,
        });
        // The store's query drives the result header and both empty states, so it
        // has to follow the search that just ran.
        setQuery(trimmed);
        setResponse(result);
        remember(trimmed);
        router.replace(`/?q=${encodeURIComponent(trimmed)}${useSemantic ? '' : '&literal=1'}`, { scroll: false });
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Search failed.');
        setResponse(null);
      } finally {
        setLoading(false);
      }
    },
    [setQuery, setResponse, remember, router, semantic]
  );

  // Deep links like /?q=mercy should restore a search.
  useEffect(() => {
    const q = params.get('q');
    if (q && q !== query) {
      setInput(q);
      void runSearch(q, activeTexts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void runSearch(input, activeTexts);
  };

  const results = response?.results ?? [];
  const trayFull = passageKeys.length >= MAX_COMPARISON;

  return (
    <Shell>
      <PageHeader
        title="Search the texts"
        description="Full-text search across the Quran, Torah, Talmud, Old and New Testaments. Every result carries its corpus, reference, original text, and scored themes."
      />

      <form onSubmit={submit} className="mb-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="mercy, covenant, light, the sabbath…"
            aria-label="Search sacred texts"
            className="w-full rounded-lg border border-ink-300 bg-white py-2.5 pl-9 pr-24 text-sm outline-none transition-colors focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20 dark:border-ink-700 dark:bg-ink-900"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {input ? (
              <button
                type="button"
                onClick={() => {
                  setInput('');
                  clear();
                  router.replace('/');
                }}
                className="grid h-7 w-7 place-items-center rounded text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex items-center gap-1.5 rounded-md bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-900 disabled:opacity-50 dark:bg-emerald-700"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Search
            </button>
          </div>
        </div>
      </form>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-ink-600 dark:text-ink-400">
          <input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} />
          Rank by meaning
          <span className="text-ink-400">(Jev re-ranks the shortlist; one extra request)</span>
        </label>
        {response && response.rerankSource === 'jev' ? (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">semantic ranking active</span>
        ) : (
          <span className="text-xs text-ink-500">literal ranking — set TYPESAFE_API_KEY for semantic</span>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-ink-500">Texts</span>
        {TEXT_IDS.map((textId) => {
          const on = activeTexts.includes(textId);
          return (
            <button
              key={textId}
              type="button"
              onClick={() => {
                toggleText(textId);
                if (query) void runSearch(query, activeTexts.includes(textId) ? activeTexts.filter((t) => t !== textId) : [...activeTexts, textId]);
              }}
              aria-pressed={on}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                on
                  ? 'border-ink-900 bg-ink-900 text-white dark:border-ink-100 dark:bg-ink-100 dark:text-ink-950'
                  : 'border-ink-300 text-ink-600 hover:border-ink-500 dark:border-ink-700 dark:text-ink-300'
              )}
            >
              {getTextLabel(textId, true)}
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {trayFull ? (
        <p className="mb-4 text-xs text-ink-500">
          Comparison holds {MAX_COMPARISON} passages. Remove one before adding another.
        </p>
      ) : null}

      {results.length > 0 && response?.verdict !== 'unaddressed' ? (
        <>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm">
              <span className="font-semibold">{response?.total.toLocaleString()}</span> result
              {response?.total === 1 ? '' : 's'} for <span className="font-semibold">“{query}”</span>
              <span className="ml-2 text-xs text-ink-500">
                {response?.tookMs}ms · intent {response?.intent} ({response?.intentSource})
                {response?.expandedTheme ? ` · widened with the vocabulary of “${response.expandedTheme}”` : ''}
              </span>
            </p>
            {passageKeys.length > 0 ? (
              <button type="button" onClick={() => router.push('/compare')} className="text-xs text-emerald-800 underline dark:text-emerald-400">
                Compare {passageKeys.length} selected
              </button>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((result) => (
              <PassageCard
                key={result.passage.id}
                passage={result.passage}
                score={result.score}
                semanticScore={result.semanticScore}
                textScore={result.textScore}
                query={query}
                inComparison={has(result.passage.passageKey)}
                onToggleCompare={toggle}
              />
            ))}
          </div>
        </>
      ) : query && !loading && response?.verdict === 'unaddressed' ? (
        <Empty icon={Search} title={`These texts do not address “${query}”`}>
          Jev judged the shortlist and found nothing that speaks to it. That is a real answer rather than a failed
          search — the passages below are simply the closest literal matches. A different wording, or the{' '}
          <span className="underline">Explore</span> page, may reach what you are after.
        </Empty>
      ) : query && !loading && response?.verdict === 'partial' ? (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          These texts touch on <span className="font-semibold">“{query}”</span> rather than addressing it directly. Treat
          the results as leads.
        </p>
      ) : query && !loading ? (
        <Empty icon={Search} title={`Nothing matched “${query}”`}>
          Try a single common noun, or clear the text filters. Terms are matched literally unless semantic ranking is on
          and a TypeSafe key is configured.
        </Empty>
      ) : (
        <div className="space-y-8">
          <div>
            <h2 className="mb-2 text-sm font-medium text-ink-600 dark:text-ink-400">Try a theme</h2>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => {
                    setInput(term);
                    void runSearch(term, activeTexts);
                  }}
                  className="rounded-full border border-ink-300 px-3 py-1 text-sm hover:border-emerald-700 hover:text-emerald-800 dark:border-ink-700 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>

          {recent.length > 0 ? (
            <div>
              <h2 className="mb-2 text-sm font-medium text-ink-600 dark:text-ink-400">Recent searches</h2>
              <div className="flex flex-wrap gap-2">
                {recent.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => {
                      setInput(term);
                      void runSearch(term, activeTexts);
                    }}
                    className="rounded-full bg-ink-100 px-3 py-1 text-sm text-ink-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <h2 className="mb-2 text-sm font-medium text-ink-600 dark:text-ink-400">Browse by theme</h2>
            <p className="mb-3 text-xs text-ink-500">
              {THEME_TAXONOMY.length} themes are scored onto every passage during indexing.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {THEME_TAXONOMY.slice(0, 40).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  onClick={() => router.push(`/explore?theme=${theme}`)}
                  className="rounded bg-ink-100 px-2 py-0.5 text-xs text-ink-700 hover:bg-emerald-100 hover:text-emerald-900 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-emerald-900 dark:hover:text-emerald-200"
                >
                  {theme.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<Shell><p className="py-12 text-sm text-ink-500">Loading search…</p></Shell>}>
      <SearchInner />
    </Suspense>
  );
}
