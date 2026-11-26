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
  const ts = useTranslations('settings');
  const { weights, setWeights, resetWeights } = useSettingsStore();

  const [health, setHealth] = useState<Health | null>(null);
  const [corpus, setCorpus] = useState<CorpusStats | null>(null);
  const [embeddedCount, setEmbeddedCount] = useState<number | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  /*
   * Nothing here is needed to change a preference. The corpus call that counts
   * vectors scans ~45,000 rows and takes 40-70 seconds, so all of it waits for
   * the reader to open Diagnostics. A newcomer sent here from a passage gets
   * five sliders and no dashboard.
   */
  useEffect(() => {
    if (!diagnosticsOpen) return;
    let cancelled = false;

    Promise.all([api.health().catch(() => null), api.corpus().catch(() => null)])
      .then(([healthResult, corpusResult]) => {
        if (cancelled) return;
        setHealth(healthResult);
        setCorpus(corpusResult);
      })
      .catch(() => undefined);

    // The vector count usually fails on the proxy timeout. It is allowed to
    // fail on its own rather than taking the coverage block down with it.
    void api
      .corpus({ includeEmbeddings: true })
      .then((result) => {
        if (!cancelled && result.embeddings.embedded !== null) setEmbeddedCount(result.embeddings.embedded);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [diagnosticsOpen]);

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
      <PageHeader title={ts('title')} description={ts('intro')} />

      <section className="card max-w-3xl p-5">
        <h2 className="mb-1 text-sm font-medium">{ts('weightsTitle')}</h2>
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

      {/*
          Diagnostics is deliberately behind a disclosure. Its tables answer a
          different question from the sliders, and the vector count can take a
          minute of scanning — a cost no one should pay just to change a weight.
      */}
      <details className="group mt-6" onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-medium text-accent underline underline-offset-4">
          {ts('diagnosticsTitle')}
        </summary>
        <p className="mt-2 max-w-[68ch] text-xs text-fg-muted">{ts('diagnosticsIntro')}</p>

        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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
                  This deployment scores by local rules rather than a model. Every score and verdict is
                  labelled with the source that produced it, so nothing here is presented as a model
                  judgement when it is not.
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
                      const row = corpus.texts.find((item) => item.textId === textId);
                      const missing = corpus.search.unindexedTexts.includes(textId) ?? false;
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
                    The index is held in memory, and this instance cannot hold all the corpora — a one-property index
                    over the full corpus already needs 745 MB. The rest is stored and served normally; it just cannot be
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
                    <div className="flex items-center justify-between">
                      <dt className="text-fg-muted">Jev round-trips</dt>
                      <dd className="font-mono tabular-nums">
                        {health.jev.latency && health.jev.latency.calls > 0
                          ? `${health.jev.latency.calls} · ${health.jev.latency.avgMs}/${health.jev.latency.lastMs}/${health.jev.latency.maxMs} ms`
                          : 'none'}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-[11px] text-fg-faint">No reading — the API is unreachable.</p>
                )}
                <p className="mt-2 text-[10px] text-fg-faint">
                  Round-trips · average / last / maximum ms, for this process only.
                </p>
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
                      The count is not shown because counting it means scanning every passage in the corpus, which takes
                      longer than a browser will wait. Nothing about the vectors is in doubt — only the total.
                    </>
                  ) : null}
                </p>
                <p className="mt-3 text-[11px] text-fg-faint">
                  {corpus.embeddings.provider
                    ? `Provider: ${corpus.embeddings.provider}${corpus.embeddings.model ? ` · ${corpus.embeddings.model}` : ''}`
                    : embeddedCount !== null && embeddedCount < corpus.embeddings.of
                      ? 'No provider is configured here, so the remaining passages have to be embedded before comparisons can use vectors.'
                      : 'Generated offline; the vectors are stored, so no provider is needed to read them.'}
                </p>
              </div>
            </div>
          </section>
        ) : null}
      </details>

      {/*
          The legal pages, and the only route to them. Settings is where they
          belong: the one page a reader reaches deliberately, as are these.
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
          <Link href="/support" className="text-fg-muted underline underline-offset-4 hover:text-fg">
            {t('support')}
          </Link>
        </div>
      </section>
    </Page>
  );
}
