/**
 * Comparison service
 *
 * Aligns 2-5 passages side by side. Each pair gets one Jev request (noul gate,
 * type, strength) whose result is cached in Postgres, so revisiting a comparison
 * costs nothing.
 */

import { Passage, ComparisonRequest, ComparisonResponse, Alignment, TextId } from '@ilm/shared';
import { computeAlignment, sharedPhrases, type MatchedSegment } from './typesafe';
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

  const alignments: Alignment[] = [];

  if (request.options?.includeAlignments !== false) {
    const pairs: Array<[Passage, Passage]> = [];
    for (let i = 0; i < passages.length; i += 1) {
      for (let j = i + 1; j < passages.length; j += 1) pairs.push([passages[i], passages[j]]);
    }

    const computed = await Promise.all(
      pairs.map(async ([a, b]) => {
        // Cache key is order-independent; the response is not, so orient the
        // cached segments back into (a, b) order.
        const [keyLow, keyHigh] = [a.id, b.id].sort();
        const aIsSource = a.id === keyLow;

        const cached = await getCachedAlignment(keyLow, keyHigh);
        if (cached) {
          const segments = ((cached.matchedSegments as unknown as MatchedSegment[]) ?? []).map((s) =>
            cached.sourcePassageId === a.id ? s : flipSegment(s)
          );
          return {
            passageAId: a.id,
            passageBId: b.id,
            type: cached.type as Alignment['type'],
            strength: cached.strength,
            matchedSegments: segments,
            notes: cached.notes ?? '',
          } satisfies Alignment;
        }

        const result = await computeAlignment(a, b);
        if (result.strength < MIN_INTERESTING_ALIGNMENT) return null;

        await cacheAlignment(keyLow, keyHigh, {
          type: result.type,
          strength: result.strength,
          matchedSegments: result.matchedSegments,
          notes: result.notes,
        });

        return {
          passageAId: a.id,
          passageBId: b.id,
          type: result.type,
          strength: result.strength,
          matchedSegments: aIsSource ? result.matchedSegments : result.matchedSegments.map(flipSegment),
          notes: result.notes,
        } satisfies Alignment;
      })
    );

    alignments.push(...computed.filter((a): a is Alignment => a !== null));
  }

  return {
    passages,
    alignments,
    sharedThemes: computeSharedThemes(passages),
    metadata: {
      textCount: new Set(passages.map((p) => p.textId)).size,
      totalVerses: passages.length,
      generatedAt: new Date(),
    },
  };
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
