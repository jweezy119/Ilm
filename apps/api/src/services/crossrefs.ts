/**
 * Cross-references
 *
 * Connections between a passage and the rest of the corpus: quotations,
 * allusions, shared themes, cognate vocabulary, shared narrative, shared doctrine.
 *
 * Detection is expensive, so it runs at most once per passage and the result is
 * stored. A later read is a plain database query, which is why the passage page
 * can afford to ask for cross-references on every load.
 */

import type { CrossRef, Passage, TextId } from '@ilm/shared';
import { detectCrossReferences } from './typesafe';
import { addCrossReference, getPassagesByKeys, hasStoredCrossReferences, prisma } from './passage';
import { NotFoundError } from '../lib/errors';

/** Neighbours considered per source passage. */
const CANDIDATES = Number(process.env.CROSSREF_CANDIDATES ?? 30);
const MAX_REFS = 8;

/**
 * Matches that are not evidence of lineage.
 *
 * A corpus quoting itself is repetition, and the same verse in two collections
 * is a duplicate witness. Both are true and neither is interesting next to a
 * quotation, and both outnumber the interesting kind by an order of magnitude.
 */
const SELF_REFERENCE_TYPES = ['parallel', 'duplicate'];

export interface CrossReferenceResult {
  references: CrossRef[];
  /** Whether this call computed the references or read them from storage. */
  computed: boolean;
}

/**
 * Cross-references for a passage, computing and storing them on first request.
 * Pass `refresh` to recompute and overwrite.
 */
export async function getCrossReferencesForPassage(passageId: string, options: { refresh?: boolean } = {}): Promise<CrossReferenceResult> {
  const source = await prisma.passage.findUnique({ where: { id: passageId }, select: { id: true, passageKey: true } });
  if (!source) throw new NotFoundError(`Passage not found: ${passageId}`);

  if (!options.refresh && (await hasStoredCrossReferences(passageId))) {
    return { references: await readStored(passageId), computed: false };
  }

  const hydrated = (await getPassagesByKeys([source.passageKey]))[0];
  if (!hydrated) throw new NotFoundError(`Passage not found: ${passageId}`);

  const references = await detectCrossReferences(hydrated, await candidatePool(hydrated), MAX_REFS);

  for (const ref of references) {
    await addCrossReference({
      sourcePassageId: passageId,
      targetPassageId: ref.targetPassageId,
      type: ref.type,
      strength: ref.strength,
      notes: ref.notes,
      // A locally derived detection is stored as 'manual' so it is never
      // presented as a model judgment.
      detectedBy: ref.detectedBy === 'jev' ? 'jev' : 'manual',
      matchedSegments: [],
    });
  }

  return { references, computed: true };
}

/** Read stored references and rehydrate them into the API's shape. */
async function readStored(passageId: string): Promise<CrossRef[]> {
  // Both families, not only the one that triggered the short-circuit: a passage
  // with stored model references can also have detected quotations, and those are
  // the more checkable claim of the two.
  /*
   * The n-gram detector stores three kinds of match, and two of them are not
   * citations: `parallel` is a corpus repeating itself, and `duplicate` is the
   * same verse present in two collections — which the Pentateuch is, in both
   * `torah` and `ot`, so a filter applied after the fact was returning pages of
   * "OT cites Torah" that were one verse counted twice.
   *
   * Excluded in the query, not in the loop after it. `take` is applied before any
   * filtering, so filtering afterwards leaves a list of eight rows of which none
   * are cross-corpus, and the page looks broken rather than quiet. They are not
   * deleted and not counted as errors; `GET /api/passages/:id/citations` serves
   * the cross-corpus ones properly.
   */
  const rows = await prisma.crossReference.findMany({
    where: {
      OR: [{ sourcePassageId: passageId }, { targetPassageId: passageId }],
      NOT: { type: { in: SELF_REFERENCE_TYPES } },
    },
    orderBy: { strength: 'desc' },
    take: MAX_REFS,
    include: {
      sourcePassage: { select: { id: true, passageKey: true, textId: true } },
      targetPassage: { select: { id: true, passageKey: true, textId: true } },
    },
  });

  // A stored edge is a pair. Whatever way round it was written, the reference we
  // report is always "this passage points at the other one".
  return rows.map((row) => {
    const outgoing = row.sourcePassageId === passageId;
    const other = outgoing ? row.targetPassage : row.sourcePassage;
    return {
      targetPassageId: other.id,
      targetPassageKey: other.passageKey,
      targetText: other.textId as TextId,
      type: row.type as CrossRef['type'],
      strength: row.strength,
      direction: row.direction as CrossRef['direction'],
      notes: row.notes ?? '',
      detectedBy: (row.detectedBy as CrossRef['detectedBy']) ?? 'jev',
    };
  });
}

/**
 * Candidate neighbours: passages sharing the source's strongest themes, drawn
 * from other corpora first, since a cross-text link is the more useful finding
 * and a same-text neighbour is usually just the next verse.
 */
async function candidatePool(source: Passage): Promise<Passage[]> {
  const themes = source.themes.slice(0, 3).map((t) => t.theme);
  if (themes.length === 0) return [];

  const rows = await prisma.passageTheme.findMany({
    where: { themeId: { in: themes }, passage: { passageKey: { not: source.passageKey } } },
    include: { passage: { select: { passageKey: true, textId: true } } },
    orderBy: { score: 'desc' },
    take: CANDIDATES * 4,
  });

  const byText = new Map<TextId, string[]>();
  for (const row of rows) {
    const textId = row.passage.textId as TextId;
    if (!byText.has(textId)) byText.set(textId, []);
    byText.get(textId)!.push(row.passage.passageKey);
  }

  // Other corpora first, and in greater number. A cross-text link is the finding
  // worth surfacing; a same-text neighbour is usually just the adjacent verse.
  const otherCorpora = [...byText.entries()].filter(([textId]) => textId !== source.textId);
  const sameCorpus = byText.get(source.textId) ?? [];

  const perOtherCorpus = Math.max(2, Math.floor((CANDIDATES * 0.75) / Math.max(1, otherCorpora.length)));
  const chosen = [
    ...otherCorpora.flatMap(([, keys]) => take(keys, perOtherCorpus)),
    ...take(sameCorpus, Math.floor(CANDIDATES * 0.25)),
  ];

  return getPassagesByKeys([...new Set(chosen)]);
}

function take<T>(items: T[], count: number): T[] {
  return items.slice(0, Math.max(0, count));
}
