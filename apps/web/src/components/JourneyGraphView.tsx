'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, PenLine, Play, Plus } from 'lucide-react';
import type { JourneyEdgeKind, JourneyGraph } from '@ilm/shared';
import { layoutJourney, neighbourKeys, describeEdge } from '@/lib/journey-layout';
import { getTextLabel, cn } from '@/lib/utils';
import { passageReference } from '@/lib/passage-ref';
import { ReadAloud } from '@/components/ReadAloud';

const EDGE_KINDS: JourneyEdgeKind[] = ['quotation', 'allusion', 'alignment', 'shared-theme'];

/**
 * The journey, drawn.
 *
 * Nodes are the passages the reader chose, in the order they chose them, on a
 * ring. The lines between them are relations this app detected — a quotation
 * because something found a quotation — and each family is drawn differently so
 * a line never means only "something".
 */
export function JourneyGraphView({
  graph,
  activePlayingKey,
  onAddSuggested,
  onSaveNote,
  onPlayFromNode,
}: {
  graph: JourneyGraph;
  activePlayingKey?: string | null;
  onAddSuggested?: (passageKey: string) => Promise<void>;
  onSaveNote?: (passageKey: string, note: string | null) => Promise<void>;
  onPlayFromNode?: (passageKey: string) => void;
}) {
  const t = useTranslations('journeys');
  const [active, setActive] = useState<string | null>(graph.nodes[0]?.passageKey ?? null);
  const [edgeFilter, setEdgeFilter] = useState<JourneyEdgeKind | 'all'>('all');
  const [highlightedEdge, setHighlightedEdge] = useState<string | null>(null);
  const [addingSuggested, setAddingSuggested] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const visibleEdges = useMemo(
    () => (edgeFilter === 'all' ? graph.edges : graph.edges.filter((e) => e.kind === edgeFilter)),
    [graph.edges, edgeFilter]
  );

  const layout = useMemo(
    () => layoutJourney({ nodes: graph.nodes, edges: visibleEdges }),
    [graph.nodes, visibleEdges]
  );
  const byKey = useMemo(() => new Map(graph.nodes.map((n) => [n.passageKey, n] as const)), [graph.nodes]);

  const labelFor = useCallback(
    (key: string) => layout.nodes.find((n) => n.passageKey === key)?.label ?? passageReference(key),
    [layout.nodes]
  );

  const focusNode = useCallback((passageKey: string) => {
    setActive(passageKey);
    setEditingNote(false);
    const el = svgRef.current?.querySelector<SVGGElement>(`[data-node="${cssEscape(passageKey)}"]`);
    el?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGGElement>, passageKey: string) => {
      const step =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;
      if (step === 0) {
        if (event.key === 'Home') {
          event.preventDefault();
          const first = layout.nodes[0]?.passageKey;
          if (first) focusNode(first);
        }
        return;
      }
      event.preventDefault();
      const next = neighbourKeys(layout, passageKey, step as 1 | -1);
      if (next) focusNode(next);
    },
    [layout, focusNode]
  );

  const highlightedPair = useMemo(() => {
    if (!highlightedEdge) return null;
    const found = visibleEdges.find((e) => `${e.from}->${e.to}:${e.kind}` === highlightedEdge);
    return found ? new Set([found.from, found.to]) : null;
  }, [highlightedEdge, visibleEdges]);

  const edgeCounts = useMemo(() => {
    const counts: Record<JourneyEdgeKind, number> = {
      quotation: 0,
      allusion: 0,
      alignment: 0,
      'shared-theme': 0,
    };
    for (const e of graph.edges) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    return counts;
  }, [graph.edges]);

  const activeNode = active ? byKey.get(active) ?? graph.nodes[0] : graph.nodes[0];
  const corpora = new Set(graph.nodes.filter((n) => !n.missing).map((n) => n.textId));

  const handleAddSuggestion = async (key: string) => {
    if (!onAddSuggested) return;
    setAddingSuggested(key);
    try {
      await onAddSuggested(key);
    } finally {
      setAddingSuggested(null);
    }
  };

  const handleSaveInlineNote = async () => {
    if (!onSaveNote || !activeNode) return;
    setSavingNote(true);
    try {
      await onSaveNote(activeNode.passageKey, draftNote.trim() || null);
      setEditingNote(false);
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div>
        {graph.edges.length > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={t('filterRelationsLabel')}>
            <button
              type="button"
              onClick={() => {
                setEdgeFilter('all');
                setHighlightedEdge(null);
              }}
              aria-pressed={edgeFilter === 'all'}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                edgeFilter === 'all' ? 'bg-accent text-accent-fg' : 'bg-panel text-fg-muted hover:text-fg'
              )}
            >
              {t('filterAll')} ({graph.edges.length})
            </button>
            {EDGE_KINDS.filter((k) => edgeCounts[k] > 0).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  setEdgeFilter(edgeFilter === kind ? 'all' : kind);
                  setHighlightedEdge(null);
                }}
                aria-pressed={edgeFilter === kind}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                  edgeFilter === kind ? 'bg-accent text-accent-fg' : 'bg-panel text-fg-muted hover:text-fg'
                )}
              >
                {describeEdge({ kind }, t)} ({edgeCounts[kind]})
              </button>
            ))}
          </div>
        ) : null}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="w-full max-w-[40rem] select-none"
          role="img"
          aria-label={t('graphLabel', { count: graph.nodes.length })}
        >
          <title>{t('graphLabel', { count: graph.nodes.length })}</title>

          <g aria-hidden="true">
            {layout.edges.map((e) => {
              const id = `${e.from}->${e.to}:${e.kind}`;
              const isHighlighted = highlightedEdge === id;
              const isDimmed = highlightedEdge !== null && !isHighlighted;
              return (
                <path
                  key={id}
                  d={e.path}
                  fill="none"
                  className={EDGE_COLOUR[e.kind]}
                  strokeWidth={isHighlighted ? e.width + 1.5 : e.width}
                  strokeOpacity={isDimmed ? 0.1 : isHighlighted ? 0.95 : 0.25 + e.strength * 0.55}
                  strokeLinecap="round"
                  {...(e.dash ? { strokeDasharray: e.dash } : {})}
                />
              );
            })}
          </g>

          {layout.nodes.map((n) => {
            const isActive = activeNode?.passageKey === n.passageKey;
            const isPlaying = activePlayingKey === n.passageKey;
            const isLinked = highlightedPair?.has(n.passageKey) ?? false;
            const isDimmed = highlightedPair !== null && !isLinked;
            return (
              <g
                key={n.passageKey}
                data-node={n.passageKey}
                tabIndex={0}
                role="button"
                aria-pressed={isActive}
                aria-label={t('nodeLabel', {
                  order: n.index + 1,
                  of: graph.nodes.length,
                  corpus: getTextLabel(n.textId as never),
                  reference: n.label,
                })}
                onClick={() => {
                  setActive(n.passageKey);
                  setEditingNote(false);
                }}
                onKeyDown={(e) => onKeyDown(e, n.passageKey)}
                className="cursor-pointer outline-none focus-visible:opacity-100"
                opacity={isDimmed ? 0.35 : n.missing ? 0.55 : 1}
              >
                {isActive || isPlaying || isLinked ? (
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r + 5}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={isPlaying ? 2 : 1.5}
                    opacity={isPlaying ? 0.9 : 0.55}
                  />
                ) : null}
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  className={n.missing ? 'fill-bg' : 'fill-panel'}
                  {...(n.missing ? {} : { stroke: EDGE_CORPUS[n.textId] ?? 'stroke-line' })}
                  strokeWidth={2}
                  strokeDasharray={n.missing ? '3 3' : undefined}
                />
                <text
                  x={n.x}
                  y={n.y + 4}
                  textAnchor="middle"
                  className="pointer-events-none fill-current text-[11px] font-medium"
                >
                  {n.index + 1}
                </text>
                <text x={n.x} y={n.y + n.r + 15} textAnchor="middle" className="pointer-events-none fill-current text-[11px] opacity-70">
                  {n.label}
                </text>
                {n.note ? <circle cx={n.x + n.r - 2} cy={n.y - n.r + 2} r={3.5} className="pointer-events-none fill-accent" /> : null}
              </g>
            );
          })}
        </svg>

        <section aria-labelledby="journey-order-heading" className="mt-6">
          <h2 id="journey-order-heading" className="text-sm font-medium text-fg-muted">
            {t('orderHeading')}
          </h2>
          <ol className="mt-2 space-y-1.5">
            {layout.nodes.map((laid) => {
              const passage = byKey.get(laid.passageKey);
              const isActive = activeNode?.passageKey === laid.passageKey;
              const isPlaying = activePlayingKey === laid.passageKey;
              return (
                <li key={laid.passageKey}>
                  <button
                    type="button"
                    onClick={() => focusNode(laid.passageKey)}
                    aria-pressed={isActive}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-start text-sm transition-colors',
                      isActive || isPlaying ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-panel'
                    )}
                  >
                    <span className="mt-px w-5 shrink-0 text-center font-mono text-xs text-fg-faint tabular-nums">
                      {laid.index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block">
                        <span className="font-medium">{laid.label}</span>
                        <span className="ms-2 text-xs text-fg-muted">{getTextLabel(laid.textId as never)}</span>
                        {laid.missing ? (
                          <span className="ms-2 text-xs text-red-700 dark:text-red-300">{t('missing')}</span>
                        ) : null}
                      </span>
                      {passage?.preview ? (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted">{passage.preview}</span>
                      ) : null}
                      {laid.note ? <span className="mt-1 block text-xs italic text-fg-muted">{laid.note}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <aside className="space-y-5">
        {activeNode ? (
          <section className="rounded-xl border border-line bg-panel/40 p-4" aria-live="polite">
            <h2 className="text-sm font-semibold">
              {labelFor(activeNode.passageKey)}
              <span className="ms-2 text-xs font-normal text-fg-muted">{getTextLabel(activeNode.textId as never)}</span>
            </h2>
            {activeNode.originalText ? (
              <p dir="auto" className="mt-2 text-lg leading-loose text-fg">
                {activeNode.originalText}
              </p>
            ) : null}
            {activeNode.preview ? <p className="mt-2 text-sm leading-relaxed">{activeNode.preview}</p> : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {onPlayFromNode && activeNode.preview ? (
                <button
                  type="button"
                  onClick={() => onPlayFromNode(activeNode.passageKey)}
                  className="btn btn-secondary px-2.5 py-1.5 text-xs"
                >
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
                  {t('playFromHere')}
                </button>
              ) : activeNode.preview ? (
                <ReadAloud text={activeNode.preview} textId={activeNode.textId} compact />
              ) : null}

              {onSaveNote ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingNote((v) => !v);
                    setDraftNote(activeNode.note ?? '');
                  }}
                  className="btn btn-secondary px-2.5 py-1.5 text-xs"
                >
                  <PenLine className="h-3.5 w-3.5" aria-hidden />
                  {activeNode.note ? t('editNote') : t('note')}
                </button>
              ) : null}

              {!activeNode.missing ? (
                <Link
                  href={`/passage/${activeNode.passageKey.split(':').map(encodeURIComponent).join('/')}`}
                  className="btn btn-secondary px-2.5 py-1.5 text-xs"
                >
                  {t('openPassage')}
                </Link>
              ) : null}
            </div>

            {activeNode.note && !editingNote ? (
              <p className="mt-3 border-s-2 border-accent ps-2 text-sm italic text-fg-muted">{activeNode.note}</p>
            ) : null}

            {editingNote && onSaveNote ? (
              <div className="mt-3">
                <label htmlFor="active-node-note" className="mb-1 block text-xs font-medium text-fg-muted">
                  {t('noteLabel')}
                </label>
                <textarea
                  id="active-node-note"
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  className="w-full rounded-lg border border-line bg-surface p-2 text-sm text-fg"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={savingNote}
                    onClick={() => void handleSaveInlineNote()}
                    className="btn btn-primary px-3 py-1 text-xs"
                  >
                    {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : t('save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingNote(false)}
                    className="btn btn-secondary px-3 py-1 text-xs"
                  >
                    {t('cancel')}
                  </button>
                </div>
              </div>
            ) : null}

            {activeNode.missing ? (
              <p className="mt-2 text-xs text-red-700 dark:text-red-300">{t('missingBody')}</p>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="journey-edges-heading">
          <h2 id="journey-edges-heading" className="text-sm font-medium text-fg-muted">
            {t('relationsHeading', { count: visibleEdges.length })}
          </h2>

          {visibleEdges.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">{t('noEdges')}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {visibleEdges.map((e) => {
                const edgeId = `${e.from}->${e.to}:${e.kind}`;
                const isSelected = highlightedEdge === edgeId;
                const from = labelFor(e.from);
                const to = labelFor(e.to);
                return (
                  <li key={edgeId}>
                    <button
                      type="button"
                      onClick={() => setHighlightedEdge(isSelected ? null : edgeId)}
                      aria-pressed={isSelected}
                      className={cn(
                        'w-full rounded-lg border px-2.5 py-1.5 text-start text-xs transition-colors',
                        isSelected ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-panel'
                      )}
                    >
                      <span className="font-mono text-fg-muted">
                        {from} ↔ {to}
                      </span>
                      <span className="ms-2 text-fg">{describeEdge(e, t)}</span>
                      <span className="ms-1.5 text-fg-faint">{t('provenance', { source: e.provenance })}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <ul className="mt-3 space-y-1 text-[11px] text-fg-muted">
            {EDGE_KINDS.map((kind) => (
              <li key={kind} className="flex items-center gap-2">
                <svg width="22" height="6" aria-hidden="true" className="shrink-0">
                  <line
                    x1="0"
                    y1="3"
                    x2="22"
                    y2="3"
                    className={EDGE_COLOUR[kind]}
                    strokeWidth={EDGE_WIDTH[kind]}
                    {...(EDGE_DASH[kind] ? { strokeDasharray: EDGE_DASH[kind] } : {})}
                  />
                </svg>
                {describeEdge({ kind }, t)}
              </li>
            ))}
          </ul>
        </section>

        {graph.suggested.length ? (
          <section aria-labelledby="journey-suggested-heading">
            <h2 id="journey-suggested-heading" className="text-sm font-medium text-fg-muted">
              {t('suggestedHeading')}
            </h2>
            <p className="mt-1 text-xs text-fg-muted">{t('suggestedBody')}</p>
            <ul className="mt-2 space-y-2">
              {graph.suggested.map((s, i) => (
                <li
                  key={`${s.from}->${s.to}:${i}`}
                  className="rounded-xl border border-dashed border-line bg-surface/60 p-2.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/passage/${s.to.split(':').map(encodeURIComponent).join('/')}`}
                        className="font-medium text-fg hover:text-accent hover:underline"
                      >
                        {passageReference(s.to)}
                      </Link>
                      {s.targetTextId ? (
                        <span className="ms-1.5 text-[11px] text-fg-muted">
                          {getTextLabel(s.targetTextId as never, true)}
                        </span>
                      ) : null}
                      <p className="mt-0.5 text-[11px] text-fg-faint">
                        {labelFor(s.from)} ↔ {describeEdge(s, t)} · {t('provenance', { source: s.provenance })}
                      </p>
                    </div>
                    {onAddSuggested ? (
                      <button
                        type="button"
                        disabled={addingSuggested !== null}
                        onClick={() => void handleAddSuggestion(s.to)}
                        aria-label={t('addSuggestedNamed', { reference: passageReference(s.to) })}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-panel px-2 py-1 text-[11px] font-medium text-fg transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
                      >
                        {addingSuggested === s.to ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <Plus className="h-3 w-3" aria-hidden />
                        )}
                        {t('add')}
                      </button>
                    ) : null}
                  </div>
                  {s.preview ? (
                    <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-fg-muted">{s.preview}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {corpora.size > 1 ? (
          <p className="text-xs text-fg-muted">{t('corporaNote', { count: corpora.size })}</p>
        ) : null}
      </aside>
    </div>
  );
}

const EDGE_CORPUS: Record<string, string> = {
  quran: 'stroke-emerald-600',
  torah: 'stroke-sky-600',
  talmud: 'stroke-amber-600',
  ot: 'stroke-rose-600',
  nt: 'stroke-violet-600',
  bukhari: 'stroke-teal-600',
  muslim: 'stroke-cyan-600',
  enoch: 'stroke-stone-600',
};

const EDGE_COLOUR: Record<string, string> = {
  quotation: 'stroke-violet-600',
  allusion: 'stroke-sky-600',
  alignment: 'stroke-amber-600',
  'shared-theme': 'stroke-emerald-600',
};

const EDGE_WIDTH: Record<string, number> = { quotation: 2.5, allusion: 2, alignment: 1.5, 'shared-theme': 1 };
const EDGE_DASH: Record<string, string | undefined> = {
  quotation: undefined,
  allusion: '6 3',
  alignment: '2 3',
  'shared-theme': '1 4',
};

function cssEscape(value: string): string {
  return value.replace(/([:])/g, '\\$1');
}
