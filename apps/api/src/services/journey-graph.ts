/**
 * Journeys: a reader's own path through the corpora.
 *
 * A journey is a set of passages the reader chose and the order they put them in.
 * It is deliberately *not* a set of edges. Every edge on the graph is read at
 * query time from a relation the app already stores — cross_references,
 * alignments, passage_themes — so it carries the provenance that detected it: a
 * quotation is drawn as a quotation because something found a quotation, and the
 * reader can tell that apart from local scoring the same way they can everywhere
 * else in the product.
 *
 * There is no way to draw an edge by hand, and that is the design rather than a
 * gap. An asserted edge would render in the same style as a detected one and the
 * UI could not afterwards tell the reader which was which, which is precisely the
 * ambiguity this library was built to avoid. A reader's own thought about how two
 * passages connect is a note on the node, which is visibly their writing.
 *
 * Identity is the same anonymous cookie as the library, and inherits the same
 * trade: no account, and clearing cookies loses the journey.
 *
 * Nodes store a passage key, never a copy of the text, for the reason the library
 * does the same.
 */

import { prisma, getPassagesByKeys } from './passage';
import {
  JOURNEY_LIMITS,
  PassageKeySchema,
  TextIdSchema,
  type JourneyEdge,
  type JourneyEdgeKind,
  type JourneyGraph,
  type JourneyGraphNode,
  type JourneySummary,
  type JourneySuggestion,
  type TextId,
} from '@ilm/shared';

/**
 * How many edges one relation may contribute to a graph.
 *
 * Without a cap a single heavily-quoted passage can dominate a drawing and the
 * reader loses sight of the passages they chose. The graph is a reading aid; the
 * list is where the exhaustive relations live.
 */
const MAX_EDGES = 120;

/** Suggestions are a nudge, not a reading list. */
const MAX_SUGGESTIONS = 12;

/**
 * Two thresholds, because strength means two different things.
 *
 * On a cross-reference, `strength` is a confidence: how sure the detector is that
 * these two passages are related at all. 0.3 is the floor for drawing a line.
 *
 * A theme score is not a confidence — it is how strongly a passage carries a
 * theme, and across the corpus most of them sit between 0.1 and 0.5 because no
 * passage is dominated by any single theme. Applying 0.3 to those silently
 * dropped most shared themes: six mercy-and-creation verses produced a graph
 * with no edges at all, which read as "these passages are unrelated" rather than
 * as a threshold set for the wrong quantity. 0.1 is the floor here, and still
 * filters the themes every passage happens to carry.
 */
const MIN_EDGE_STRENGTH = 0.3;
const MIN_THEME_SCORE = 0.1;

const NAME_REQUIRED = 'Give the journey a name.';

function trimmed(value: string | undefined | null): string {
  return (value ?? '').trim();
}

export class JourneyError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = 'JourneyError';
  }
}

/* ============================================================================
   CRUD
   ============================================================================ */

export async function listJourneys(userId: string): Promise<JourneySummary[]> {
  const journeys = await prisma.journey.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      nodes: {
        orderBy: { position: 'asc' },
        select: { passageKey: true },
      },
    },
  });

  // One query for the corpora behind every journey's keys, rather than a lookup
  // per journey. Thirty journeys is thirty round trips otherwise.
  const keys = [...new Set(journeys.flatMap((j) => j.nodes.map((n) => n.passageKey)))];
  const corporaByKey = await corporaForKeys(keys);

  return journeys.map((j) => ({
    id: j.id,
    name: j.name,
    description: j.description,
    nodeCount: j.nodes.length,
    corpora: [...new Set(j.nodes.map((n) => corporaByKey.get(n.passageKey)).filter((t): t is TextId => Boolean(t)))],
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  }));
}

export async function createJourney(
  userId: string,
  input: { name: string; description?: string | null }
): Promise<JourneySummary> {
  const name = trimmed(input.name);
  if (!name) throw new JourneyError(NAME_REQUIRED);
  if (name.length > JOURNEY_LIMITS.nameLength) {
    throw new JourneyError(`Keep the name under ${JOURNEY_LIMITS.nameLength} characters.`);
  }

  const count = await prisma.journey.count({ where: { userId } });
  if (count >= JOURNEY_LIMITS.maxJourneys) {
    throw new JourneyError(`A reader keeps up to ${JOURNEY_LIMITS.maxJourneys} journeys.`, 409);
  }

  // A duplicate name would make "which one did I mean" a question the data
  // should never produce. Reported as a conflict rather than merged, because
  // silently renaming one of two journeys the reader did name is worse.
  const existing = await prisma.journey.findUnique({ where: { userId_name: { userId, name } } });
  if (existing) throw new JourneyError('You already have a journey with that name.', 409);

  const journey = await prisma.journey.create({
    data: {
      userId,
      name,
      description: trimmed(input.description) || null,
    },
  });

  return {
    id: journey.id,
    name: journey.name,
    description: journey.description,
    nodeCount: 0,
    corpora: [],
    createdAt: journey.createdAt.toISOString(),
    updatedAt: journey.updatedAt.toISOString(),
  };
}

export async function renameJourney(
  userId: string,
  journeyId: string,
  input: { name?: string; description?: string | null }
): Promise<JourneySummary> {
  const owned = await ownedJourney(userId, journeyId);

  const name = trimmed(input.name);
  if (input.name !== undefined) {
    if (!name) throw new JourneyError(NAME_REQUIRED);
    if (name.length > JOURNEY_LIMITS.nameLength) {
      throw new JourneyError(`Keep the name under ${JOURNEY_LIMITS.nameLength} characters.`);
    }
    if (name !== owned.name) {
      const clash = await prisma.journey.findUnique({ where: { userId_name: { userId, name } } });
      if (clash) throw new JourneyError('You already have a journey with that name.', 409);
    }
  }

  const journey = await prisma.journey.update({
    where: { id: owned.id },
    data: {
      ...(name ? { name } : {}),
      ...(input.description !== undefined ? { description: trimmed(input.description) || null } : {}),
    },
    include: { nodes: { select: { passageKey: true } } },
  });

  const corporaByKey = await corporaForKeys(journey.nodes.map((n) => n.passageKey));

  return {
    id: journey.id,
    name: journey.name,
    description: journey.description,
    nodeCount: journey.nodes.length,
    corpora: [...new Set(journey.nodes.map((n) => corporaByKey.get(n.passageKey)).filter((t): t is TextId => Boolean(t)))],
    createdAt: journey.createdAt.toISOString(),
    updatedAt: journey.updatedAt.toISOString(),
  };
}

export async function deleteJourney(userId: string, journeyId: string): Promise<{ removed: boolean }> {
  const owned = await ownedJourney(userId, journeyId);
  // Nodes cascade. Deleting a journey is not a soft delete because a reader has
  // no list of deleted journeys to restore from, and keeping the rows would only
  // make the same name available to nobody.
  await prisma.journey.delete({ where: { id: owned.id } });
  return { removed: true };
}

/* ============================================================================
   Nodes
   ============================================================================ */

export async function addJourneyNode(
  userId: string,
  journeyId: string,
  passageKey: string
): Promise<{ added: boolean; position: number }> {
  const owned = await ownedJourney(userId, journeyId);
  const key = PassageKeySchema.parse(passageKey);

  // The passage has to exist, or the node is a dangling reference the graph
  // cannot draw. Checked here rather than trusted from the client.
  const passage = await prisma.passage.findUnique({ where: { passageKey: key }, select: { id: true } });
  if (!passage) throw new JourneyError('That passage is not in the corpus.', 404);

  const existing = await prisma.journeyNode.findUnique({
    where: { journeyId_passageKey: { journeyId: owned.id, passageKey: key } },
    select: { id: true },
  });
  if (existing) return { added: false, position: -1 };

  const count = await prisma.journeyNode.count({ where: { journeyId: owned.id } });
  if (count >= JOURNEY_LIMITS.maxNodes) {
    throw new JourneyError(`A journey holds up to ${JOURNEY_LIMITS.maxNodes} passages.`, 409);
  }

  // Append. Position is the reader's order, so a new node goes last unless they
  // move it, rather than being inserted somewhere we guessed.
  const node = await prisma.journeyNode.create({
    data: { journeyId: owned.id, passageKey: key, position: count },
    select: { position: true },
  });
  await touch(owned.id);
  return { added: true, position: node.position };
}

export async function removeJourneyNode(userId: string, journeyId: string, passageKey: string): Promise<{ removed: boolean }> {
  const owned = await ownedJourney(userId, journeyId);
  const key = PassageKeySchema.parse(passageKey);
  await prisma.journeyNode.deleteMany({ where: { journeyId: owned.id, passageKey: key } });
  // Positions are re-packed so a removed node does not leave a gap that later
  // reorders have to reason about.
  await compactPositions(owned.id);
  await touch(owned.id);
  return { removed: true };
}

export async function setJourneyNodeNote(
  userId: string,
  journeyId: string,
  passageKey: string,
  note: string | null
): Promise<{ note: string | null }> {
  const owned = await ownedJourney(userId, journeyId);
  const key = PassageKeySchema.parse(passageKey);
  const trimmedNote = trimmed(note) || null;
  if (trimmedNote && trimmedNote.length > JOURNEY_LIMITS.noteLength) {
    throw new JourneyError(`Keep a note under ${JOURNEY_LIMITS.noteLength} characters.`);
  }
  await prisma.journeyNode.updateMany({
    where: { journeyId: owned.id, passageKey: key },
    data: { note: trimmedNote },
  });
  await touch(owned.id);
  return { note: trimmedNote };
}

/**
 * Set the whole order at once.
 *
 * The client sends the passage keys in the order it wants them rather than a
 * list of positions, because that is what it has — the reader dragged rows, not
 * numbers. Positions are rewritten from the order of arrival, so a partial or
 * duplicated list cannot leave two nodes claiming the same slot.
 */
export async function reorderJourney(
  userId: string,
  journeyId: string,
  orderedKeys: string[]
): Promise<{ positions: Array<{ passageKey: string; position: number }> }> {
  const owned = await ownedJourney(userId, journeyId);
  const nodes = await prisma.journeyNode.findMany({
    where: { journeyId: owned.id },
    select: { passageKey: true },
  });

  const known = new Set(nodes.map((n) => n.passageKey));
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of orderedKeys) {
    const parsed = PassageKeySchema.safeParse(raw);
    // Keys the reader does not have are ignored rather than fatal: the list came
    // from a stale render, and losing one reorder is not a reason to 500.
    if (!parsed.success) continue;
    if (!known.has(parsed.data) || seen.has(parsed.data)) continue;
    seen.add(parsed.data);
    ordered.push(parsed.data);
  }
  // Anything absent from the request keeps its relative order, at the end.
  for (const n of nodes) if (!seen.has(n.passageKey)) ordered.push(n.passageKey);

  await prisma.$transaction(
    ordered.map((passageKey, position) =>
      prisma.journeyNode.updateMany({ where: { journeyId: owned.id, passageKey }, data: { position } })
    )
  );
  await touch(owned.id);

  return { positions: ordered.map((passageKey, position) => ({ passageKey, position })) };
}

/* ============================================================================
   The graph
   ============================================================================ */

export async function getJourneyGraph(userId: string, journeyId: string): Promise<JourneyGraph> {
  const journey = await ownedJourney(userId, journeyId);
  const nodes = await prisma.journeyNode.findMany({
    where: { journeyId: journey.id },
    orderBy: { position: 'asc' },
  });

  const keys = nodes.map((n) => n.passageKey);
  const byKey = new Map(await getPassagesByKeys(keys).then((ps) => ps.map((p) => [p.passageKey, p] as const)));

  const graphNodes: JourneyGraphNode[] = nodes.map((n) => {
    const passage = byKey.get(n.passageKey);
    return {
      passageKey: n.passageKey,
      // A node whose passage has left the corpus is still listed, marked missing,
      // rather than dropped: it was part of the reader's argument and its absence
      // from the graph would be a silent edit to it.
      textId: passage?.textId ?? ('quran' as TextId),
      book: passage?.book ?? n.passageKey.split(':')[1] ?? '',
      chapter: passage?.chapter ?? 0,
      verse: passage?.verse ?? 0,
      position: n.position,
      note: n.note,
      preview: passage?.translation ?? '',
      originalText: passage?.originalText ?? '',
      language: passage?.metadata.language ?? '',
      missing: !passage,
    };
  });

  const { edges, suggestions } = await deriveEdges(keys);
  const corpora = [...new Set(graphNodes.filter((n) => !n.missing).map((n) => n.textId))];

  return {
    journey: {
      id: journey.id,
      name: journey.name,
      description: journey.description,
      nodeCount: nodes.length,
      corpora,
      createdAt: journey.createdAt.toISOString(),
      updatedAt: journey.updatedAt.toISOString(),
    },
    nodes: graphNodes,
    edges,
    suggested: suggestions,
  };
}

/**
 * Read the relations between the chosen passages.
 *
 * Three families, kept as three kinds rather than merged into one edge type,
 * because merging them is what lets the weakest lend the others their authority:
 * a thematic co-occurrence is not a quotation, and a drawing that does not
 * distinguish them is claiming more than it knows.
 *
 * Both directions are read for cross-references and alignments. `direction`
 * exists and is 'bidirectional' by default, but a reader's journey is not a
 * claim about direction — they put two passages side by side and asked what the
 * relation is — so an edge is drawn whichever way the row is stored. The
 * directional reading lives in citations, where the claim is about one text
 * quoting another.
 */
async function deriveEdges(keys: string[]): Promise<{ edges: JourneyEdge[]; suggestions: JourneySuggestion[] }> {
  if (keys.length < 2) return { edges: [], suggestions: [] };

  const keySet = new Set(keys);
  const edges: JourneyEdge[] = [];
  const seen = new Set<string>();

  const addEdge = (
    from: string,
    to: string,
    kind: JourneyEdgeKind,
    strength: number,
    provenance: 'jev' | 'derived' | 'manual',
    theme?: string,
    sharedText?: string
  ) => {
    if (!keySet.has(from) || !keySet.has(to) || from === to) return;
    if (strength < (kind === 'shared-theme' ? MIN_THEME_SCORE : MIN_EDGE_STRENGTH)) return;
    const pairKey = [from, to].sort().join(' ');
    if (seen.has(pairKey)) return;
    seen.add(pairKey);
    edges.push({ from, to, kind, strength, provenance, ...(theme ? { theme } : {}) });

    if (suggestions.length < MAX_SUGGESTIONS && sharedText) {
      suggestions.push({ from, to, kind, strength, provenance, ...(theme ? { theme } : {}), sharedText });
    }
  };

  const passageIds = (await prisma.passage.findMany({
    where: { passageKey: { in: keys } },
    select: { id: true, passageKey: true },
  })).map((p) => ({ id: p.id, passageKey: p.passageKey }));

  const idToKey = new Map(passageIds.map((p) => [p.id, p.passageKey]));
  const ids = passageIds.map((p) => p.id);
  const suggestions: JourneySuggestion[] = [];

  // Quotations and allusions. The strongest edges on the graph, and the only
  // ones where the two texts are known to be talking about each other.
  const crossRefs = await prisma.crossReference.findMany({
    where: {
      OR: [{ sourcePassageId: { in: ids } }, { targetPassageId: { in: ids } }],
      strength: { gte: MIN_EDGE_STRENGTH },
    },
    select: {
      sourcePassageId: true,
      targetPassageId: true,
      type: true,
      strength: true,
      detectedBy: true,
      notes: true,
    },
  });

  for (const ref of crossRefs) {
    const from = idToKey.get(ref.sourcePassageId);
    const to = idToKey.get(ref.targetPassageId);
    if (!from || !to) continue;
    addEdge(
      from,
      to,
      ref.type === 'quote' ? 'quotation' : 'allusion',
      ref.strength,
      ref.detectedBy === 'manual' ? 'manual' : ref.detectedBy === 'jev' ? 'jev' : 'derived',
      undefined,
      ref.notes || undefined
    );
  }

  // Alignments: two passages standing in relation, of seven kinds.
  const alignments = await prisma.alignment.findMany({
    where: {
      OR: [{ sourcePassageId: { in: ids } }, { targetPassageId: { in: ids } }],
      type: { not: 'none' },
    },
    select: { sourcePassageId: true, targetPassageId: true, type: true, notes: true },
  });

  for (const al of alignments) {
    const from = idToKey.get(al.sourcePassageId);
    const to = idToKey.get(al.targetPassageId);
    if (!from || !to) continue;
    // A direct quote is already on the graph as a stronger, better-sourced edge;
    // drawing it again as a generic alignment would double it.
    if (al.type === 'direct_quote') continue;
    addEdge(from, to, 'alignment', 0.6, 'derived', undefined, al.notes || undefined);
  }

  // Shared themes: the weakest kind, drawn last so a stronger relation between
  // the same pair wins the `seen` check above.
  const themes = await prisma.passageTheme.findMany({
    where: { passageId: { in: ids } },
    select: { passageId: true, themeId: true, score: true },
  });

  const byTheme = new Map<string, Array<{ passageId: string; score: number }>>();
  for (const t of themes) {
    const list = byTheme.get(t.themeId) ?? [];
    list.push({ passageId: t.passageId, score: t.score });
    byTheme.set(t.themeId, list);
  }

  for (const [theme, holders] of byTheme) {
    if (holders.length < 2) continue;
    for (let i = 0; i < holders.length; i += 1) {
      for (let j = i + 1; j < holders.length; j += 1) {
        const a = idToKey.get(holders[i].passageId);
        const b = idToKey.get(holders[j].passageId);
        if (!a || !b) continue;
        // The weaker of the two scores: a theme only one of them carries
        // strongly is not something they have in common.
        addEdge(a, b, 'shared-theme', Math.min(holders[i].score, holders[j].score), 'derived', theme);
      }
    }
  }

  edges.sort((a, b) => b.strength - a.strength);
  return { edges: edges.slice(0, MAX_EDGES), suggestions: suggestions.slice(0, MAX_SUGGESTIONS) };
}

/* ============================================================================
   Helpers
   ============================================================================ */

/**
 * The journey, proven to be this reader's.
 *
 * Not found and not yours are the same answer. A 403 would tell a stranger that
 * a journey id exists, and the ids are cuid — guessable only by being given one,
 * but there is no reason to leak the distinction when there is nothing to gain.
 */
async function ownedJourney(userId: string, journeyId: string) {
  const journey = await prisma.journey.findFirst({ where: { id: journeyId, userId } });
  if (!journey) throw new JourneyError('Journey not found.', 404);
  return journey;
}

async function corporaForKeys(keys: string[]): Promise<Map<string, TextId>> {
  if (!keys.length) return new Map();
  const rows = await prisma.passage.findMany({
    where: { passageKey: { in: keys } },
    select: { passageKey: true, textId: true },
  });

  // Prisma types text_id as a plain string, but every corpus label this returns
  // goes into a TextId. Parsed rather than cast: a row naming a corpus the app
  // does not know about is skipped instead of being smuggled past the type.
  const out = new Map<string, TextId>();
  for (const row of rows) {
    const parsed = TextIdSchema.safeParse(row.textId);
    if (parsed.success) out.set(row.passageKey, parsed.data);
  }
  return out;
}

async function touch(journeyId: string): Promise<void> {
  await prisma.journey.update({ where: { id: journeyId }, data: { updatedAt: new Date() } });
}

/** Re-pack positions to 0..n-1 in current order. */
async function compactPositions(journeyId: string): Promise<void> {
  const nodes = await prisma.journeyNode.findMany({
    where: { journeyId },
    orderBy: { position: 'asc' },
    select: { id: true },
  });
  await prisma.$transaction(
    nodes.map((n, position) => prisma.journeyNode.update({ where: { id: n.id }, data: { position } }))
  );
}