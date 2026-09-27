/**
 * Comparison service
 *
 * Aligns 2-8 passages side by side, which is one column per corpus in TEXT_IDS plus
 * a few. Every pair is asked in a single batched Jev request (see
 * `computeAlignments`), and each pair's result is cached in Postgres, so revisiting
 * a comparison costs nothing and a partly-cached comparison only pays for the pairs
 * it is missing.
 */

import { Passage, ComparisonRequest, ComparisonResponse, Alignment, TextId } from '@ilm/shared';
import { computeAlignments, sharedPhrases, type MatchedSegment } from './typesafe';
import { getJevJudge } from './typesafe-client';
import { getPassagesByKeys, getPassageByKey, cacheAlignment, getCachedAlignment, prisma } from './passage';
import { NotFoundError } from '../lib/errors';

/** Below this, an alignment is not worth showing or caching. */
const MIN_INTERESTING_ALIGNMENT = 0.15;

/** Swap the two sides of a matched segment, for reversing a cached pair. */
function flipSegment(segment: MatchedSegment): MatchedSegment {
  return {
    textA: segment.textB,
    textB: segment.textA,
    startA: segment.startB,
    endA: segment.endB,
    startB: segment.startA,
    endB: segment.endA,
  };
}

export async function comparePassages(request: ComparisonRequest): Promise<ComparisonResponse> {
  const refs = request.passageIds;
  const passages = await getPassagesByKeys(refs);

  if (passages.length === 0) throw new NotFoundError(`None of these passages exist: ${refs.join(', ')}`);

  // Postgres returns rows in whatever order it likes, so restore the caller's order:
  // the panel grid is one column per passage and the reader chose that order.
  const byKey = new Map(passages.map((p) => [p.passageKey, p]));
  const ordered = refs.map((key) => byKey.get(key)).filter((p): p is Passage => Boolean(p));

  const missing = refs.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    // Silently dropping a requested passage is how a comparison ends up showing
    // four panels for a five-passage request.
    throw new NotFoundError(`No such passage: ${missing.join(', ')}`);
  }

  const options = request.options ?? {};
  const alignments: Alignment[] = [];
  let totalPairs = 0;
  let cachedPairs = 0;

  if (options.includeAlignments !== false) {
    const pairs: Array<[Passage, Passage]> = [];
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) pairs.push([ordered[i], ordered[j]]);
    }
    totalPairs = pairs.length;

    // A cached pair needs no question, so only the gaps are sent to the model —
    // which is what keeps a revisited comparison free.
    const cachedAlignments = new Map<number, Alignment>();
    const uncached: Array<[Passage, Passage]> = [];
    const pairIndex: number[] = [];

    await Promise.all(
      pairs.map(async ([a, b], index) => {
        // Cache key is order-independent; the response is not, so orient the
        // cached segments back into (a, b) order.
        const [keyLow, keyHigh] = [a.id, b.id].sort();

        const cached = await getCachedAlignment(keyLow, keyHigh);
        if (!cached) {
          uncached.push([a, b]);
          pairIndex.push(index);
          return;
        }
        cachedPairs += 1;
        const segments = ((cached.matchedSegments as unknown as MatchedSegment[]) ?? []).map((s) =>
          cached.sourcePassageId === a.id ? s : flipSegment(s)
        );
        cachedAlignments.set(index, {
          passageAId: a.id,
          passageBId: b.id,
          type: cached.type as Alignment['type'],
          strength: cached.strength,
          matchedSegments: segments,
          notes: cached.notes ?? '',
          // The stored row does not record which judge produced it, so a hit is
          // reported as derived rather than claiming a model answered.
          source: 'derived',
        });
      })
    );

    const computed = await computeAlignments(uncached);

    // Awaited rather than fired and forgotten: a rejected write would otherwise
    // surface as an unhandled rejection instead of a failed comparison.
    await Promise.all(
      computed.map((result, i) => {
        const [a, b] = uncached[i];
        const [keyLow, keyHigh] = [a.id, b.id].sort();
        const aIsSource = a.id === keyLow;

        return cacheAlignment(keyLow, keyHigh, {
          type: result.type,
          strength: result.strength,
          matchedSegments: result.matchedSegments,
          notes: result.notes,
        }).then(() => {
          cachedAlignments.set(pairIndex[i], {
            passageAId: a.id,
            passageBId: b.id,
            type: result.type,
            strength: result.strength,
            matchedSegments: aIsSource ? result.matchedSegments : result.matchedSegments.map(flipSegment),
            notes: result.notes,
            source: result.source,
          });
        });
      })
    );

    alignments.push(
      ...[...cachedAlignments.entries()]
        .sort(([i], [j]) => i - j)
        .map(([, alignment]) => alignment)
        .filter((a) => a.strength >= MIN_INTERESTING_ALIGNMENT)
    );
  }

  return {
    passages: ordered,
    alignments,
    sharedThemes: options.includeThemes === false ? [] : computeSharedThemes(ordered),
    crossReferences: options.includeCrossRefs === false ? [] : await computeCrossReferences(ordered),
    metadata: {
      textCount: new Set(ordered.map((p) => p.textId)).size,
      totalVerses: ordered.length,
      totalPairs,
      jevConfigured: getJevJudge().available,
      cachedPairs,
      generatedAt: new Date(),
    },
  };
}

/**
 * Cross-references between the compared passages only, from the rows ingestion
 * already found. Recomputing them would mean another Jev pass over every
 * neighbourhood, which is not what asking for a comparison should cost.
 */
async function computeCrossReferences(passages: Passage[]): Promise<ComparisonResponse['crossReferences']> {
  const ids = passages.map((p) => p.id);
  if (ids.length < 2) return [];

  const rows = await prisma.crossReference.findMany({
    where: { sourcePassageId: { in: ids }, targetPassageId: { in: ids } },
    orderBy: { strength: 'desc' },
    take: 50,
  });

  return rows.map((row) => ({
    sourcePassageId: row.sourcePassageId,
    targetPassageId: row.targetPassageId,
    type: row.type,
    strength: row.strength,
    notes: row.notes ?? '',
  }));
}

// ============================================================================
// SHARED THEMES
// ============================================================================

export function computeSharedThemes(passages: Passage[]): ComparisonResponse['sharedThemes'] {
  const byTheme = new Map<string, Map<string, { score: number; evidence: string[] }>>();

  for (const passage of passages) {
    for (const theme of passage.themes) {
      if (!byTheme.has(theme.theme)) byTheme.set(theme.theme, new Map());
      byTheme.get(theme.theme)!.set(passage.id, { score: theme.score, evidence: theme.evidence });
    }
  }

  const shared: ComparisonResponse['sharedThemes'] = [];
  for (const [theme, perPassage] of byTheme) {
    if (perPassage.size < 2) continue;

    const scores = [...perPassage.values()].map((v) => v.score);
    const passages: Record<string, string[]> = {};
    for (const [passageId, value] of perPassage) passages[passageId] = value.evidence;

    shared.push({ theme, passages, avgScore: scores.reduce((a, b) => a + b, 0) / scores.length });
  }

  return shared.sort((a, b) => b.avgScore - a.avgScore);
}

// ============================================================================
// PARALLEL TRANSLATIONS
// ============================================================================

export async function getParallelTranslations(
  textId: TextId,
  book: string,
  chapter: number,
  verse: number,
  translationNames?: string[]
): Promise<{ original: Passage; translations: Array<{ name: string; translator: string; text: string; isPrimary: boolean }> }> {
  const key = `${textId}:${book}:${chapter}:${verse}`;
  const passage = await getPassageByKey(key);
  if (!passage) throw new NotFoundError(`Passage not found: ${key}`);

  const rows = await prisma.passageTranslation.findMany({
    where: { passageId: passage.id },
    include: { translation: true },
  });

  const translations = rows.map((row) => ({
    name: row.translation.name,
    translator: row.translation.translator ?? row.translation.name,
    text: row.text,
    isPrimary: row.translation.isPrimary,
  }));

  return {
    original: passage,
    translations: translationNames?.length
      ? translations.filter((t) => translationNames.includes(t.name))
      : translations,
  };
}

// ============================================================================
// SHARED PHRASES (used by the frontend highlighter)
// ============================================================================

export function findSharedPhrases(a: Passage, b: Passage): MatchedSegment[] {
  return sharedPhrases(a.translation, b.translation);
}

// ============================================================================
// SHARE LINKS
// ============================================================================

/** Shareable link. The key is `keys` because that is what the /compare page reads. */
export function generateComparisonUrl(passageKeys: string[]): string {
  const params = new URLSearchParams();
  params.set('keys', passageKeys.join(','));
  return `/compare?${params.toString()}`;
}

export function parseComparisonUrl(url: string): string[] {
  const query = url.split('?')[1] ?? '';
  const keys = new URLSearchParams(query).get('keys') ?? new URLSearchParams(query).get('compare');
  return keys ? keys.split(',').filter(Boolean) : [];
}
