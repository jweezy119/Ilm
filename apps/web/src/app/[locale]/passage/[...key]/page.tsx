'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { FigureNotice, RelatedPanel } from '@/components/RelatedPanel';
import { SaveButton } from '@/components/SaveButton';
import { AddToJourney } from '@/components/AddToJourney';
import { CopyCitation } from '@/components/CopyCitation';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ArrowRight, Compass, Loader2, Scale, Sparkles } from 'lucide-react';
import type { CrossRef, Passage } from '@ilm/shared';
import { api, ApiError, type RecommendationExplanation } from '@/lib/api';
import { Page, PageHeader, Empty } from '@/components/Shell';
import { LookupableText, LEXICON_LANGUAGES } from '@/components/LexiconPanel';
import { GlossableText } from '@/components/GlossableText';
import { RecitationPlayer, useRecitationVerse } from '@/components/RecitationPlayer';
import { ReadAloud } from '@/components/ReadAloud';
import { GLOSSARY_TEXTS } from '@/lib/glossary';
import { SourceBadge, SOURCE_SENTENCE } from '@/components/SourceBadge';
import { TranslationSwitcher, useTranslationChoice } from '@/components/TranslationSwitcher';
import { useSettingsStore } from '@/store';
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

/*
 * What each dimension is, matching the labels the API sends in its breakdown.
 *
 * The API words these honestly — "historical connection (not measured here)" and
 * "theological alignment (a subset of thematic resonance)" — because a dimension
 * carrying no weight and a dimension measured by the same classifier as its
 * neighbour both need saying out loud. Rendering the bare key here threw that away
 * in the one place the reader went looking for it.
 */
const DIMENSION_HELP: Record<string, string> = {
  thematic: 'Thematic resonance',
  linguistic: 'Shared terminology and roots',
  historical: 'Historical connection — not measured here',
  narrative: 'Narrative parallel',
  theological: 'Theological alignment — a subset of thematic resonance',
};

export default function PassagePage() {
  const params = useParams<{ key: string[] }>();
  const passageKey = (params?.key ?? []).map(decodeURIComponent).join(':');

  const [passage, setPassage] = useState<Passage | null>(null);
  const copyLabel = useTranslations('library')('takeWithYou');
  const speechT = useTranslations('speech');
  const translation = useTranslationChoice(passage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const recitationVerse = useRecitationVerse(passage?.passageKey ?? '');
  // Attached once the translation is known, so the recitation can read the
  // meaning after the Arabic rather than the reader assembling two players.
  const recitationWithTranslation = useMemo(
    // `active` is undefined until the passage has loaded, and this runs on the
    // first render rather than inside the JSX that already guards for it.
    () => recitationVerse.map((v) => ({ ...v, translation: translation.active?.text })),
    [recitationVerse, translation.active?.text]
  );

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
            <SaveButton passageKey={passage.passageKey} variant="full" />
            {/* Beside Save rather than inside it: keeping a passage is a bookmark,
                putting it in a journey is a decision about a sequence. */}
            <AddToJourney passageKey={passage.passageKey} />
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
              {/* Quranic terms in the translation are tappable, the way the
                  original text above is tappable for Hebrew and Aramaic words. The
                  two are separate sources: one is a bundled curated glossary, the
                  other the published Sefaria dictionaries. */}
              <GlossableText
                text={translation.active.text}
                textId={passage.textId}
                className="text-lg leading-relaxed text-ink-800 dark:text-ink-200"
              />
              {GLOSSARY_TEXTS.has(passage.textId) ? (
                <p className="mt-1.5 text-[11px] text-ink-500">
                  Dotted terms open a short definition and the verses behind it.
                </p>
              ) : null}
              <TranslationSwitcher
                options={translation.options}
                activeName={translation.active.name}
                onChoose={translation.choose}
                className="mt-2"
              />
            </section>

            {/*
              Two different things, labelled as two different things.

              The recitation player is a human voice and only the Quran has one
              here, so it renders for Quran passages and nothing else. The read
              aloud control is a voice the reader's device already has, and it
              works for every corpus. Putting them under one heading called
              "Audio" would let a synthetic voice pass for a recitation, which is
              the one claim this library must not blur.
            */}
            <div className="mt-5 flex flex-wrap items-start gap-6 border-t border-ink-200 pt-4 dark:border-ink-800">
              <div>
                <h2 className="mb-1 text-xs uppercase tracking-wide text-ink-500">{speechT('recitationHeading')}</h2>
                {/* One control, and it does both: the recording, then the
                    meaning. Two buttons would make a reader who cannot read Arabic
                    put the two halves in the right order themselves. */}
                <RecitationPlayer verses={recitationWithTranslation} />
                {recitationVerse.length === 0 ? (
                  <p className="max-w-xs text-[11px] text-ink-500">{speechT('noRecitation')}</p>
                ) : null}
              </div>
              {passage.textId === 'quran' ? null : (
                <div>
                  <h2 className="mb-1 text-xs uppercase tracking-wide text-ink-500">{speechT('readAloudHeading')}</h2>
                  <ReadAloud text={translation.active.text} textId={passage.textId} compact />
                </div>
              )}
            </div>
          </article>

          {/* Take it with you. On a passage page this is the most likely next
              action after reading, and it is the one the app has no way to
              remember on the reader's behalf. */}
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-medium">{copyLabel}</h2>
            <CopyCitation passage={passage} />
          </section>

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

        {/* Related passages, replacing the citations-only panel. Same verbatim
            matches, plus the model relations and shared themes that were
            previously in two other places, each labelled with its kind. */}
        <FigureNotice passageId={passage.id} />
        <RelatedPanel passageId={passage.id} />

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

function RecommendationPanel({ passage }: { passage: Passage }) {
  const weights = useSettingsStore((s) => s.weights);
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

                {/*
                    The five bars and the composite used to be here, above the text.

                    They were the same numbers the disclosure below produces, in a
                    form that took eleven lines of vertical space on every row. A
                    reader came to this page for a relation and had to read past a
                    small dashboard to get to the passage, and the one number that
                    mattered — which of these is closest — is already the order the
                    list is in. So they moved into the disclosure rather than being
                    deleted: the arithmetic is still there, still one click away,
                    and now it costs nothing to skip.
                */}
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
                  {/*
                      Additive, and a link rather than a button.

                      The label promised adjacency and the mechanism was a tray: click
                      it and nothing appeared beside anything, a counter went up on
                      another page, and a second click was needed to see the result.
                      For a reader mid-way through one passage that is the most
                      frictionful interaction on the page.

                      `/compare?keys=` already exists and takes precedence over the
                      tray, so this is a plain link to the two passages side by side.
                      It is also shareable now, which the tray was not — the same
                      pair in a message is the same pair in a URL.
                  */}
                  <Link
                    href={`/compare?keys=${encodeURIComponent(`${passage.passageKey},${rec.passageKey}`)}`}
                    className="inline-flex items-center gap-1 rounded border border-ink-300 px-2 py-0.5 text-[11px] hover:border-ink-500 dark:border-ink-700"
                  >
                    <Scale className="h-3 w-3" />
                    Compare beside this
                  </Link>
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
          <Empty title="No relations found">
            Nothing in the searched texts came close to this one. The related passages
            above show what the corpus does hold, which is often a better next step
            than a different threshold.
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
      <p className="mb-1.5 font-mono text-ink-600 dark:text-ink-400">
        composite {percent(data.scores.composite)}
      </p>
      <table className="w-full text-left">
        <tbody>
          {data.breakdown.map((row) => (
            <tr key={row.dimension}>
              {/* The API's label, which says when a dimension is not measured and
                  which one overlaps which. The bare key did not, so the honest part
                  of the disclosure was the part least likely to be read. */}
              <td className="py-0.5 ps-2 text-ink-500">
                {DIMENSION_HELP[row.dimension.toLowerCase()] ?? row.dimension}
              </td>
              <td className="py-0.5 ps-2 font-mono">{percent(row.score)}</td>
              <td className="py-0.5 ps-2 font-mono text-ink-500">×{row.weight.toFixed(2)}</td>
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

