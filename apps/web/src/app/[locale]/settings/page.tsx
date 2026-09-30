'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, AlertTriangle, RotateCcw, Database, Cpu, Wallet } from 'lucide-react';
import type { RecommendationWeights } from '@ilm/shared';
import { DEFAULT_WEIGHTS } from '@ilm/shared';
import { api, ApiError, type Health, type CorpusStats } from '@/lib/api';
import { Page, PageHeader } from '@/components/Shell';
import { useSettingsStore } from '@/store';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { getTextLabel, percent, TEXT_IDS } from '@/lib/utils';

const DIMENSIONS: Array<{ key: keyof RecommendationWeights; label: string; help: string }> = [
  { key: 'thematic', label: 'Thematic', help: 'Shared subject matter, from scored themes' },
  { key: 'linguistic', label: 'Linguistic', help: 'Shared vocabulary, roots, and cognate forms' },
  { key: 'narrative', label: 'Narrative', help: 'Same story, figures, events, or places' },
  { key: 'historical', label: 'Historical', help: 'Proximity in time, place, and textual lineage' },
  { key: 'theological', label: 'Theological', help: 'Shared doctrinal claims' },
];

const USER_ID = 'local';
type TextId = (typeof TEXT_IDS)[number];

export default function SettingsPage() {
  const t = useTranslations('nav');
  const { weights, setWeights, resetWeights } = useSettingsStore();

  const [health, setHealth] = useState<Health | null>(null);
  const [corpus, setCorpus] = useState<CorpusStats | null>(null);
  // Null means the count could not be obtained in time, which is the usual case
  // rather than an error — see the request above.
  const [embeddedCount, setEmbeddedCount] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    /*
     * Two separate requests rather than one Promise.all over a single corpus call.
     *
     * The corpus call that counts embedded passages is a full scan of 45,453 rows
     * holding vectors, and it takes 40 to 70 seconds. Nothing makes it faster: an
     * index on the predicate was built and measured, and the count still took 38
     * seconds, so the index went back out. The table is simply too large to scan
     * on request.
     *
     * So it is asked for separately and allowed to fail on its own. Folding it
     * into the one call that also carries coverage meant that when the scan
     * crossed the proxy's 30 second ceiling the whole page lost its corpus block —
     * text list, coverage warnings and all — because of a number in a diagnostics
     * panel.
     */
    Promise.all([api.health().catch(() => null), api.corpus().catch(() => null)])
      .then(([healthResult, corpusResult]) => {
        if (cancelled) return;
        setHealth(healthResult);
        setCorpus(corpusResult);
      })
      .catch(() => undefined);

    /*
     * Separate again, because this one usually will fail: it needs a scan no
     * index will serve. There is no cheap correct source for the number, and
     * maintaining a counter at ingest time is a real piece of work for a
     * diagnostics readout. Until that exists the panel says it is unavailable
     * rather than showing a zero, which would be a much worse lie.
     */
    void api
      .corpus({ includeEmbeddings: true })
      .then((result) => {
        if (!cancelled && result.embeddings.embedded !== null) setEmbeddedCount(result.embeddings.embedded);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const total = DIMENSIONS.reduce((sum, d) => sum + weights[d.key], 0);
  const normalized = total > 0 ? DIMENSIONS.map((d) => ({ ...d, value: weights[d.key] / total })) : DIMENSIONS.map((d) => ({ ...d, value: 0 }));

  const change = (key: keyof RecommendationWeights, value: number) => {
    setStatus('idle');
    setWeights({ [key]: value });
  };

  const save = async () => {
    setStatus('saving');
    setError(null);
    try {
      // Normalise before persisting: the API requires the five weights to sum to 1.
      const scaled = DIMENSIONS.reduce<RecommendationWeights>(
        (acc, d) => ({ ...acc, [d.key]: total > 0 ? weights[d.key] / total : 0 }),
        { ...DEFAULT_WEIGHTS }
      );
      await api.saveWeights(USER_ID, scaled);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (caught) {
      setStatus('error');
      setError(caught instanceof ApiError ? caught.message : 'Could not save your weights.');
    }
  };

  return (
    <Page wide>
      <PageHeader
        title="Settings"
        description="Recommendation weights decide how the five affinity dimensions combine. Because Jev scores are cached per pair, moving a slider re-ranks instantly without new model calls."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="card p-5">
          <h2 className="mb-1 text-sm font-medium">Recommendation weights</h2>
          <p className="mb-5 text-xs text-fg-muted">
            Total: <span className="font-mono">{total.toFixed(2)}</span> — normalised to 1.0 when ranking and when saved.
          </p>

          <ul className="space-y-5">
            {DIMENSIONS.map((dim) => {
              const share = normalized.find((n) => n.key === dim.key)?.value ?? 0;
              return (
                <li key={dim.key}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <label htmlFor={dim.key} className="text-sm font-medium">
                      {dim.label}
                    </label>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-fg-muted">
                      {weights[dim.key].toFixed(2)} → {percent(share)}
                    </span>
                  </div>
                  <input
                    id={dim.key}
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={weights[dim.key]}
                    onChange={(e) => change(dim.key, Number(e.target.value))}
                    className="w-full accent-[rgb(var(--accent))]"
                  />
                  <p className="mt-1 text-xs text-fg-faint">{dim.help}</p>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={status === 'saving'} className="btn btn-primary !py-1.5">
              {status === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {status === 'saved' ? <Check className="h-3.5 w-3.5" /> : null}
              {status === 'saved' ? 'Saved' : 'Save to this browser'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetWeights();
                setStatus('idle');
              }}
              className="btn btn-secondary !py-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
            {error ? <span className="text-xs text-red-700">{error}</span> : null}
          </div>
        </section>

        <div className="space-y-5">
          <section className="card p-4">
            <h2 className="mb-3 text-sm font-medium">Services</h2>
            <dl className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-fg-muted">API</dt>
                <dd>{health ? <span className="text-emerald-700">online</span> : <span className="text-fg-faint">unknown</span>}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-fg-muted">Jev (TypeSafe)</dt>
                <dd>
                  {health?.jev.configured ? (
                    <span className="text-emerald-700">configured</span>
                  ) : (
                    <span className="text-amber-700">local scoring</span>
                  )}
                </dd>
              </div>
              {corpus ? (
                <div className="flex items-center justify-between">
                  <dt className="text-fg-muted">Embeddings</dt>
                  <dd className="font-mono tabular-nums">
                    {corpus.embeddings.embedded?.toLocaleString() ?? '—'} / {corpus.embeddings.of.toLocaleString()}
                  </dd>
                </div>
              ) : null}
            </dl>
            {health && !health.jev.configured ? (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Add <code className="rounded bg-raised px-1">TYPESAFE_API_KEY</code> and restart to switch scoring from
                keyword overlap to semantic Jev judgments.
              </p>
            ) : null}
          </section>

          {corpus ? (
            <section className="card p-4">
              <h2 className="mb-2 text-sm font-medium">Corpus</h2>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-fg-muted">
                    <th className="pb-1 font-normal">Text</th>
                    <th className="pb-1 text-right font-normal">Books</th>
                    <th className="pb-1 text-right font-normal">Passages</th>
                  </tr>
                </thead>
                <tbody>
                  {TEXT_IDS.map((textId) => {
                    const row = corpus.texts.find((t) => t.textId === textId);
                    const missing = corpus?.search.unindexedTexts.includes(textId) ?? false;
                    return (
                      <tr key={textId} className="border-t border-line-soft">
                        <td className={`py-1.5 ${missing ? 'text-fg-faint line-through decoration-fg-faint/40' : ''}`}>
                          {getTextLabel(textId, true)}
                        </td>
                        <td className="py-1.5 text-right font-mono text-fg-muted">{row?.bookCount ?? 0}</td>
                        <td className="py-1.5 text-right font-mono text-fg-muted">
                          {(row?.passageCount ?? 0).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-fg-faint">{corpus.totals.passages.toLocaleString()} passages stored.</p>
            </section>
          ) : null}
        </div>
      </div>

      {/*
        What this deployment can and cannot do.
        Full width rather than a sidebar, because it is prose and prose in a narrow
        column reads as a wall of hyphenated fragments. Coverage is stated plainly
        because a partially indexed corpus that looks complete is the worst failure
        this app can have: a reader searches the New Testament, gets nothing, and
        concludes the texts do not address it — a claim about scripture, and false.
      */}
      {/*
          The legal pages, and the only route to them.

          They existed and nothing pointed at them. A privacy policy a reader cannot
          find is not published in any sense that matters — Play requires a public
          URL rather than a discoverable one, so the store listing would have passed
          while the app told nobody anything. Settings is where they belong: it is the
          one page a reader reaches deliberately, and these are pages a reader reaches
          deliberately or not at all.

          A foot of links rather than three in the sidebar, because a nav entry for a
          privacy policy is the fastest way to make it look like the place where
          privacy policy goes.
      */}
      <section className="mt-6 border-t border-line pt-4 dark:border-white/10">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link href="/privacy" className="text-fg-muted underline underline-offset-4 hover:text-fg">
            {t('privacy')}
          </Link>
          <Link href="/terms" className="text-fg-muted underline underline-offset-4 hover:text-fg">
            {t('terms')}
          </Link>
          <Link href="/contact" className="text-fg-muted underline underline-offset-4 hover:text-fg">
            {t('contact')}
          </Link>
        </div>
      </section>

      {corpus ? (
        <section className="mt-5">
          <h2 className="mb-3 text-sm font-medium">This deployment</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div
              className={`card p-4 ${corpus.search.partial ? 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20' : ''}`}
            >
              <h3 className="mb-2 flex items-center gap-2 text-xs font-medium">
                <Database className="h-3.5 w-3.5 text-fg-muted" /> Search coverage
              </h3>
              {corpus.search.partial ? (
                <p className="text-[11px] leading-relaxed text-fg-muted">
                  <span className="font-medium text-fg">
                    {corpus.search.passagesIndexed.toLocaleString()} of{' '}
                    {corpus.search.passagesTotal.toLocaleString()} passages are searchable.
                  </span>{' '}
                  The index is held in memory, and this instance cannot hold all five corpora — a one-property index over
                  the full corpus already needs 745 MB. The rest is stored and served normally; it just cannot be
                  full-text searched, and a search will not reach it.
                </p>
              ) : (
                <p className="text-[11px] leading-relaxed text-fg-muted">
                  All {corpus.search.passagesTotal.toLocaleString()} passages are searchable.
                </p>
              )}
              <ul className="mt-3 space-y-1">
                {corpus.search.indexedTexts.map((textId) => (
                  <li key={textId} className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-accent">{getTextLabel(textId as TextId, true)}</span>
                    <span className="text-fg-faint">searchable</span>
                  </li>
                ))}
                {corpus.search.unindexedTexts.map((textId) => (
                  <li key={textId} className="flex items-center justify-between text-[11px]">
                    <span className="text-fg-faint line-through decoration-fg-faint/40">
                      {getTextLabel(textId as TextId, true)}
                    </span>
                    <span className="text-fg-faint">not searchable</span>
                  </li>
                ))}
              </ul>
              {corpus.search.partial ? (
                <p className="mt-3 text-[11px] leading-relaxed text-fg-faint">
                  A setting, not a limitation of the data:{' '}
                  <code className="rounded bg-panel px-1">SEARCH_INDEX_TEXTS</code> chooses which texts are indexed, and{' '}
                  <code className="rounded bg-panel px-1">all</code> indexes everything on a larger instance.
                </p>
              ) : null}
            </div>

            <div className="card p-4">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-medium">
                <Wallet className="h-3.5 w-3.5 text-fg-muted" /> Model budget
              </h3>
              {health ? (
              <dl className="space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <dt className="text-fg-muted">Spent this process</dt>
                  <dd className="font-mono tabular-nums">${health.budget.spentUsd.toFixed(4)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-fg-muted">Ceiling</dt>
                  <dd className="font-mono tabular-nums">
                    {health.budget.limitUsd === null ? 'none' : `$${health.budget.limitUsd.toFixed(2)}`}
                  </dd>
                </div>
                {health.budget.refused > 0 ? (
                  <div className="flex items-center justify-between">
                    <dt className="text-fg-muted">Calls refused</dt>
                    <dd className="font-mono tabular-nums text-amber-700">{health.budget.refused}</dd>
                  </div>
                ) : null}
              </dl>
              ) : (
                <p className="text-[11px] text-fg-faint">No reading — the API is unreachable.</p>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-fg-faint">
                {health?.budget.exhausted
                  ? 'The cap is reached. Results are still returned, ranked by local rules and labelled as such, but no model is being called.'
                  : health?.budget.limitUsd === null
                    ? 'No cap is set. Results labelled “Ranked by meaning” were judged by the model rather than by keyword overlap.'
                    : 'Below the cap. Results labelled “Ranked by meaning” were judged by the model rather than by keyword overlap.'}
              </p>
            </div>

            <div className="card p-4">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-medium">
                <Cpu className="h-3.5 w-3.5 text-fg-muted" /> Embeddings
              </h3>
              <p className="text-[11px] leading-relaxed text-fg-muted">
                <span className="font-medium text-fg">
                  {embeddedCount !== null ? embeddedCount.toLocaleString() : '—'} of {corpus.embeddings.of.toLocaleString()}{' '}
                  passages
                </span>{' '}
                carry a local vector. These run on CPU and cost nothing, and they are what lets two passages from
                different traditions be compared without a model call.
                {embeddedCount === null ? (
                  <>
                    {' '}
                    The count is not shown because counting it means scanning every passage in the corpus, which
                    takes longer than a browser will wait. Nothing about the vectors is in doubt — only the total.
                  </>
                ) : null}
              </p>
              <p className="mt-3 text-[11px] text-fg-faint">
                {corpus.embeddings.provider
                  ? `Provider: ${corpus.embeddings.provider}${corpus.embeddings.model ? ` · ${corpus.embeddings.model}` : ''}`
                  : embeddedCount !== null && embeddedCount < corpus.embeddings.of
                    ? // Only a problem while passages are still missing. Once they are all
                      // embedded, the provider is irrelevant to reading them.
                      'No provider is configured here, so the remaining passages have to be embedded before comparisons can use vectors.'
                    : 'Generated offline; the vectors are stored, so no provider is needed to read them.'}
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </Page>
  );
}
