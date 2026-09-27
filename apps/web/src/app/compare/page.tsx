'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Scale, X, Loader2, AlertTriangle, Copy, Check as CheckIcon } from 'lucide-react';
import type { Alignment, Passage } from '@ilm/shared';
import { api, ApiError, type ComparisonResult } from '@/lib/api';
import { Shell, PageHeader, Empty } from '@/components/Shell';
import { useComparisonStore } from '@/store';
import { cn, getTextChipClass, getTextDirection, getTextLabel, getScriptFont, percent, TEXT_IDS, TEXT_STYLES } from '@/lib/utils';

function CompareInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { passageKeys, remove, clear } = useComparisonStore();

  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(true);

  // ?keys=a,b is a shareable link and takes precedence over the local tray.
  const sharedKeys = useMemo(() => (params.get('keys') ?? '').split(',').filter(Boolean), [params]);
  const keys = sharedKeys.length > 0 ? sharedKeys : passageKeys;

  const runCompare = useCallback(async (target: string[]) => {
    if (target.length < 2) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResult(await api.compare(target));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Comparison failed.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runCompare(keys);
  }, [keys, runCompare]);

  const shareUrl = useMemo(() => (typeof window === 'undefined' ? '' : `${window.location.origin}/compare?keys=${keys.map(encodeURIComponent).join(',')}`), [keys]);

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to the clipboard.');
    }
  };

  return (
    <Shell>
      <PageHeader
        title="Side-by-side comparison"
        description="Two to five passages, aligned pairwise. Highlighted phrases are what the passages actually share; the score and type come from Jev."
        action={
          keys.length > 0 ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => void copyShare()} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-300 px-3 py-1.5 text-sm hover:border-ink-500 dark:border-ink-700">
                {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
              {sharedKeys.length === 0 ? (
                <button type="button" onClick={clear} className="rounded-lg border border-ink-300 px-3 py-1.5 text-sm hover:border-ink-500 dark:border-ink-700">
                  Clear
                </button>
              ) : null}
            </div>
          ) : undefined
        }
      />

      {sharedKeys.length === 0 && passageKeys.length > 0 ? (
        <ul className="mb-4 flex flex-wrap gap-2">
          {passageKeys.map((key) => (
            <li key={key} className="inline-flex items-center gap-1 rounded-full border border-ink-300 py-0.5 pl-2.5 pr-1 text-xs dark:border-ink-700">
              <span className="font-mono">{key}</span>
              <button type="button" onClick={() => remove(key)} aria-label={`Remove ${key}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-ink-200 dark:hover:bg-ink-700">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 py-16 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Aligning passages…
        </p>
      ) : null}

      {!loading && keys.length < 2 ? (
        <Empty icon={Scale} title="Pick at least two passages">
          Search for a theme, then use the{' '}
          <span className="mx-1 inline-flex items-center gap-1 rounded border border-ink-300 px-1.5 py-0.5 text-xs dark:border-ink-700">
            <Scale className="h-3 w-3" />
          </span>{' '}
          button on any result to add it to the comparison tray.
          <div className="mt-4">
            <button type="button" onClick={() => router.push('/')} className="underline">
              Go to search
            </button>
          </div>
        </Empty>
      ) : null}

      {result ? (
        <>
          <div className="mb-4 flex items-center gap-4 text-xs text-ink-500">
            <span>
              {result.metadata.textCount} corpora · {result.metadata.totalVerses} passages · {result.alignments.length} alignment
              {result.alignments.length === 1 ? '' : 's'}
            </span>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} />
              Show original text
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {result.passages.map((passage) => (
              <Panel
                key={passage.id}
                passage={passage}
                alignments={result.alignments}
                showOriginal={showOriginal}
                onRemove={sharedKeys.length === 0 ? () => remove(passage.passageKey) : undefined}
              />
            ))}
          </div>

          {result.alignments.length > 0 ? (
            <section className="mt-8">
              <h2 className="mb-2 text-sm font-semibold">Alignments</h2>
              <ul className="space-y-2">
                {result.alignments.map((alignment) => {
                  const a = result.passages.find((p) => p.id === alignment.passageAId);
                  const b = result.passages.find((p) => p.id === alignment.passageBId);
                  return (
                    <li key={`${alignment.passageAId}-${alignment.passageBId}`} className="rounded-lg border border-ink-200 p-3 text-sm dark:border-ink-800">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] dark:bg-ink-800">{alignment.type.replace(/_/g, ' ')}</span>
                        <span className="font-mono text-xs text-ink-500">{percent(alignment.strength)}</span>
                        {alignment.notes ? <span className="text-xs text-ink-500">{alignment.notes}</span> : null}
                      </div>
                      <p className="text-xs text-ink-600 dark:text-ink-400">
                        {a ? `${a.book} ${a.chapter}:${a.verse}` : '?'} ↔ {b ? `${b.book} ${b.chapter}:${b.verse}` : '?'}
                      </p>
                      {alignment.matchedSegments.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {alignment.matchedSegments.slice(0, 4).map((segment, i) => (
                            <li key={i} className="text-xs">
                              <mark className="rounded bg-amber-200 px-1 dark:bg-amber-900/60">{segment.textA}</mark>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-ink-500">No shared phrasing; the link is thematic.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {result.sharedThemes.length > 0 ? (
            <section className="mt-8">
              <h2 className="mb-2 text-sm font-semibold">Shared themes</h2>
              <ul className="flex flex-wrap gap-1.5">
                {result.sharedThemes.map((shared) => (
                  <li key={shared.theme} className="rounded-full bg-ink-100 px-2.5 py-1 text-xs dark:bg-ink-800">
                    {shared.theme.replace(/_/g, ' ')}{' '}
                    <span className="font-mono text-ink-500">{percent(shared.avgScore)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}

function Panel({ passage, alignments, showOriginal, onRemove }: { passage: Passage; alignments: Alignment[]; showOriginal: boolean; onRemove?: () => void }) {
  const direction = getTextDirection(passage.textId);
  const phrases = collectPhrases(alignments, passage.id);

  return (
    <article className={cn('flex flex-col rounded-xl border-4 border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900', TEXT_STYLES[passage.textId].border)}>
      <header className="flex items-center gap-2 border-b border-ink-200 p-3 dark:border-ink-800">
        <span className={getTextChipClass(passage.textId)}>{getTextLabel(passage.textId, true)}</span>
        <a href={`/passage/${passage.passageKey.split('/').map(encodeURIComponent).join('/')}`} className="truncate text-sm font-medium hover:underline">
          {passage.book} {passage.chapter}:{passage.verse}
        </a>
        {onRemove ? (
          <button type="button" onClick={onRemove} aria-label="Remove from comparison" className="ml-auto grid h-6 w-6 place-items-center rounded hover:bg-ink-100 dark:hover:bg-ink-800">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </header>

      <div className="flex-1 p-3">
        {showOriginal && passage.originalText ? (
          <p dir={direction} className={cn('mb-3 border-b border-ink-100 pb-3 text-ink-700 dark:border-ink-800 dark:text-ink-300', getScriptFont(passage.metadata.language))}>
            {passage.originalText}
          </p>
        ) : null}
        <p className="text-sm leading-relaxed text-ink-800 dark:text-ink-200">{highlight(passage.translation, phrases)}</p>

        {passage.themes.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1">
            {passage.themes.slice(0, 4).map((theme) => (
              <li key={theme.theme} className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-700 dark:bg-ink-800 dark:text-ink-300">
                {theme.theme}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

function collectPhrases(alignments: Alignment[], passageId: string): string[] {
  const phrases = new Set<string>();
  for (const alignment of alignments) {
    const isA = alignment.passageAId === passageId;
    for (const segment of alignment.matchedSegments) {
      const text = (isA ? segment.textA : segment.textB).trim();
      if (text.length >= 4) phrases.add(text);
    }
  }
  return [...phrases].sort((a, b) => b.length - a.length);
}

function highlight(text: string, phrases: string[]) {
  if (phrases.length === 0) return text;

  const escaped = phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'));

  return (
    <>
      {parts.map((part, i) =>
        phrases.some((p) => p.toLowerCase() === part.toLowerCase()) ? (
          <mark key={i} className="rounded bg-amber-200 px-0.5 dark:bg-amber-900/60">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<Shell><p className="py-12 text-sm text-ink-500">Loading comparison…</p></Shell>}>
      <CompareInner />
    </Suspense>
  );
}
