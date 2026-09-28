'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, Loader2, AlertTriangle, Sparkles, ArrowRight, Layers } from 'lucide-react';
import { THEME_TAXONOMY, type TextId } from '@ilm/shared';
import { api, ApiError } from '@/lib/api';
import { Shell, Empty } from '@/components/Shell';
import { PassageCard } from '@/components/PassageCard';
import { useComparisonStore, useSearchStore } from '@/store';
import { fetchCoverage } from '@/lib/coverage';
import { cn, getTextLabel, TEXT_IDS } from '@/lib/utils';

const SUGGESTED = [
  { term: 'mercy', hint: 'across all five corpora' },
  { term: 'covenant', hint: 'promise, obligation, breakage' },
  { term: 'light', hint: 'creation, revelation, guidance' },
  { term: 'forgiveness', hint: 'repentance and release' },
  { term: 'justice', hint: 'weighing, judgement, limits' },
  { term: 'the sabbath', hint: 'rest, obligation, exile' },
];

/**
 * How a result set was judged, stated the way a model picker states the model.
 *
 * The intent is the classification Jev assigned to the question. It is useful and
 * it is diagnostic, but `thematic_study` is not a word a reader wants on screen,
 * so it is humanised and kept in the tooltip.
 */
function EngineChip({ source, intent }: { source?: string; intent?: string }) {
  const readable = intent?.replace(/_/g, ' ');
  const live = source === 'jev';
  const label = live ? 'Ranked by meaning' : source === 'derived' ? 'Literal ranking' : 'Ranking';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        live ? 'bg-accent-soft text-accent' : 'bg-panel text-fg-muted'
      )}
      title={
        live
          ? 'Jev re-ranked these results by meaning. One extra request per search.'
          : 'Literal term ranking. No model call was made for this search.'
      }
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-accent' : 'bg-fg-faint')} />
      {label}
      {readable ? <span className="text-fg-faint">· {readable}</span> : null}
    </span>
  );
}

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [semantic, setSemantic] = useState(true);
  // Which texts this deployment can actually search. Null until it arrives, and
  // the filters stay neutral until then rather than guessing.
  const [unindexed, setUnindexed] = useState<string[] | null>(null);

  const { query, response, activeTexts, recent, setQuery, setResponse, toggleText, remember } = useSearchStore();

  useEffect(() => {
    let cancelled = false;
    void fetchCoverage().then((health) => {
      if (!cancelled && health) setUnindexed(health.search.unindexedTexts);
    });
    return () => {
      cancelled = true;
    };
  }, []);
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
  const hasSearched = Boolean(query) && !loading;
  const trayFull = passageKeys.length >= 8;

  // The composer's own text field, duplicated into state that resets on submit so
  // that a sent question leaves the field empty the way a chat composer does.
  const composer = (
    <form onSubmit={submit} className="composer">
      <Search className="h-[18px] w-[18px] shrink-0 text-fg-faint" />
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Ask the texts — mercy, covenant, the sabbath…"
        aria-label="Search sacred texts"
        className="composer-input"
      />
      {input ? (
        <button
          type="button"
          onClick={() => setInput('')}
          className="icon-btn h-7 w-7"
          aria-label="Clear"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
      <button
        type="submit"
        disabled={loading || !input.trim()}
        aria-label="Search"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
      </button>
    </form>
  );

  const textFilters = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-fg-faint">Texts</span>
      {TEXT_IDS.map((textId) => {
        const on = activeTexts.includes(textId);
        const missing = unindexed?.includes(textId) ?? false;
        return (
          <button
            key={textId}
            type="button"
            disabled={missing}
            onClick={() => {
              toggleText(textId);
              if (query) {
                void runSearch(query, activeTexts.includes(textId) ? activeTexts.filter((t) => t !== textId) : [...activeTexts, textId]);
              }
            }}
            aria-pressed={on}
            title={
              missing
                ? 'This deployment cannot search this text: the index is held in memory and does not fit all five corpora here.'
                : undefined
            }
            className={cn(
              'toggle-pill',
              missing
                ? 'cursor-not-allowed text-fg-faint/60 line-through decoration-fg-faint/40'
                : on
                  ? 'toggle-pill-on'
                  : 'toggle-pill-off'
            )}
          >
            {getTextLabel(textId, true)}
          </button>
        );
      })}
    </div>
  );

  return (
    <Shell>
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col px-5 pb-40 sm:px-8">
        {/* The landing state. A greeting and a handful of things to try, which is
            what makes the tool usable without reading any instructions. */}
        {!hasSearched ? (
          <div className="flex flex-1 flex-col justify-center py-10">
            <h1 className="text-[28px] font-medium tracking-tight sm:text-3xl">What do the texts say?</h1>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-fg-muted">
              Search the Quran, Torah, Talmud, Old and New Testaments together. Results carry their source
              text and a reference — no interpretation is written for you.
            </p>

            <div className="mt-8">{composer}</div>
            <div className="mt-3">{textFilters}</div>

            <div className="mt-10">
              <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-fg-faint">Try one</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUGGESTED.map((s) => (
                  <button
                    key={s.term}
                    type="button"
                    onClick={() => {
                      setInput(s.term);
                      void runSearch(s.term, activeTexts);
                    }}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3 text-left transition-all hover:border-accent/40 hover:bg-accent-soft/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{s.term}</span>
                      <span className="block truncate text-xs text-fg-faint">{s.hint}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-fg-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                  </button>
                ))}
              </div>
            </div>

            {recent.length > 0 ? (
              <div className="mt-8">
                <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-faint">Recent</h2>
                <div className="flex flex-wrap gap-1.5">
                  {recent.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => {
                        setInput(term);
                        void runSearch(term, activeTexts);
                      }}
                      className="rounded-full bg-panel px-3 py-1 text-xs text-fg-muted transition-colors hover:bg-line-soft hover:text-fg"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-10">
              <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-faint">
                Browse by theme
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {THEME_TAXONOMY.slice(0, 28).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    onClick={() => router.push(`/explore?theme=${theme}`)}
                    className="rounded-full border border-line px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    {theme.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* The question, as a bubble on the right, so the page reads as a
                question and an answer rather than as a report. */}
            <div className="flex items-start gap-3 pt-8">
              <p className="bubble">{query}</p>
              <button
                type="button"
                onClick={() => {
                  setInput(query);
                  void runSearch(query, activeTexts);
                }}
                className="icon-btn mt-1"
                aria-label="Search again"
                title="Search again"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>

            {error ? (
              <p className="mt-6 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
            ) : null}

            {trayFull ? (
              <p className="mt-6 text-xs text-fg-muted">
                Comparison holds 8 passages. Remove one before adding another.
              </p>
            ) : null}

            {loading ? (
              <div className="mt-8 space-y-6">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="skeleton h-3 w-32" />
                    <div className="skeleton h-4 w-full" />
                    <div className="skeleton h-4 w-4/5" />
                  </div>
                ))}
              </div>
            ) : results.length > 0 && response?.verdict !== 'unaddressed' ? (
              <>
                <div className="mt-6 flex flex-wrap items-center gap-3 border-b border-line pb-3">
                  <span className="text-sm text-fg-muted">
                    <span className="font-medium text-fg">{response?.total.toLocaleString()}</span> result
                    {response?.total === 1 ? '' : 's'}
                  </span>
                  <EngineChip source={response?.rerankSource} intent={response?.intent} />
                  <span className="text-xs text-fg-faint tabular-nums">{response?.tookMs}ms</span>
                  {passageKeys.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => router.push('/compare')}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-accent-fg"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Compare {passageKeys.length}
                    </button>
                  ) : null}
                </div>

                {response?.verdict === 'partial' ? (
                  <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    These texts touch on this rather than addressing it directly. Treat the results as leads.
                  </p>
                ) : null}

                {response?.expandedTheme ? (
                  <p className="mt-4 text-xs text-fg-faint">
                    Widened with the vocabulary of “{response.expandedTheme}”.
                  </p>
                ) : null}

                <div className="mt-2">
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
            ) : response?.verdict === 'unaddressed' ? (
              <div className="mt-8">
                <Empty icon={Sparkles} title="These texts do not address this">
                  Jev judged the shortlist and found nothing that speaks to it. That is a real answer rather than a
                  failed search — the closest literal matches are below. A different wording, or the Explore page,
                  may reach what you are after.
                </Empty>
              </div>
            ) : (
              <div className="mt-8">
                <Empty icon={Search} title="Nothing matched">
                  {unindexed && unindexed.length > 0
                    ? `This deployment searches ${unindexed.length < TEXT_IDS.length ? 'only some of' : 'none of'} the texts, because the search index is held in memory and does not fit all five corpora here. Settings lists which ones.`
                    : 'Try a single common noun, or clear the text filters. Terms are matched literally unless semantic ranking is on and a TypeSafe key is configured.'}
                </Empty>
              </div>
            )}
          </>
        )}
      </div>

      {/* The composer stays within reach once results are on screen, the way it
          does in every chat-shaped tool. Backdrop blur so results remain readable
          underneath it. */}
      {hasSearched ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-bg via-bg/95 to-transparent px-5 pb-5 pt-10 sm:px-8">
          <div className="pointer-events-auto mx-auto w-full max-w-3xl">
            {composer}
            <div className="mt-2 flex items-center justify-between gap-3">
              {textFilters}
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-fg-faint">
                <input
                  type="checkbox"
                  checked={semantic}
                  onChange={(e) => setSemantic(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[rgb(var(--accent))]"
                />
                Rank by meaning
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<Shell><div className="mx-auto max-w-3xl px-5 py-16"><div className="skeleton h-8 w-56" /></div></Shell>}>
      <SearchInner />
    </Suspense>
  );
}
