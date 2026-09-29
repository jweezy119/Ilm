'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { CitationsPanel } from '@/components/CitationsPanel';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Compass, Loader2, Minus, Plus, Scale, Sparkles } from 'lucide-react';
import type { CrossRef, Passage, RecommendationWeights } from '@ilm/shared';
import { api, ApiError, type RecommendationExplanation } from '@/lib/api';
import { Page, PageHeader, Empty } from '@/components/Shell';
import { LookupableText, LEXICON_LANGUAGES } from '@/components/LexiconPanel';
import { SourceBadge, SOURCE_SENTENCE } from '@/components/SourceBadge';
import { TranslationSwitcher, useTranslationChoice } from '@/components/TranslationSwitcher';
import { useComparisonStore, useSettingsStore } from '@/store';
import { cn, getTextChipClass, getTextDirection, getTextLabel, getScriptFont, percent, truncate, TEXT_STYLES } from '@/lib/utils';

/**
 * What produced a cross-reference, stated plainly.
 *
 * `ngram` is a verbatim text match, and calling it "derived" alongside a score of
 * 100% would misrepresent it — a reader would discount a finding a concordance
 * would confirm. It is a third thing, distinct from both a model's opinion and a
 * local guess, and it is the most checkable of the three because the matched words
 * are in the notes.
 */
const PRODUCED_BY: Record<string, string> = {
  jev: 'jev',
  ngram: 'verbatim match',
  manual: 'entered by hand',
  derived: 'derived',
};

/**
 * Relationship names in words. `parallel` and `duplicate` are separated from
 * `quotation` deliberately: a text repeating itself, and the same verse appearing
 * in two collections, are not citations, and presenting them as ones would
 * overstate the corpus's lineage.
 */
const REFERENCE_LABELS: Record<string, string> = {
  quotation: 'quotation',
  parallel: 'parallel (same corpus)',
  duplicate: 'duplicate witness',
  quote: 'quotation',
  allusion: 'allusion',
  thematic: 'thematic',
  linguistic: 'linguistic',
  narrative: 'narrative',
  theological: 'theological',
  historical: 'historical',
};

const DIMENSIONS: Array<{ key: keyof RecommendationWeights; label: string }> = [
  { key: 'thematic', label: 'Thematic' },
  { key: 'linguistic', label: 'Linguistic' },
  { key: 'historical', label: 'Historical' },
  { key: 'narrative', label: 'Narrative' },
  { key: 'theological', label: 'Theological' },
];

export default function PassagePage() {
  const params = useParams<{ key: string[] }>();
  const passageKey = (params?.key ?? []).map(decodeURIComponent).join(':');

  const [passage, setPassage] = useState<Passage | null>(null);
  const translation = useTranslationChoice(passage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!passageKey) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    api
      .passageByKey(passageKey)
      .then((result) => {
        if (cancelled) return;
        setPassage(result);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Could not load this passage.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [passageKey]);

  if (loading) {
    return (
      <Page>
        <div className="flex items-center gap-2 py-16 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading passage…
        </div>
      </Page>
    );
  }

  if (error || !passage) {
    return (
      <Page>
        <Empty icon={AlertTriangle} title="Passage not available">
          {error ?? `No passage is stored under ${passageKey}.`}{' '}
          <Link href="/" className="underline">
            Search instead
          </Link>
          .
        </Empty>
      </Page>
    );
  }

  return (
    <Page>
      <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-600 hover:underline dark:text-ink-400">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to search
      </Link>

      <PageHeader
        title={`${passage.book} ${passage.chapter}:${passage.verse}`}
        description={getTextLabel(passage.textId)}
        action={
          <div className="flex items-center gap-2">
            {/* The other half of this page. The passages below are the ones that
                link to this verse; this is where the same verse leads outward
                through the themes it carries, grouped by context. */}
            <Link href={`/journey?id=${encodeURIComponent(passage.id)}`} className="btn btn-secondary">
              <Compass className="h-4 w-4" />
              Journey
            </Link>
            <CompareButton passage={passage} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
          <article className={cn('rounded-xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900', TEXT_STYLES[passage.textId].border.replace('border-l-', 'border-l-4 border-l-'))}>
            <header className="mb-4 flex items-center gap-2">
              <span className={getTextChipClass(passage.textId)}>{getTextLabel(passage.textId)}</span>
              <span className="font-mono text-xs text-ink-500">{passage.passageKey}</span>
            </header>

            {passage.originalText ? (
              <section className="mb-5">
                <h2 className="mb-1 text-xs uppercase tracking-wide text-ink-500">Original ({passage.metadata.language})</h2>
                {/* Tap any word for its dictionary entries. Only offered for the
                    scripts a lexicon here covers — Hebrew and Aramaic — so a Quranic
                    or Greek word is not given a button that can only come back empty. */}
                {LEXICON_LANGUAGES.has(passage.metadata.language) ? (
                  <LookupableText
                    text={passage.originalText}
                    className={cn('text-ink-900 dark:text-ink-100', getScriptFont(passage.metadata.language))}
                    dir={getTextDirection(passage.textId)}
                  />
                ) : (
                  <p dir={getTextDirection(passage.textId)} className={cn('text-ink-900 dark:text-ink-100', getScriptFont(passage.metadata.language))}>
                    {passage.originalText}
                  </p>
                )}
                <p className="mt-1.5 text-[11px] text-ink-500">
                  {LEXICON_LANGUAGES.has(passage.metadata.language)
                    ? 'Every word is tappable — each opens the published dictionary entries for it.'
                    : 'No dictionary in this library covers this script yet.'}
                </p>
              </section>
            ) : null}

            <section>
              <h2 className="mb-1 text-xs uppercase tracking-wide text-ink-500">Translation</h2>
              {/* Driven by the reader's choice, so the text under the heading is
                  always the one the switcher has selected. */}
              <p className="text-lg leading-relaxed text-ink-800 dark:text-ink-200">{translation.active.text}</p>
              <TranslationSwitcher
                options={translation.options}
                activeName={translation.active.name}
                onChoose={translation.choose}
                className="mt-2"
              />
            </section>
          </article>

          {passage.themes.length > 0 ? (
            <section className="mt-4">
              <h2 className="mb-2 text-sm font-medium">Scored themes</h2>
              <ul className="flex flex-wrap gap-1.5">
                {passage.themes.map((theme) => (
                  <li key={theme.theme}>
                    <Link
                      href={`/explore?theme=${theme.theme}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-ink-300 px-2.5 py-1 text-xs hover:border-emerald-700 hover:text-emerald-800 dark:border-ink-700 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
                    >
                      {theme.theme.replace(/_/g, ' ')}
                      <span className="font-mono text-ink-500">{percent(theme.score)}</span>
                      <SourceBadge source={theme.source} className="bg-transparent p-0 text-ink-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <CrossReferences passageId={passage.id} initial={passage.crossReferences as Array<CrossRef & { targetPassageKey?: string }>} />
        </div>

        {/* Citations: the cross-corpus verbatim matches, separated from the
            mixed cross-reference list because they are a different kind of claim. */}
        <CitationsPanel passageId={passage.id} passageKey={passage.passageKey} />

        <RecommendationPanel passage={passage} />
      </div>
    </Page>
  );
}

/**
 * Cross-references are detected on the first request and stored after that, so
 * this section fills in shortly after the page opens rather than blocking it.
 */
function CrossReferences({ passageId, initial }: { passageId: string; initial: Array<CrossRef & { targetPassageKey?: string }> }) {
  const [references, setReferences] = useState(initial);
  const [loading, setLoading] = useState(initial.length === 0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial.length > 0) return;
    let cancelled = false;

    api
      .crossReferences(passageId)
      .then((result) => {
        if (!cancelled) setReferences(result.references);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'Could not load cross-references.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [passageId, initial.length]);

  if (loading) {
    return (
      <section className="mt-4">
        <h2 className="mb-2 text-sm font-medium">Cross-references</h2>
        <p className="flex items-center gap-2 text-xs text-ink-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking for connections across the texts…
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mt-4">
        <h2 className="mb-2 text-sm font-medium">Cross-references</h2>
        <p className="text-xs text-ink-500">{error}</p>
      </section>
    );
  }

  if (references.length === 0) return null;

  return (
    <section className="mt-4">
      <h2 className="mb-2 text-sm font-medium">Cross-references</h2>
      <ul className="space-y-1.5">
        {references.map((ref) => {
          const key = (ref as CrossRef & { targetPassageKey?: string }).targetPassageKey;
          return (
            <li key={`${ref.targetPassageId}-${ref.type}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className={getTextChipClass(ref.targetText)}>{getTextLabel(ref.targetText, true)}</span>
              {/*
                The link names the passage being cited, and never the note.
                It used to prefer the note, which meant a detected quotation
                rendered as "Longest verbatim run 8 words" where the reader needed
                to see Hosea 1:10 — the one thing the citation is for. The note
                carries the evidence and belongs in the tooltip.
              */}
              {key ? (
                <a
                  href={`/passage/${key.split('/').map(encodeURIComponent).join('/')}`}
                  className="font-medium hover:underline"
                  title={ref.notes ?? undefined}
                >
                  {/* Drop the leading corpus id (`ot:Hosea:1:10` -> `Hosea:1:10`) so
                      the book is named. The corpus is already on the chip beside it. */}
                  {key.split(':').slice(1).join(':')}
                </a>
              ) : (
                <span className="font-mono text-xs text-ink-500">{ref.targetPassageId.slice(0, 18)}</span>
              )}
              <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] dark:bg-ink-800">{REFERENCE_LABELS[ref.type] ?? ref.type.replace(/_/g, ' ')}</span>
              <span className="font-mono text-xs text-ink-500">{percent(ref.strength)}</span>
              <span className="text-[11px] text-ink-400">{PRODUCED_BY[ref.detectedBy] ?? 'derived'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CompareButton({ passage }: { passage: Passage }) {
  const { toggle, has, passageKeys } = useComparisonStore();
  const inTray = has(passage.passageKey);

  return (
    <button
      type="button"
      onClick={() => toggle(passage)}
      aria-pressed={inTray}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
        inTray
          ? 'border-emerald-700 bg-emerald-800 text-white'
          : 'border-ink-300 hover:border-emerald-700 hover:text-emerald-800 dark:border-ink-700 dark:hover:border-emerald-500 dark:hover:text-emerald-400'
      )}
    >
      {inTray ? <Check className="h-4 w-4" /> : <Scale className="h-4 w-4" />}
      {inTray ? `In comparison (${passageKeys.length})` : 'Add to comparison'}
    </button>
  );
}

function RecommendationPanel({ passage }: { passage: Passage }) {
  const weights = useSettingsStore((s) => s.weights);
  const addKey = useComparisonStore((s) => s.addKey);
  const removeKey = useComparisonStore((s) => s.remove);
  const has = useComparisonStore((s) => s.has);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; message?: string; data?: Awaited<ReturnType<typeof api.recommendations>> }>({ status: 'loading' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [excludeSameText, setExcludeSameText] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    api
      .recommendations({
        passageId: passage.id,
        weights,
        limit: 8,
        excludeTexts: excludeSameText ? [passage.textId] : undefined,
        minScore: 0.15,
      })
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((caught) => {
        if (!cancelled) setState({ status: 'error', message: caught instanceof ApiError ? caught.message : 'Could not load recommendations.' });
      });

    return () => {
      cancelled = true;
    };
  }, [passage.id, passage.textId, weights, excludeSameText]);

  return (
    <aside className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
      <header className="mb-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-ink-400" /> Closest relations
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Ranked by a weighted sum of five dimensions. Changing a weight in{' '}
          <Link href="/settings" className="underline">
            Settings
          </Link>{' '}
          re-ranks without re-running the model.
        </p>
        {state.status === 'ready' && state.data ? (
          <p className="mt-1 text-[11px] text-ink-500">
            {SOURCE_SENTENCE[state.data.source]}
            {state.data.cachedCount > 0 ? `, ${state.data.cachedCount} from cache` : ''}.
          </p>
        ) : null}
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-600 dark:text-ink-400">
          <input type="checkbox" checked={excludeSameText} onChange={(e) => setExcludeSameText(e.target.checked)} />
          Hide {getTextLabel(passage.textId, true)} results
        </label>
      </header>

      {state.status === 'loading' ? (
        <p className="flex items-center gap-2 py-6 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Scoring candidates…
        </p>
      ) : null}

      {state.status === 'error' ? <p className="text-sm text-red-700 dark:text-red-300">{state.message}</p> : null}

      {state.status === 'ready' ? (
        state.data && state.data.recommendations.length > 0 ? (
          <ul className="space-y-2">
            {state.data.recommendations.map((rec) => {
              const inTray = has(rec.passageKey);
              return (
              <li key={rec.passageId} className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
                <div className="mb-1 flex items-center gap-2">
                  <span className={getTextChipClass(rec.textId)}>{getTextLabel(rec.textId, true)}</span>
                  <Link href={`/passage/${rec.passageKey.split('/').map(encodeURIComponent).join('/')}`} className="text-sm font-medium hover:underline">
                    {rec.book} {rec.chapter}:{rec.verse}
                  </Link>
                  {/* Provenance per row. Without it every number here reads as model
                      output, which is false when the pair fell back or was cached. */}
                  <SourceBadge source={rec.source} className="px-1 py-0.5 text-[10px]" />
                  <span className="ml-auto font-mono text-xs text-ink-500">{percent(rec.scores.composite)}</span>
                </div>

                <p className="line-clamp-2 text-sm text-ink-700 dark:text-ink-300">{truncate(rec.preview, 180)}</p>

                {rec.matchedThemes.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {rec.matchedThemes.map((theme) => (
                      <li key={theme} className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-700 dark:bg-ink-800 dark:text-ink-300">
                        {theme}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <ul className="mt-2 space-y-1">
                  {DIMENSIONS.map((dim) => (
                    <li key={dim.key} className="flex items-center gap-2 text-[11px]">
                      <span className="w-20 shrink-0 text-ink-500">{dim.label}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded bg-ink-200 dark:bg-ink-800">
                        <span
                          className="block h-full rounded bg-emerald-700 dark:bg-emerald-500"
                          style={{ width: percent(rec.scores[dim.key]) }}
                        />
                      </span>
                      <span className="w-9 shrink-0 text-right font-mono text-ink-500">{percent(rec.scores[dim.key])}</span>
                    </li>
                  ))}
                </ul>

                <p className="mt-2 text-[11px] text-ink-500">{rec.reasoning}</p>

                {/* The two things a reader actually wants from a relation: go there,
                    or put it beside this passage. */}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Link
                    href={`/passage/${rec.passageKey.split('/').map(encodeURIComponent).join('/')}`}
                    className="inline-flex items-center gap-1 rounded border border-ink-300 px-2 py-0.5 text-[11px] hover:border-ink-500 dark:border-ink-700"
                  >
                    <ArrowRight className="h-3 w-3" /> Open this passage
                  </Link>
                  <button
                    type="button"
                    onClick={() => (inTray ? removeKey(rec.passageKey) : addKey(rec.passageKey))}
                    className="inline-flex items-center gap-1 rounded border border-ink-300 px-2 py-0.5 text-[11px] hover:border-ink-500 dark:border-ink-700"
                  >
                    {inTray ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    {inTray ? 'Remove from comparison' : 'Compare beside this'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === rec.passageId ? null : rec.passageId)}
                    className="text-[11px] text-emerald-800 underline dark:text-emerald-400"
                  >
                    {expanded === rec.passageId ? 'Hide evidence' : 'Why this passage?'}
                  </button>
                </div>

                {expanded === rec.passageId ? <Explanation sourceId={passage.id} targetId={rec.passageId} /> : null}
              </li>
              );
            })}
          </ul>
        ) : (
          <Empty title="No passages scored above the threshold">
            Loosen the weights in Settings, or uncheck “hide this corpus”, to widen the candidate pool.
          </Empty>
        )
      ) : null}
    </aside>
  );
}

function Explanation({ sourceId, targetId }: { sourceId: string; targetId: string }) {
  const [data, setData] = useState<RecommendationExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);

    api
      .explain(sourceId, targetId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'Could not load the breakdown.');
      });

    return () => {
      cancelled = true;
    };
  }, [sourceId, targetId]);

  if (error) return <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <p className="mt-2 text-[11px] text-ink-500">Loading breakdown…</p>;

  return (
    <div className="mt-2 rounded border border-ink-200 p-2 text-[11px] dark:border-ink-800">
      <p className="mb-1.5 text-ink-600 dark:text-ink-400">{data.summary}</p>
      <table className="w-full text-left">
        <tbody>
          {data.breakdown.map((row) => (
            <tr key={row.dimension}>
              <td className="py-0.5 pr-2 text-ink-500">{row.dimension}</td>
              <td className="py-0.5 pr-2 font-mono">{percent(row.score)}</td>
              <td className="py-0.5 pr-2 font-mono text-ink-500">×{row.weight.toFixed(2)}</td>
              <td className="py-0.5 font-mono">{percent(row.contribution)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.breakdown.some((row) => row.evidence.length > 0) ? (
        <ul className="mt-2 space-y-1">
          {data.breakdown
            .filter((row) => row.evidence.length > 0)
            .map((row) => (
              <li key={row.dimension}>
                <span className="text-ink-500">{row.dimension}:</span>{' '}
                {row.evidence.slice(0, 5).join(', ')}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

