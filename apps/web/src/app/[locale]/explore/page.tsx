'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import type { TextId } from '@ilm/shared';
import { api, ApiError, type ThemeMap } from '@/lib/api';
import { Page, PageHeader, Empty } from '@/components/Shell';
import { getTextChipClass, getTextLabel, percent, TEXT_IDS } from '@/lib/utils';

interface JourneyStep {
  passageId: string;
  passageKey: string;
  textId: TextId;
  book: string;
  chapter: number;
  verse: number;
  preview: string;
  score: number;
  chronologicalOrder: number;
}

function ExploreInner() {
  const router = useRouter();
  const params = useSearchParams();
  const theme = params.get('theme') ?? 'mercy';

  const [steps, setSteps] = useState<JourneyStep[] | null>(null);
  const [map, setMap] = useState<ThemeMap | null>(null);
  const [themes, setThemes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSteps(null);

    Promise.all([api.journey(theme, 24), api.themeMap(theme), api.themes()])
      .then(([journey, themeMap, allThemes]) => {
        if (cancelled) return;
        setSteps(journey.journey as unknown as JourneyStep[]);
        setMap(themeMap);
        setThemes(allThemes.themes);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'Could not load this theme.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [theme]);

  /*
   * Bucketed by corpus, then ordered within each bucket.
   *
   * The reduce alone left each bucket in whatever order the API returned, and the
   * API returned global score order — so the page claimed to show each corpus in
   * its own sequence while actually showing its strongest-scoring verses. Sorting
   * here is what makes that sentence true. `chronologicalOrder` is the passage's
   * position inside its own corpus, which is the only sequence that means anything:
   * Genesis 3 and Quran 19:1 have no order relative to each other.
   */
  const byText = (steps ?? []).reduce<Record<string, JourneyStep[]>>((acc, step) => {
    (acc[step.textId] ??= []).push(step);
    return acc;
  }, {});

  for (const list of Object.values(byText)) {
    list.sort((a, b) => a.chronologicalOrder - b.chronologicalOrder);
  }

  return (
    <Page>
      <PageHeader
        title={`Theme: ${theme.replace(/_/g, ' ')}`}
        description="Passages carrying this theme, grouped by corpus and ordered by each corpus’s own sequence. Theme scores are produced during indexing, not at query time."
      />

      <div className="mb-6 flex flex-wrap gap-1.5">
        {themes.slice(0, 60).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => router.push(`/explore?theme=${name}`)}
            aria-current={name === theme ? 'true' : undefined}
            className={
              name === theme
                ? 'rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent'
                : 'rounded bg-panel px-2 py-0.5 text-xs text-fg-muted transition-colors hover:bg-line-soft hover:text-fg'
            }
          >
            {name.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 py-12 text-sm text-fg-faint">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading theme journey…
        </p>
      ) : null}

      {!loading && steps?.length === 0 ? (
        <Empty icon={Sparkles} title={`No passages are tagged “${theme}”`}>
          Themes are assigned by the indexing run. Run{' '}
          <code className="rounded bg-panel px-1">npm run index</code> to (re)score the corpus.
        </Empty>
      ) : null}

      {!loading && steps && steps.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            {TEXT_IDS.filter((textId) => byText[textId]?.length).map((textId) => (
              <section key={textId}>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <span className={getTextChipClass(textId)}>{getTextLabel(textId)}</span>
                  <span className="text-xs font-normal text-fg-faint">{byText[textId].length} passages</span>
                </h2>
                <ol className="space-y-2">
                  {byText[textId].map((step) => (
                    <li key={step.passageId} className="rounded-lg border border-line p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <a
                          href={`/passage/${step.passageKey.split('/').map(encodeURIComponent).join('/')}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {step.book} {step.chapter}:{step.verse}
                        </a>
                        <span className="ml-auto font-mono text-xs text-fg-faint">{percent(step.score)}</span>
                      </div>
                      <p className="line-clamp-2 text-sm text-ink-700 dark:text-ink-300">{step.preview}</p>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>

          <aside className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
            <h2 className="mb-1 text-sm font-semibold">Themes that co-occur</h2>
            <p className="mb-3 text-xs text-ink-500">How often each theme appears on the same passages.</p>
            {map && map.related.length > 0 ? (
              <ul className="space-y-1.5">
                {map.related.slice(0, 15).map((entry) => (
                  <li key={entry.theme}>
                    <button
                      type="button"
                      onClick={() => router.push(`/explore?theme=${entry.theme}`)}
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-ink-100 dark:hover:bg-ink-800"
                    >
                      <span className="w-28 shrink-0 truncate">{entry.theme.replace(/_/g, ' ')}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded bg-ink-200 dark:bg-ink-800">
                        <span
                          className="block h-full bg-emerald-700 dark:bg-emerald-500"
                          style={{ width: `${Math.min(100, entry.sharedPassages * 4)}%` }}
                        />
                      </span>
                      <span className="w-6 shrink-0 text-right font-mono text-ink-500">{entry.sharedPassages}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-500">Nothing else co-occurs with this theme yet.</p>
            )}
          </aside>
        </div>
      ) : null}
    </Page>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<Page><p className="py-12 text-sm text-ink-500">Loading…</p></Page>}>
      <ExploreInner />
    </Suspense>
  );
}
