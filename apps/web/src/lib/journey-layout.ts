/**
 * Where each node goes, decided before anything is drawn.
 *
 * Deliberately deterministic rather than a force simulation, for three reasons
 * that all came up while building the rest of it:
 *
 * A layout that settles has to animate to reach its resting state, and animation
 * is the thing `prefers-reduced-motion` asks us not to do — so a reader who has
 * asked for less motion would get either a jump or a permanently unresolved
 * diagram. A fixed layout is correct on the first paint.
 *
 * A force simulation is not reproducible, so the same journey is a different
 * diagram on every visit. A reader who learned "my second passage is the one on
 * the left" would be relearning it every time, and a reader pointing at the graph
 * to someone else would be pointing at a different picture.
 *
 * And it does not need a dependency. This is a circle and some arithmetic.
 *
 * The arrangement puts the reader's own order on the ring, running clockwise from
 * the top, because position is the one thing in a journey that is not derivable —
 * the order they put the passages in is their argument, and the drawing shows it
 * rather than hiding it under an arrangement the algorithm picked.
 */

/** The three relation families, drawn differently so they can be told apart. */
export const EDGE_STYLE = {
  quotation: { width: 2.5, dash: undefined },
  allusion: { width: 2, dash: '6 3' },
  alignment: { width: 1.5, dash: '2 3' },
  'shared-theme': { width: 1, dash: '1 4' },
} as const satisfies Record<string, { width: number; dash: string | undefined }>;

export type JourneyEdgeKind = keyof typeof EDGE_STYLE;

export interface LaidOutNode {
  passageKey: string;
  /** Circle centre. */
  x: number;
  y: number;
  r: number;
  /** Reading order, 0-based, as the reader arranged it. */
  index: number;
  label: string;
  textId: string;
  note: string | null;
  missing: boolean;
}

export interface LaidOutEdge {
  from: string;
  to: string;
  kind: JourneyEdgeKind;
  strength: number;
  provenance: string;
  theme?: string;
  /** Quadratic path between the two nodes, bowed away from the centre. */
  path: string;
  width: number;
  dash?: string;
}

export interface Layout {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  centre: { x: number; y: number };
}

const NODE_R = 17;

import { passageReference } from '@/lib/passage-ref';

export interface LayoutInput {
  nodes: Array<{
    passageKey: string;
    position: number;
    note: string | null;
    missing: boolean;
    textId: string;
    book: string;
    chapter: number;
    verse: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    kind: string;
    strength: number;
    provenance: string;
    theme?: string;
  }>;
}

/**
 * Nodes on a ring in the reader's order; edges as chords.
 *
 * Short of a dozen nodes a ring wastes the middle, so below that the radius
 * shrinks and the diagram stays legible rather than becoming a scatter of dots
 * with room between them.
 */
export function layoutJourney(input: LayoutInput, size = 640): Layout {
  const ordered = [...input.nodes].sort((a, b) => a.position - b.position);
  const count = ordered.length;

  const width = size;
  const height = size;
  const centre = { x: width / 2, y: height / 2 };

  // Room for the label under each dot, so the radius has to leave a margin.
  const maxRadius = size / 2 - NODE_R - 26;
  // Under ~12 nodes the ring collapses inward rather than spreading, which keeps
  // a two-passage journey from being two dots on opposite sides of a large gap.
  const radius = count <= 2 ? maxRadius * 0.34 : count <= 6 ? maxRadius * 0.58 : maxRadius * 0.82;

  const nodes: LaidOutNode[] = ordered.map((node, index) => {
    // Straight down from the top, clockwise. index 0 at 12 o'clock.
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return {
      passageKey: node.passageKey,
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y + Math.sin(angle) * radius,
      r: NODE_R,
      index,
      label: passageReference(node.passageKey),
      textId: node.textId,
      note: node.note,
      missing: node.missing,
    };
  });

  const byKey = new Map(nodes.map((n) => [n.passageKey, n] as const));

  const edges: LaidOutEdge[] = [];
  for (const edge of input.edges) {
    const a = byKey.get(edge.from);
    const b = byKey.get(edge.to);
    if (!a || !b) continue;

    const style = EDGE_STYLE[edge.kind as JourneyEdgeKind] ?? EDGE_STYLE['shared-theme'];

    /*
     * A chord bows away from the centre.
     *
     * A straight line between two dots on a ring passes close to the middle,
     * where a dozen of them overlap into an unreadable knot. Pushing the control
     * point towards the centre bows the chord the other way, through the open
     * middle of the ring, where lines stay separable.
     */
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = mx - centre.x;
    const dy = my - centre.y;
    const distance = Math.hypot(dx, dy) || 1;
    // Pull the midpoint in towards the centre; the nearer it already is, the
    // less it moves, so adjacent nodes do not collapse onto each other.
    const pull = 0.42;
    const cx = mx - (dx / distance) * distance * pull;
    const cy = my - (dy / distance) * distance * pull;

    edges.push({
      from: edge.from,
      to: edge.to,
      kind: edge.kind as JourneyEdgeKind,
      strength: edge.strength,
      provenance: edge.provenance,
      ...(edge.theme ? { theme: edge.theme } : {}),
      path: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
      width: style.width,
      ...(style.dash ? { dash: style.dash } : {}),
    });
  }

  return { width, height, nodes, edges, centre };
}

/** Human wording for an edge, for the list that stands in for the drawing. */
export function describeEdge(edge: { kind: string; theme?: string }, t: (key: string, vars?: Record<string, string>) => string): string {
  switch (edge.kind) {
    case 'quotation':
      return t('edgeQuotation');
    case 'allusion':
      return t('edgeAllusion');
    case 'alignment':
      return t('edgeAlignment');
    default:
      return edge.theme ? t('edgeTheme', { theme: edge.theme }) : t('edgeShared');
  }
}

/** Node positions of two passages, for the arrow-key walk around the ring. */
export function neighbourKeys(layout: Layout, from: string, step: 1 | -1): string | undefined {
  if (!layout.nodes.length) return undefined;
  const i = layout.nodes.findIndex((n) => n.passageKey === from);
  if (i < 0) return layout.nodes[0]?.passageKey;
  const next = (i + step + layout.nodes.length) % layout.nodes.length;
  return layout.nodes[next]?.passageKey;
}