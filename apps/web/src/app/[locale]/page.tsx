'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Search, X, Loader2, AlertTriangle, ArrowRight, Layers } from 'lucide-react';
import { THEME_TAXONOMY, type TextId, type Topic } from '@ilm/shared';
import { api, ApiError } from '@/lib/api';
import { CitationJump } from '@/components/CitationJump';
import { Shell, Empty } from '@/components/Shell';
import { PassageCard } from '@/components/PassageCard';
import { VerdictPanel } from '@/components/VerdictPanel';
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
 * A row of quick links to the curated topics.
 *
 * A short list, not all twelve: this is the landing state, and a wall of links is
 * the thing a landing page exists to avoid. Six covers the range and the Topics
 * page is one click away. Counts come from the same endpoint that page uses, so a
 * chip can never promise a topic the page would decline to serve.
 */
function TopicChips() {
  const t = useTranslations('topics');
  const [topics, setTopics] = useState<Topic[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .topics()
      .then((d) => {
        if (!cancelled) setTopics(d.topics.slice(0, 6));
      })
      .catch(() => {
        // A failed suggestion list is not worth an error state on the landing
        // page. The search box above it still works, and Topics is one click away.
        if (!cancelled) setTopics([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!topics || topics.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-fg-faint">{t('browse')}</h2>
        <Link href="/topics" className="text-xs text-fg-muted hover:text-fg">
          {t('allTopics')}
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {topics.map((topic) => (
          <Link
            key={topic.slug}
            href={`/topics/${topic.slug}`}
            className="rounded-full border border-line px-3 py-1.5 text-[13px] text-fg transition-colors hover:border-accent/50 hover:bg-panel"
          >
            {t(`items.${topic.slug}.label`)}
            <span className="ms-1.5 text-xs text-fg-faint tabular-nums">{topic.passages.toLocaleString()}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * How a result set was judged, stated the way a model picker states the model.
 *
 * The intent is the classification Jev assigned to the question. It is useful and
 * it is diagnostic, but `thematic_study` is not a word a reader wants on screen,
 * so it is humanised and kept in the tooltip.
 */
/**
 * Shown when the search had to fall back to trigram matching.
 *
 * These results resemble the typed term rather than contain it, which is a
 * different kind of claim than the reader made. Saying so is the difference
 * between "no match" and "here is the closest thing, and here is how we found
 * it" — which matters more here than elsewhere, because the ranking is a number
 * the UI is otherwise presenting as fact.
 */
function RelaxedChip() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-xs font-medium text-fg-muted"
      title="Nothing matched that spelling, so results were found by similarity. Check the wording before quoting these."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-fg-faint" />
      Close spelling match
    </span>
  );
}

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
  const t = useTranslations('search');

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [semantic, setSemantic] = useState(true);
  // Which texts this deployment can actually search. Null until it arrives, and
  // the filters stay neutral until then rather than guessing.
  const [unindexed, setUnindexed] = useState<string[] | null>(null);
  // How many passages this deployment can actually search. The verdict claims
  // these texts do not address something, and a claim that broad needs a scope to
  // be checkable against: "45,453 passages" is answerable, "the texts" is not.
  const [searched, setSearched] = useState<number | null>(null);

  const { query, response, activeTexts, recent, setQuery, setResponse, toggleText, remember } = useSearchStore();

  useEffect(() => {
    let cancelled = false;
    void fetchCoverage().then((corpus) => {
      if (!cancelled && corpus) {
        setUnindexed(corpus.search.unindexedTexts);
        setSearched(corpus.search.passagesIndexed);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const { passageKeys, toggle, has } = useComparisonStore();

  /*
   * Re-run the current search across all five texts.
   *
   * Offered on the "these texts do not address this" verdict, because that verdict
   * is scoped to whatever the reader had filtered to: a search narrowed to the
   * Quran finding nothing is a much weaker claim than the same search across all
   * five, and without this the panel would report a no that the reader could
   * disprove in one click and feel misled when they did.
   */
  const widenAllTexts = useCallback(() => {
    for (const textId of TEXT_IDS) {
      if (!activeTexts.includes(textId)) toggleText(textId);
    }
  }, [activeTexts, toggleText]);

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
  /*
   * A reference is offered as a jump, not run as a search.
   *
   * "John 3:16" typed into a full-text box returns ranked matches for the words
   * John, 3 and 16, which is not what anyone typing a reference wants. The offer
   * sits above the input so the reader sees the verse before clicking, and it is
   * dismissible so a phrase that merely looks like a reference is not in the way.
   */
  const composer = (
    <>
    {!hasSearched && input.trim().length > 2 ? (
      <CitationJump value={input} onDismiss={() => setInput(input)} />
    ) : null}
    <form onSubmit={submit} className="composer">
      <Search className="h-[18px] w-[18px] shrink-0 text-fg-faint" />
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={t('placeholder')}
        aria-label={t('heroSearchLabel')}
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
    </>
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
            {/* Leads with the two things a competitor cannot copy: one search
                across five traditions in their own languages, and a refusal to
                write the interpretation. It used to open "What do the texts say?",
                which is a friendlier line but says nothing about either, and it
                used to be hardcoded English on a page served in three locales. */}
            <h1 className="text-[28px] font-medium tracking-tight sm:text-3xl">{t('heroTitle')}</h1>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-fg-muted">{t('heroSubtitle')}</p>

            <div className="mt-8">{composer}</div>
            <div className="mt-3">{textFilters}</div>

            <div className="mt-10">
              <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-fg-faint">{t('heroTryOne')}</h2>
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

            {/* Topic chips. The suggested searches above are questions to type;
                these are subjects to open, and each one carries its measured
                size so the reader knows a link is worth clicking. */}
            <TopicChips />

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
                  {response?.matchMode === 'relaxed' ? <RelaxedChip /> : null}
                  <span className="text-xs text-fg-faint tabular-nums">{response?.tookMs}ms</span>
                  {passageKeys.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => router.push('/compare')}
                      className="ms-auto inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-accent-fg"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Compare {passageKeys.length}
                    </button>
                  ) : null}
                </div>

                {/*
                    The partial verdict travels with the results instead of above
                    them. It used to be a banner that scrolled off, so by the time a
                    reader reached the twentieth result — the one they were about to
                    quote — the warning that every result is a lead rather than a
                    match had left the screen. */}
                {response?.verdict === 'partial' ? (
                  <VerdictPanel
                    className="mt-4"
                    verdict="partial"
                    source={response.rerankSource}
                    searchedPassages={searched ?? undefined}
                    texts={activeTexts}
                    expandedTheme={response.expandedTheme}
                    suggestions={response.suggestions}
                  />
                ) : null}

                <div className="mt-2">
                  {results.map((result) => (
                    <PassageCard
                      key={result.passage.id}
                      passage={result.passage}
                      score={result.score}
                      semanticScore={result.semanticScore}
                      textScore={result.textScore}
                      // Which field earned the hit, so a result found in the
                      // Hebrew or Arabic can say so rather than leaving the reader
                      // to wonder why an English paragraph answered a Hebrew word.
                      matchedIn={result.matchedFields}
                      query={query}
                      inComparison={has(result.passage.passageKey)}
                      onToggleCompare={toggle}
                    />
                  ))}
                </div>
              </>
            ) : response?.verdict === 'unaddressed' ? (
              /*
               * Promoted out of `Empty` and given a receipt.
               *
               * Two things were wrong with the old version. It rendered inside the
               * empty-result branch, so its promise that "the closest literal
               * matches are below" pointed at nothing — in this branch there are no
               * results. And an `Empty` box presents a real answer as a failure to
               * find one, which is backwards for the one capability no competitor
               * will build because it costs them a session.
               */
              <VerdictPanel
                className="mt-6"
                verdict="unaddressed"
                source={response.rerankSource}
                searchedPassages={searched ?? undefined}
                texts={activeTexts}
                expandedTheme={response.expandedTheme}
                suggestions={response.suggestions}
                narrowed={activeTexts.length < TEXT_IDS.length}
                onWiden={widenAllTexts}
                onPick={(term) => {
                  setInput(term);
                  void runSearch(term, activeTexts);
                }}
              />
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
