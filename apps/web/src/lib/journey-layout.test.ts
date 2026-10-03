/**
 * The layout has to be reproducible and it has to describe itself.
 *
 * A graph that is stable is part of what makes it learnable, so the tests here are
 * about stability rather than appearance: the same journey must produce the same
 * picture, and the reader's own order must be visible in it rather than being
 * rearranged by the algorithm.
 */

import { describe, it, expect } from 'vitest';
import { layoutJourney, neighbourKeys, describeEdge, EDGE_STYLE } from './journey-layout';

const nodes = [
  { passageKey: 'quran:2:1:255', position: 0, note: null, missing: false, textId: 'quran', book: '2', chapter: 2, verse: 255 },
  { passageKey: 'quran:1:1:1', position: 1, note: 'start here', missing: false, textId: 'quran', book: '1', chapter: 1, verse: 1 },
  { passageKey: 'quran:2:1:163', position: 2, note: null, missing: false, textId: 'quran', book: '2', chapter: 2, verse: 163 },
  { passageKey: 'nt:Matthew:5:14', position: 3, note: null, missing: false, textId: 'nt', book: 'Matthew', chapter: 5, verse: 14 },
];

const edges = [
  { from: 'quran:2:1:255', to: 'quran:1:1:1', kind: 'shared-theme', strength: 0.4, provenance: 'derived', theme: 'mercy' },
  { from: 'quran:2:1:163', to: 'nt:Matthew:5:14', kind: 'quotation', strength: 0.9, provenance: 'jev' },
  { from: 'quran:1:1:1', to: 'nt:Matthew:5:14', kind: 'allusion', strength: 0.6, provenance: 'jev' },
];

describe('layoutJourney', () => {
  it('is reproducible: the same journey draws the same way twice', () => {
    // A force layout is not, so a reader who learned "mine is on the left" would
    // relearn it every visit, and pointing at the graph to someone would show a
    // different picture each time.
    const a = layoutJourney({ nodes, edges });
    const b = layoutJourney({ nodes, edges });
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
    expect(a.edges.map((e) => e.path)).toEqual(b.edges.map((e) => e.path));
  });

  it('lays nodes out in the order the reader chose', () => {
    // Position is the one thing in a journey that is not derivable, so the drawing
    // has to show it rather than rearranging it.
    const l = layoutJourney({ nodes, edges });
    expect(l.nodes.map((n) => n.passageKey)).toEqual(nodes.map((n) => n.passageKey));
    expect(l.nodes.map((n) => n.index)).toEqual([0, 1, 2, 3]);
  });

  it('does not depend on the order the nodes arrive in', () => {
    const shuffled = [...nodes].reverse();
    expect(layoutJourney({ nodes: shuffled, edges }).nodes.map((n) => n.passageKey)).toEqual(
      nodes.map((n) => n.passageKey)
    );
  });

  it('sorts by position when the server sends them out of order', () => {
    const jumbled = [nodes[2], nodes[0], nodes[3], nodes[1]];
    const l = layoutJourney({ nodes: jumbled, edges: [] });
    expect(l.nodes.map((n) => n.index)).toEqual([0, 1, 2, 3]);
    expect(l.nodes[0].passageKey).toBe('quran:2:1:255');
  });

  it('puts the first passage at the top and runs clockwise', () => {
    const l = layoutJourney({ nodes, edges });
    const [first, second] = l.nodes;
    // Twelve o'clock: x level with the centre, y above it.
    expect(first.x).toBeCloseTo(l.centre.x, 1);
    expect(first.y).toBeLessThan(l.centre.y);
    // The next node is clockwise, so to the right of it.
    expect(second.x).toBeGreaterThan(l.centre.x);
  });

  it('labels a node the way a reader would write the reference', () => {
    // chapter:verse, which is how the passage itself is headed. Reading `book`
    // here would print "2:255" for the Quran and "Matthew:5:14" inconsistently.
    const l = layoutJourney({ nodes, edges });
    expect(l.nodes[0].label).toBe('2:255');
  });

  it('keeps every node inside the viewBox', () => {
    for (const size of [2, 3, 6, 12, 40, 200]) {
      const many = Array.from({ length: size }, (_, i) => ({
        ...nodes[0],
        passageKey: `quran:${i}:1:${i + 1}`,
        position: i,
      }));
      const l = layoutJourney({ nodes: many, edges: [] }, 640);
      for (const n of l.nodes) {
        expect(n.x - n.r, `node ${n.passageKey} off the left edge at size ${size}`).toBeGreaterThanOrEqual(0);
        expect(n.x + n.r, `node ${n.passageKey} off the right edge at size ${size}`).toBeLessThanOrEqual(640);
        expect(n.y - n.r, `node ${n.passageKey} off the top at size ${size}`).toBeGreaterThanOrEqual(0);
        expect(n.y + n.r, `node ${n.passageKey} off the bottom at size ${size}`).toBeLessThanOrEqual(640);
      }
    }
  });

  it('keeps two passages from being dots at opposite ends of a wide gap', () => {
    // A full-size ring for a two-passage journey is two dots with nothing between
    // them, which reads as two unrelated things.
    const two = nodes.slice(0, 2);
    const l = layoutJourney({ nodes: two, edges: [] });
    const distance = Math.hypot(l.nodes[0].x - l.nodes[1].x, l.nodes[0].y - l.nodes[1].y);
    expect(distance).toBeLessThan(640 / 2);
  });

  it('drops an edge whose other end is not in the journey', () => {
    // A stale edge must not become a line to nowhere.
    const l = layoutJourney({
      nodes,
      edges: [...edges, { from: 'quran:2:1:255', to: 'quran:9:1:1', kind: 'quotation', strength: 1, provenance: 'jev' }],
    });
    expect(l.edges).toHaveLength(edges.length);
  });

  it('gives each edge family its own stroke, so they can be told apart', () => {
    // A line that does not say what kind of relation it is is a line meaning
    // "something", which is the ambiguity this whole feature is built to avoid.
    const widths = Object.values(EDGE_STYLE).map((s) => s.width);
    expect(new Set(widths).size).toBe(widths.length);
    expect(Object.keys(EDGE_STYLE)).toEqual(['quotation', 'allusion', 'alignment', 'shared-theme']);
  });

  it('bows chords away from the centre so a dozen lines stay separable', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      from: `quran:${i}:1:1`,
      to: `quran:${i + 1}:1:1`,
      kind: 'shared-theme',
      strength: 0.5,
      provenance: 'derived',
    }));
    const l = layoutJourney({ nodes, edges: many });
    // Every path is a curve through its own control point, not a straight line.
    for (const e of l.edges) expect(e.path).toMatch(/^M [\d.]+ [\d.]+ Q [\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
    // Control points are distinct, so the curves do not all run through one spot.
    const controls = l.edges.map((e) => e.path.split(' Q ')[1].split(' ').slice(0, 2).join(','));
    expect(new Set(controls).size).toBe(controls.length);
  });

  it('carries the note and the missing flag onto the node', () => {
    const withMissing = [{ ...nodes[0], passageKey: 'quran:99:1:1', missing: true }, nodes[1]];
    const l = layoutJourney({ nodes: withMissing, edges: [] });
    expect(l.nodes[0].missing).toBe(true);
    expect(l.nodes[1].note).toBe('start here');
  });

  it('survives an empty journey without dividing by zero', () => {
    const l = layoutJourney({ nodes: [], edges: [] });
    expect(l.nodes).toEqual([]);
    expect(l.edges).toEqual([]);
    expect(l.centre.x).toBeGreaterThan(0);
  });
});

describe('neighbourKeys', () => {
  it('walks the ring in both directions and wraps', () => {
    const l = layoutJourney({ nodes, edges });
    expect(neighbourKeys(l, 'quran:2:1:255', 1)).toBe('quran:1:1:1');
    expect(neighbourKeys(l, 'quran:2:1:255', -1)).toBe('nt:Matthew:5:14');
  });

  it('starts from the first node when asked about one that is not there', () => {
    const l = layoutJourney({ nodes, edges });
    expect(neighbourKeys(l, 'gone', 1)).toBe('quran:2:1:255');
  });

  it('is undefined on an empty ring rather than throwing', () => {
    expect(neighbourKeys(layoutJourney({ nodes: [], edges: [] }), 'x', 1)).toBeUndefined();
  });
});

describe('describeEdge', () => {
  const t = (key: string, vars?: Record<string, string>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key;

  it('names the theme when one joins them', () => {
    expect(describeEdge({ kind: 'shared-theme', theme: 'mercy' }, t)).toBe('edgeTheme:mercy');
  });

  it('does not claim a theme when there is none', () => {
    expect(describeEdge({ kind: 'shared-theme' }, t)).toBe('edgeShared');
  });

  it('distinguishes a quotation from an allusion', () => {
    expect(describeEdge({ kind: 'quotation' }, t)).toBe('edgeQuotation');
    expect(describeEdge({ kind: 'allusion' }, t)).toBe('edgeAllusion');
  });
});