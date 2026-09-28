'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, AlertTriangle, RotateCcw } from 'lucide-react';
import type { RecommendationWeights } from '@ilm/shared';
import { DEFAULT_WEIGHTS } from '@ilm/shared';
import { api, ApiError, type Health, type CorpusStats } from '@/lib/api';
import { Page, PageHeader } from '@/components/Shell';
import { useSettingsStore } from '@/store';
import { getTextLabel, percent, TEXT_IDS } from '@/lib/utils';

const DIMENSIONS: Array<{ key: keyof RecommendationWeights; label: string; help: string }> = [
  { key: 'thematic', label: 'Thematic', help: 'Shared subject matter, from scored themes' },
  { key: 'linguistic', label: 'Linguistic', help: 'Shared vocabulary, roots, and cognate forms' },
  { key: 'narrative', label: 'Narrative', help: 'Same story, figures, events, or places' },
  { key: 'historical', label: 'Historical', help: 'Proximity in time, place, and textual lineage' },
  { key: 'theological', label: 'Theological', help: 'Shared doctrinal claims' },
];

const USER_ID = 'local';

export default function SettingsPage() {
  const { weights, setWeights, resetWeights } = useSettingsStore();

  const [health, setHealth] = useState<Health | null>(null);
  const [corpus, setCorpus] = useState<CorpusStats | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([api.health().catch(() => null), api.corpus().catch(() => null)])
      .then(([healthResult, corpusResult]) => {
        if (cancelled) return;
        setHealth(healthResult);
        setCorpus(corpusResult);
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
    <Page>
      <PageHeader
        title="Settings"
        description="Recommendation weights decide how the five affinity dimensions combine. Because Jev scores are cached per pair, moving a slider re-ranks instantly without new model calls."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
          <h2 className="mb-1 text-sm font-semibold">Recommendation weights</h2>
          <p className="mb-4 text-xs text-ink-500">
            Total: <span className="font-mono">{total.toFixed(2)}</span> — normalised to 1.0 when ranking and when saved.
          </p>

          <ul className="space-y-4">
            {DIMENSIONS.map((dim) => {
              const share = normalized.find((n) => n.key === dim.key)?.value ?? 0;
              return (
                <li key={dim.key}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <label htmlFor={dim.key} className="text-sm font-medium">
                      {dim.label}
                    </label>
                    <span className="font-mono text-xs text-ink-500">
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
                    className="w-full accent-emerald-700"
                  />
                  <p className="text-xs text-ink-500">{dim.help}</p>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={status === 'saving'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-50 dark:bg-emerald-700"
            >
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-300 px-3 py-1.5 text-sm hover:border-ink-500 dark:border-ink-700"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
            {error ? <span className="text-xs text-red-700 dark:text-red-300">{error}</span> : null}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
            <h2 className="mb-2 text-sm font-semibold">Services</h2>
            <dl className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-ink-500">API</dt>
                <dd>{health ? <span className="text-emerald-700 dark:text-emerald-400">online</span> : <span className="text-ink-500">unknown</span>}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-500">Search index</dt>
                <dd className="font-mono">
                  {health ? `${health.search.passagesIndexed.toLocaleString()} passages` : '—'}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-ink-500">Jev (TypeSafe)</dt>
                <dd className="text-right">
                  {health?.jev.configured ? (
                    <span className="text-emerald-700 dark:text-emerald-400">configured</span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">local scoring</span>
                  )}
                  {health && !health.jev.configured ? (
                    <span className="mt-0.5 block text-[10px] text-ink-500">{health.jev.reason}</span>
                  ) : null}
                </dd>
              </div>
            </dl>
            {health && !health.jev.configured ? (
              <p className="mt-3 flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Add <code>TYPESAFE_API_KEY</code> to <code>apps/api/.env</code> and restart to switch scoring from keyword overlap to
                semantic Jev judgments.
              </p>
            ) : null}
          </section>

          {corpus ? (
            <section className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
              <h2 className="mb-2 text-sm font-semibold">Corpus</h2>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-ink-500">
                    <th className="pb-1 font-normal">Text</th>
                    <th className="pb-1 text-right font-normal">Books</th>
                    <th className="pb-1 text-right font-normal">Passages</th>
                  </tr>
                </thead>
                <tbody>
                  {TEXT_IDS.map((textId) => {
                    const row = corpus.texts.find((t) => t.textId === textId);
                    return (
                      <tr key={textId} className="border-t border-ink-100 dark:border-ink-800">
                        <td className="py-1">{getTextLabel(textId, true)}</td>
                        <td className="py-1 text-right font-mono">{row?.bookCount ?? 0}</td>
                        <td className="py-1 text-right font-mono">{(row?.passageCount ?? 0).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-ink-500">{corpus.totals.passages.toLocaleString()} passages total.</p>
            </section>
          ) : null}
        </aside>
      </div>
    </Page>
  );
}
