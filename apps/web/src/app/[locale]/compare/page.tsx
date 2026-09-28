'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { Scale, X, Loader2, AlertTriangle, Copy, Check as CheckIcon, Link2 } from 'lucide-react';
import type { Alignment, Passage } from '@ilm/shared';
import { api, ApiError, type ComparisonResult } from '@/lib/api';
import { Page, PageHeader, Empty } from '@/components/Shell';
import { useComparisonStore } from '@/store';
import { segmentByPhrases } from '@/lib/highlighter';
import { SourceBadge, SOURCE_SENTENCE } from '@/components/SourceBadge';
import { renderHighlightedText } from '@/lib/highlight';
import { cn, getTextChipClass, getTextDirection, getTextLabel, getScriptFont, percent, TEXT_STYLES } from '@/lib/utils';

function CompareInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { passageKeys, remove, clear } = useComparisonStore();

  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(true);
  const [syncScroll, setSyncScroll] = useState(false);

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

  const byId = useMemo(() => new Map((result?.passages ?? []).map((p) => [p.id, p])), [result]);
  const registerPanel = useSyncedScroll(syncScroll, result?.passages.length ?? 0);

  return (
    <Page wide>
      <PageHeader
        title="Side-by-side comparison"
        description="One column per text, every pair aligned in a single pass. Highlighted phrases are what two passages literally share; the type and score beside each link say whether a model or a local rule produced them."
        action={
          keys.length > 0 ? (
            <div className="flex flex-wrap gap-2">
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
          <Loader2 className="h-4 w-4 animate-spin" /> Aligning {keys.length} passages — {pairCount(keys.length)} pairs, one pass…
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
          <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-ink-500">
            <span>
              {result.metadata.textCount} corpora · {result.metadata.totalVerses} passages · {result.alignments.length} of{' '}
              {result.metadata.totalPairs} pairs linked
            </span>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} />
              Show original text
            </label>
            {result.passages.length > 1 ? (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={syncScroll} onChange={(e) => setSyncScroll(e.target.checked)} />
                Sync scrolling
              </label>
            ) : null}
            <ProvenanceLegend result={result} />
          </div>

          <div
            className={cn(
              'grid gap-4',
              // One column per passage rather than a fixed 2- or 3-up grid, which
              // is what makes five or eight corpora readable as a comparison.
              result.passages.length <= 2 && 'lg:grid-cols-2',
              result.passages.length === 3 && 'lg:grid-cols-3',
              result.passages.length >= 4 && 'md:grid-cols-2 xl:grid-cols-4'
            )}
          >
            {result.passages.map((passage, i) => (
              <Panel
                key={passage.id}
                passage={passage}
                alignments={result.alignments}
                showOriginal={showOriginal}
                scrollRef={registerPanel(i)}
                onRemove={sharedKeys.length === 0 ? () => remove(passage.passageKey) : undefined}
              />
            ))}
          </div>

          {result.alignments.length > 0 ? (
            <section className="mt-8">
              <h2 className="mb-2 text-sm font-semibold">Alignments</h2>
              <ul className="space-y-2">
                {result.alignments.map((alignment) => {
                  const key = `${alignment.passageAId}-${alignment.passageBId}`;
                  const a = byId.get(alignment.passageAId);
                  const b = byId.get(alignment.passageBId);
                  return (
                    <li key={key} className="rounded-lg border border-ink-200 p-3 text-sm dark:border-ink-800">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] dark:bg-ink-800">{alignment.type.replace(/_/g, ' ')}</span>
                        <span className="font-mono text-xs text-ink-500">{percent(alignment.strength)}</span>
                        <SourceBadge source={alignment.source} />
                        {alignment.notes ? <span className="text-xs text-ink-500">{alignment.notes}</span> : null}
                      </div>
                      <p className="text-xs text-ink-600 dark:text-ink-400">
                        {a ? `${a.book} ${a.chapter}:${a.verse}` : '?'} ↔ {b ? `${b.book} ${b.chapter}:${b.verse}` : '?'}
                      </p>
                      {alignment.matchedSegments.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {alignment.matchedSegments.slice(0, 4).map((segment, i) => (
                            <li key={i} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                              {/* Both sides of the match. Showing only textA hid the
                                  half of the evidence that proves the pair lines up.
                                  The server matches case-insensitively and returns the
                                  lowercased span, so the leading letter is restored
                                  for display. */}
                              <mark className="rounded bg-amber-200 px-1 dark:bg-amber-900/60">{sentenceCase(segment.textA)}</mark>
                              <span className="text-ink-400">≡</span>
                              <mark className="rounded bg-amber-200 px-1 dark:bg-amber-900/60">{sentenceCase(segment.textB)}</mark>
                            </li>
                          ))}
                          {alignment.matchedSegments.length > 4 ? (
                            <li className="text-xs text-ink-500">+{alignment.matchedSegments.length - 4} more</li>
                          ) : null}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-ink-500">No shared phrasing; the link is thematic.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <p className="mt-8 text-sm text-ink-500">
              No pair of these passages reached the threshold worth showing. They may simply be unrelated.
            </p>
          )}

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

          {result.crossReferences.length > 0 ? (
            <section className="mt-8">
              <h2 className="mb-2 text-sm font-semibold">Cross-references between these passages</h2>
              <ul className="space-y-1.5">
                {result.crossReferences.map((ref, i) => {
                  const a = byId.get(ref.sourcePassageId);
                  const b = byId.get(ref.targetPassageId);
                  return (
                    <li key={`${ref.sourcePassageId}-${ref.targetPassageId}-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
                      <Link2 className="h-3 w-3 text-ink-400" />
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] dark:bg-ink-800">{ref.type}</span>
                      <span className="font-mono text-ink-500">{percent(ref.strength)}</span>
                      <span className="text-ink-600 dark:text-ink-400">
                        {a ? `${a.book} ${a.chapter}:${a.verse}` : '?'} → {b ? `${b.book} ${b.chapter}:${b.verse}` : '?'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}

/** How many pairs a comparison of n passages forms. Shown while it runs. */
function pairCount(n: number): number {
  return (n * (n - 1)) / 2;
}

/** Uppercase the first character, leaving the rest of the matched span alone. */
function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Which judge produced the links, stated once.
 *
 * A cached pair is reported as derived because the stored row does not record its
 * origin, so this has to distinguish "no model key" from "answered from a previous
 * run" — claiming the wrong one would be a false statement about the evidence.
 */
function ProvenanceLegend({ result }: { result: ComparisonResult }) {
  const { alignments, metadata } = result;
  const judged = alignments.filter((a) => a.source !== 'derived').length;
  const jev = alignments.filter((a) => a.source === 'jev').length;
  const local = alignments.filter((a) => a.source === 'local').length;

  if (judged === 0) {
    return <span className="text-ink-500">{SOURCE_SENTENCE.derived}.</span>;
  }
  if (metadata.cachedPairs > 0 && jev === 0 && local === 0) {
    return <span className="text-ink-500">{metadata.cachedPairs} pairs from the comparison cache.</span>;
  }
  if (jev === 0) {
    return (
      <span className="text-ink-500">
        {metadata.cachedPairs} pair{metadata.cachedPairs === 1 ? '' : 's'} from the comparison cache
        {metadata.cachedPairs > 0 ? ', rest by local scoring' : ''}.
      </span>
    );
  }
  if (jev < alignments.length) {
    return (
      <span className="text-ink-500">
        {jev} of {alignments.length} links from Jev
        {metadata.cachedPairs > 0 ? `, ${metadata.cachedPairs} from cache` : ''}, the rest from local scoring.
      </span>
    );
  }
  return <span className="text-ink-500">All {alignments.length} links from Jev.</span>;
}

/**
 * Keeps every panel scrolled to the same fraction of its own height.
 *
 * The panels are different lengths — a Quran verse and a psalm are not the same
 * amount of text — so this syncs by proportion rather than by pixels, which is the
 * only mapping that does not drift by the bottom of the column.
 *
 * Listeners are attached once per set of panels and read `syncRef` on each event,
 * so toggling the checkbox does not tear down and rebuild them mid-gesture.
 */
function useSyncedScroll(enabled: boolean, panelCount: number) {
  const nodes = useRef<Array<HTMLDivElement | null>>([]);
  const syncRef = useRef(enabled);

  useEffect(() => {
    syncRef.current = enabled;
  }, [enabled]);

  // A ref the lock guards: setting scrollTop fires another scroll event, which
  // would otherwise bounce the panels back and forth.
  const locked = useRef(false);

  useEffect(() => {
    const onScroll = (event: Event) => {
      if (!syncRef.current || locked.current) return;
      const source = event.currentTarget as HTMLDivElement;
      const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);

      locked.current = true;
      for (const node of nodes.current) {
        if (!node || node === source) continue;
        node.scrollTop = ratio * Math.max(0, node.scrollHeight - node.clientHeight);
      }
      requestAnimationFrame(() => {
        locked.current = false;
      });
    };

    const registered = nodes.current.filter((n): n is HTMLDivElement => Boolean(n));
    for (const node of registered) node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      for (const node of registered) node.removeEventListener('scroll', onScroll);
    };
  }, [panelCount]);

  return (index: number) => (node: HTMLDivElement | null) => {
    nodes.current[index] = node;
  };
}

function Panel({
  passage,
  alignments,
  showOriginal,
  scrollRef,
  onRemove,
}: {
  passage: Passage;
  alignments: Alignment[];
  showOriginal: boolean;
  scrollRef: (node: HTMLDivElement | null) => void;
  onRemove?: () => void;
}) {
  const direction = getTextDirection(passage.textId);
  const phrases = useMemo(() => collectPhrases(alignments, passage.id), [alignments, passage.id]);
  const segments = useMemo(() => segmentByPhrases(passage.translation, phrases), [passage.translation, phrases]);
  const links = useMemo(() => alignments.filter((a) => a.passageAId === passage.id || a.passageBId === passage.id), [alignments, passage.id]);

  return (
    <article
      className={cn(
        // No `comparison-panel` class: that leftover in globals.css is emitted after
        // the utilities layer and resets border-width to 1px, which silently undid
        // both the 4px frame and the per-corpus accent below.
        'flex max-h-[70vh] flex-col overflow-hidden rounded-xl border-4 border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900',
        TEXT_STYLES[passage.textId].border
      )}
      data-panel={passage.id}
    >
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {showOriginal && passage.originalText ? (
          <p dir={direction} className={cn('mb-3 border-b border-ink-100 pb-3 text-ink-700 dark:border-ink-800 dark:text-ink-300', getScriptFont(passage.metadata.language))}>
            {passage.originalText}
          </p>
        ) : null}
        {/* The tested segmenter, with the alignment id and type each mark came
            from, instead of the inline regex this page used to carry. */}
        <p className="text-sm leading-relaxed text-ink-800 dark:text-ink-200">{renderHighlightedText(passage.translation, segments)}</p>

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

      {links.length > 0 ? (
        <footer className="border-t border-ink-200 px-3 py-2 text-[11px] text-ink-500 dark:border-ink-800">
          {links.length} link{links.length === 1 ? '' : 's'} to the other columns
        </footer>
      ) : null}
    </article>
  );
}

/**
 * Phrases this passage shares with any other, each tagged with the alignment it
 * came from so a mark can say which pair it is evidence for.
 */
function collectPhrases(alignments: Alignment[], passageId: string): Array<{ phrase: string; alignmentId: string; type: string }> {
  const found = new Map<string, { phrase: string; alignmentId: string; type: string }>();
  for (const alignment of alignments) {
    const isA = alignment.passageAId === passageId;
    const alignmentId = `${alignment.passageAId}-${alignment.passageBId}`;
    for (const segment of alignment.matchedSegments) {
      const text = (isA ? segment.textA : segment.textB).trim();
      if (text.length < 4) continue;
      const key = text.toLowerCase();
      if (!found.has(key)) found.set(key, { phrase: text, alignmentId, type: alignment.type });
    }
  }
  return [...found.values()];
}

export default function ComparePage() {
  return (
    <Suspense fallback={<Page><p className="py-12 text-sm text-ink-500">Loading comparison…</p></Page>}>
      <CompareInner />
    </Suspense>
  );
}
