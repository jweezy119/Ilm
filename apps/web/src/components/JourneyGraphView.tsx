'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import type { JourneyGraph } from '@ilm/shared';
import { layoutJourney, neighbourKeys, describeEdge } from '@/lib/journey-layout';
import { getTextLabel } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { ReadAloud } from '@/components/ReadAloud';

/**
 * The journey, drawn.
 *
 * Nodes are the passages the reader chose, in the order they chose them, on a
 * ring. The lines between them are relations this app detected — a quotation
 * because something found a quotation — and each family is drawn differently so
 * a line never means only "something".
 *
 * Two things make it operable rather than merely visible:
 *
 * The drawing is not the only description of it. Every node is a real focusable
 * control in the tab order, the arrow keys walk around the ring in the reader's
 * own order, and every edge is written out in a list underneath. A line in an SVG
 * is invisible to a screen reader, so a graph that relied on it would be a
 * picture of a knowledge graph rather than a knowledge graph.
 *
 * And nothing animates. The layout is fixed, so it is correct on the first paint
 * and identical on every visit — a reader who learned where their second passage
 * sits is not asked to relearn it, and there is no motion to switch off.
 */
export function JourneyGraphView({ graph }: { graph: JourneyGraph }) {
  const t = useTranslations('journeys');
  const [active, setActive] = useState<string | null>(graph.nodes[0]?.passageKey ?? null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const layout = useMemo(() => layoutJourney({ nodes: graph.nodes, edges: graph.edges }), [graph]);
  const byKey = useMemo(() => new Map(graph.nodes.map((n) => [n.passageKey, n] as const)), [graph.nodes]);
  /** "2:255", falling back to the raw key for a node the layout does not know. */
  const labelFor = useCallback(
    (key: string) => layout.nodes.find((n) => n.passageKey === key)?.label ?? key,
    [layout.nodes]
  );

  /** Move focus to a node's control, so the keyboard and the ring stay in step. */
  const focusNode = useCallback((passageKey: string) => {
    setActive(passageKey);
    const el = svgRef.current?.querySelector<SVGGElement>(`[data-node="${cssEscape(passageKey)}"]`);
    el?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGGElement>, passageKey: string) => {
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
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

  const activeNode = active ? byKey.get(active) : undefined;
  const corpora = new Set(graph.nodes.filter((n) => !n.missing).map((n) => n.textId));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <div>
        {/*
          The SVG is aria-hidden as a whole and the node list below carries the
          same content in words. Hiding a decorative twin of something already
          described is fine; leaving both in the tree means a screen reader
          announces the graph twice and the labels twice, which is worse than
          either alone.
        */}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="w-full max-w-[40rem] select-none"
          role="img"
          aria-label={t('graphLabel', { count: graph.nodes.length })}
        >
          <title>{t('graphLabel', { count: graph.nodes.length })}</title>

          <g aria-hidden="true">
            {layout.edges.map((e) => (
              <path
                key={`${e.from}->${e.to}:${e.kind}`}
                d={e.path}
                fill="none"
                className={EDGE_COLOUR[e.kind]}
                strokeWidth={e.width}
                strokeOpacity={0.25 + e.strength * 0.55}
                strokeLinecap="round"
                {...(e.dash ? { strokeDasharray: e.dash } : {})}
              />
            ))}
          </g>

          {layout.nodes.map((n) => {
            const isActive = active === n.passageKey;
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
                onClick={() => setActive(n.passageKey)}
                onKeyDown={(e) => onKeyDown(e, n.passageKey)}
                className="cursor-pointer outline-none focus-visible:opacity-100"
                opacity={n.missing ? 0.55 : 1}
              >
                {isActive ? <circle cx={n.x} cy={n.y} r={n.r + 5} fill="none" stroke="currentColor" strokeWidth={1.5} opacity={0.5} /> : null}
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  className={n.missing ? 'fill-bg' : 'fill-panel'}
                  // Tailwind colour utilities rather than CSS variables: the
                  // palette is emerald/sky/amber/rose/violet, and inventing a
                  // --quran variable for one component would leave the next one
                  // guessing which palette it is in. Note the tokens are the
                  // semantic set — panel, bg — because there is no 
                  // colour, and fill-surface compiles to nothing, which leaves
                  // the circle filled solid black.
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

        {/*
          The drawing, in words. This is the accessible half and it is not
          optional: the reader who cannot see the ring needs the order, and the
          reader who can needs to know which line is which.
        */}
        <section aria-labelledby="journey-order-heading" className="mt-6">
          <h2 id="journey-order-heading" className="text-sm font-medium text-fg-muted">
            {t('orderHeading')}
          </h2>
          <ol className="mt-2 space-y-1.5">
            {/*
              Iterated over the laid-out nodes rather than graph.nodes: the ring
              is what establishes the order, and reading it from here means the
              list and the drawing can never disagree about what comes next.
            */}
            {layout.nodes.map((laid) => {
              const passage = byKey.get(laid.passageKey);
              const isActive = active === laid.passageKey;
              return (
                <li key={laid.passageKey}>
                  <button
                    type="button"
                    onClick={() => focusNode(laid.passageKey)}
                    aria-pressed={isActive}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-start text-sm transition-colors',
                      isActive ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-panel'
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
            {/*
              Reading the passage a reader has selected on their own journey.
              Same control as the passage page and the reader, so hearing it is
              one click from anywhere it appears — which is the point of a
              feature that exists to be used, not to be found.
            */}
            {activeNode.preview ? (
              <div className="mt-3">
                <ReadAloud text={activeNode.preview} textId={activeNode.textId} compact />
              </div>
            ) : null}
            {activeNode.note ? <p className="mt-2 border-s-2 border-accent ps-2 text-sm italic text-fg-muted">{activeNode.note}</p> : null}
            {activeNode.missing ? (
              <p className="mt-2 text-xs text-red-700 dark:text-red-300">{t('missingBody')}</p>
            ) : (
              <Link
                href={`/passage/${activeNode.passageKey.split(':').map(encodeURIComponent).join('/')}`}
                className="btn btn-secondary mt-3"
              >
                {t('openPassage')}
              </Link>
            )}
          </section>
        ) : null}

        <section aria-labelledby="journey-edges-heading">
          <h2 id="journey-edges-heading" className="text-sm font-medium text-fg-muted">
            {t('relationsHeading', { count: graph.edges.length })}
          </h2>

          {graph.edges.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">{t('noEdges')}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {graph.edges.map((e) => {
                const from = labelFor(e.from);
                const to = labelFor(e.to);
                return (
                  <li key={`${e.from}->${e.to}:${e.kind}`} className="rounded-lg border border-line px-2.5 py-1.5 text-xs">
                    <span className="font-mono text-fg-muted">
                      {from} ↔ {to}
                    </span>
                    <span className="ms-2 text-fg">{describeEdge(e, t)}</span>
                    <span className="ms-1.5 text-fg-faint">{t('provenance', { source: e.provenance })}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {/*
            The edge families as a key. A reader looking at the ring needs to know
            that a solid line is a quotation and a dotted one is a shared theme,
            and that none of them is a connection anyone invented.
          */}
          <ul className="mt-3 space-y-1 text-[11px] text-fg-muted">
            {(['quotation', 'allusion', 'alignment', 'shared-theme'] as const).map((kind) => (
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
            <ul className="mt-2 space-y-1">
              {graph.suggested.map((s, i) => (
                <li key={`${s.from}->${s.to}:${i}`} className="rounded-lg border border-dashed border-line px-2.5 py-1.5 text-xs">
                  <span className="font-mono text-fg-muted">
                    {labelFor(s.from)} ↔ {labelFor(s.to)}
                  </span>
                  <span className="ms-2">{describeEdge(s, t)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {corpora.size > 1 ? (
          <p className="text-xs text-fg-muted">
            {t('corporaNote', { count: corpora.size })}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

/**
 * Node rings, by corpus — the same palette as TEXT_STYLES, so a dot and a text
 * chip mean the same thing.
 */
const EDGE_CORPUS: Record<string, string> = {
  quran: 'stroke-emerald-600',
  torah: 'stroke-sky-600',
  talmud: 'stroke-amber-600',
  ot: 'stroke-rose-600',
  nt: 'stroke-violet-600',
};

/**
 * Line colours by relation, not by corpus.
 *
 * Corpus is already carried by each node's ring, so colour is free to carry the
 * relation — which is the thing a reader cannot work out from the shape alone.
 */
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

/** CSS.escape is not universally available; a passage key only needs colons escaped. */
function cssEscape(value: string): string {
  return value.replace(/([:])/g, '\\$1');
}