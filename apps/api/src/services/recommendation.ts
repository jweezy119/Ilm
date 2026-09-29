/**
 * Recommendation service
 *
 * Recommendations are ranked, never written. Candidates are retrieved and cheaply
 * ranked locally first, then Jev scores the survivors across five dimensions in a
 * single request. Composite scores are a weighted sum computed here, so moving a
 * weight slider never re-runs inference.
 */

import { Passage, TextId, RecommendationWeights, RecommendationRequest, RecommendationResponse, DEFAULT_WEIGHTS, ScoreBreakdown } from '@ilm/shared';
import {
  AFFINITY_DIMENSIONS,
  AffinityDimension,
  scoreCandidates,
  scoreAffinity,
  localAffinity,
  embeddingSimilarity,
  sharedThemes,
  sharedTerms,
  properNouns,
  ScoreSource,
} from './typesafe';
import { getPassageById, getPassagesByKeys, prisma } from './passage';
import { NotFoundError } from '../lib/errors';
import { searchIndex } from '../search/engine';

const ALL_TEXTS: TextId[] = ['quran', 'torah', 'talmud', 'ot', 'nt'];

/**
 * How many survivors get sent to Jev. Bounds one request's cost and latency.
 *
 * This is the most expensive request the app makes: five dimensions per candidate,
 * so twenty candidates is about 8,500 input tokens. Twelve is where the composite
 * ranking stopped moving in testing while costing 40% less, and the top 8 the
 * reader actually sees are unchanged. Raise it if the extra depth is worth the
 * tokens.
 */
const SHORTLIST_SIZE = Number(process.env.RECOMMEND_SHORTLIST ?? 12);

/** Candidate passages pulled per corpus before local ranking. */
const CANDIDATES_PER_TEXT = 120;

// ============================================================================
// AFFINITY CACHE
// ============================================================================

/**
 * Cached per-dimension scores for one ordered pair.
 *
 * The five dimensions are asked of the model once and do not depend on the
 * reader's weights — only the composite does. Caching the dimensions and
 * recomputing the composite on read is what makes a weight change free, and what
 * makes a second visit to a passage cost nothing.
 */
interface CachedAffinity {
  scores: ScoreBreakdown;
  source: ScoreSource;
  confidence: number;
}

function toCachedAffinity(row: { scores: unknown; source: string; confidence: number }): CachedAffinity | null {
  const scores = (row.scores ?? {}) as Record<string, unknown>;
  const numbers = AFFINITY_DIMENSIONS.map((dim) => scores[dim]);

  // A row missing any dimension is not usable: a partial row would silently pull
  // the composite down and read as a weaker relation than it is.
  if (numbers.some((n) => typeof n !== 'number')) return null;

  const dimensions = Object.fromEntries(AFFINITY_DIMENSIONS.map((dim, i) => [dim, numbers[i] as number]));
  return {
    scores: { ...dimensions, composite: 0 } as ScoreBreakdown,
    source: row.source === 'jev' ? 'jev' : 'derived',
    confidence: row.confidence,
  };
}

async function readCachedAffinities(sourcePassageId: string, targetIds: string[]): Promise<Map<string, CachedAffinity>> {
  if (targetIds.length === 0) return new Map();

  const rows = await prisma.passageAffinity.findMany({
    where: { sourcePassageId, targetPassageId: { in: targetIds } },
    select: { targetPassageId: true, scores: true, source: true, confidence: true },
  });

  const out = new Map<string, CachedAffinity>();
  for (const row of rows) {
    const cached = toCachedAffinity(row);
    if (cached) out.set(row.targetPassageId, cached);
  }
  return out;
}

/** Store freshly judged pairs, keyed on the ordered pair so the reverse is separate. */
async function writeCachedAffinities(
  sourcePassageId: string,
  entries: Array<{ targetPassageId: string; scores: ScoreBreakdown; source: ScoreSource; confidence: number }>
): Promise<void> {
  if (entries.length === 0) return;

  await prisma.$transaction(
    entries.map((entry) => {
      const { composite: _drop, ...dims } = entry.scores;
      return prisma.passageAffinity.upsert({
        where: { sourcePassageId_targetPassageId: { sourcePassageId, targetPassageId: entry.targetPassageId } },
        create: {
          sourcePassageId,
          targetPassageId: entry.targetPassageId,
          scores: dims as object,
          confidence: entry.confidence,
          source: entry.source,
        },
        update: { scores: dims as object, confidence: entry.confidence, source: entry.source },
      });
    })
  );
}

/** Recompute the composite from the current weights. Never stored. */
function withComposite(scores: ScoreBreakdown, weights: Record<AffinityDimension, number>): ScoreBreakdown {
  const dimensions = scores as unknown as Record<AffinityDimension, number>;
  return { ...scores, composite: AFFINITY_DIMENSIONS.reduce((sum, dim) => sum + dimensions[dim] * weights[dim], 0) };
}

// ============================================================================
// RECOMMENDATIONS
// ============================================================================

export interface ScoredRecommendation {
  passage: Passage;
  scores: ScoreBreakdown;
  source: ScoreSource;
  /** True when the dimension scores came from the cache rather than this request. */
  cached: boolean;
  confidence: number;
  matchedThemes: string[];
  matchedTerms: string[];
  reasoning: string;
}

export async function rankCandidates(
  source: Passage,
  weights: RecommendationWeights,
  options: { limit: number; excludeTexts?: TextId[]; excludeSameBook?: boolean; minScore?: number; shortlist?: number }
): Promise<{ ranked: ScoredRecommendation[]; source: ScoreSource; cachedCount: number }> {
  const { limit, excludeTexts, excludeSameBook } = options;
  const minScore = options.minScore ?? 0.15;
  const shortlistSize = options.shortlist ?? SHORTLIST_SIZE;

  const excluded = new Set(excludeTexts ?? []);
  const candidateKeys = await retrieveCandidateKeys(source, excluded, excludeSameBook ? source.book : undefined);

  if (candidateKeys.length === 0) return { ranked: [], source: 'derived', cachedCount: 0 };

  const candidates = await getPassagesByKeys(candidateKeys);
  if (candidates.length === 0) return { ranked: [], source: 'derived', cachedCount: 0 };

  // Stage 1: local ranking, no AI. Embeddings help when they exist; themes and
  // terms always do.
  const locally = candidates
    .map((candidate) => ({
      candidate,
      local: 0.7 * localAffinity(source, candidate) + 0.3 * embeddingSimilarity(source, candidate),
    }))
    .filter((c) => c.local > 0)
    .sort((a, b) => b.local - a.local);

  const shortlist = interleaveByText(locally.map((c) => c.candidate), Math.max(shortlistSize, limit * 2));

  if (shortlist.length === 0) return { ranked: [], source: 'derived', cachedCount: 0 };

  // Stage 2: Jev scores the shortlist in one request — but only the pairs that
  // have never been judged. A passage the reader has already visited, or a pair
  // scored before a weight change, is recombined from the cache instead.
  const cached = await readCachedAffinities(
    source.id,
    shortlist.map((p) => p.id)
  );
  const misses = shortlist.filter((p) => !cached.has(p.id));

  const fresh = misses.length > 0 ? await scoreCandidates(source, misses, weights as Record<AffinityDimension, number>) : [];

  if (fresh.length > 0) {
    await writeCachedAffinities(
      source.id,
      fresh.map((f) => ({ targetPassageId: f.candidate.id, scores: f.scores, source: f.source, confidence: f.confidence }))
    );
  }

  let cachedCount = 0;
  const scored = shortlist.map((candidate) => {
    const hit = cached.get(candidate.id);
    if (hit) {
      cachedCount += 1;
      return { candidate, scores: hit.scores, source: hit.source, confidence: hit.confidence, cached: true };
    }
    const judged = fresh.find((f) => f.candidate.id === candidate.id);
    if (!judged) return null;
    return { candidate, scores: judged.scores, source: judged.source, confidence: judged.confidence, cached: false };
  });

  // The composite is derived here from whichever dimension scores we ended up
  // with, so a cache hit and a fresh judgement are ranked on the same footing.
  const weighted = scored
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .map((s) => ({ ...s, scores: withComposite(s.scores, weights as Record<AffinityDimension, number>) }));

  const scoreSource: ScoreSource = weighted.some((s) => s.source === 'jev') ? 'jev' : 'derived';

  const ranked: ScoredRecommendation[] = weighted
    .filter((s) => s.scores.composite >= minScore)
    .map((s) => ({
      passage: s.candidate,
      scores: s.scores as ScoreBreakdown,
      source: s.source,
      cached: s.cached,
      confidence: s.confidence,
      matchedThemes: sharedThemes(source, s.candidate),
      matchedTerms: sharedTerms(source, s.candidate),
      reasoning: explain(s.scores, s.source),
    }))
    .sort((a, b) => b.scores.composite - a.scores.composite)
    .slice(0, limit);

  return { ranked, source: scoreSource, cachedCount };
}

/**
 * Candidate pool for a source passage.
 *
 * Built from Postgres rather than the search index: ranking index hits by
 * verse order and truncating systematically favours the start of whichever
 * corpus happens to carry the theme, which crowded out every other tradition.
 * Querying theme rows directly and capping per corpus keeps all five in play.
 */
async function retrieveCandidateKeys(
  source: Passage,
  excludedTexts: Set<TextId>,
  excludedBook?: string
): Promise<string[]> {
  const keys = new Set<string>();
  const allowedTexts = ALL_TEXTS.filter((t) => !excludedTexts.has(t));
  if (allowedTexts.length === 0) return [];

  const seedThemes = source.themes.slice(0, 4).map((t) => t.theme);

  if (seedThemes.length > 0) {
    // Cap per corpus so one large text cannot monopolise the shortlist.
    const perText = Math.ceil(CANDIDATES_PER_TEXT / allowedTexts.length);

    for (const textId of allowedTexts) {
      const rows = await prisma.passageTheme.findMany({
        where: { themeId: { in: seedThemes }, passage: { textId, passageKey: { not: source.passageKey } } },
        select: { passage: { select: { passageKey: true } } },
        orderBy: { score: 'desc' },
        take: perText,
      });
      for (const row of rows) keys.add(row.passage.passageKey);
    }
  }

  // Lexical neighbours, for passages whose themes are too sparse to match on.
  const term = [...source.themes.map((t) => t.theme), ...sharedTermSample(source.translation)].slice(0, 3).join(' ');
  if (term) {
    const byTerm = await searchIndex({
      term,
      textIds: allowedTexts,
      limit: CANDIDATES_PER_TEXT,
      properties: ['translation', 'themes'],
    });
    for (const hit of byTerm.hits) keys.add(hit.document.passageKey);
  }

  keys.delete(source.passageKey);

  if (excludedBook) {
    for (const passage of await getPassagesByKeys([...keys])) {
      if (passage.book === excludedBook) keys.delete(passage.passageKey);
    }
  }

  return [...keys];
}

/**
 * Take `size` passages round-robin across corpora, preserving each corpus's own
 * ranking order.
 *
 * Local affinity is a lexical measure, so it almost always scores the source's
 * own text highest and would hand the model a shortlist of near-duplicates.
 * Interleaving guarantees the other traditions actually get judged; the final
 * order is still decided purely by composite score, so a genuinely stronger
 * same-text passage can still win.
 */
function interleaveByText(ranked: Passage[], size: number): Passage[] {
  const byText = new Map<TextId, Passage[]>();
  for (const passage of ranked) {
    if (!byText.has(passage.textId)) byText.set(passage.textId, []);
    byText.get(passage.textId)!.push(passage);
  }

  // Source corpus first so its strongest match is never displaced, then the
  // others in corpus order for stable, predictable output.
  const queues = [...byText.entries()].sort((a, b) => b[1].length - a[1].length).map(([, list]) => list);

  const out: Passage[] = [];
  for (let round = 0; out.length < size; round += 1) {
    let added = false;
    for (const queue of queues) {
      if (round < queue.length) {
        out.push(queue[round]);
        added = true;
        if (out.length >= size) break;
      }
    }
    if (!added) break;
  }

  return out;
}

function sharedTermSample(translation: string): string[] {
  const counts = new Map<string, number>();
  for (const word of translation.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/)) {
    if (word.length <= 4) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 3)
    .map(([word]) => word);
}

export async function generateRecommendations(request: RecommendationRequest): Promise<RecommendationResponse> {
  const sourcePassage = await getPassageById(request.passageId);
  if (!sourcePassage) throw new NotFoundError(`Passage not found: ${request.passageId}`);

  const weights = normalizeWeights(request.weights);

  const { ranked, source, cachedCount } = await rankCandidates(sourcePassage, weights, {
    limit: request.limit ?? 10,
    excludeTexts: request.excludeTexts,
    excludeSameBook: request.excludeSameBook,
    minScore: request.minScore ?? 0.15,
  });

  return {
    recommendations: ranked.map((r) => ({
      passageId: r.passage.id,
      passageKey: r.passage.passageKey,
      textId: r.passage.textId,
      book: r.passage.book,
      chapter: r.passage.chapter,
      verse: r.passage.verse,
      preview: r.passage.translation.slice(0, 200),
      scores: r.scores,
      reasoning: r.reasoning,
      matchedThemes: r.matchedThemes,
      matchedTerms: r.matchedTerms,
      source: r.source,
      cached: r.cached,
    })),
    sourcePassage,
    weights,
    source,
    cachedCount,
    generatedAt: new Date(),
  };
}

/** Per-dimension breakdown for one pair, so the UI can show its working. */
export async function getRecommendationExplanation(
  sourcePassageId: string,
  targetPassageId: string,
  weights: RecommendationWeights = DEFAULT_WEIGHTS
): Promise<{
  scores: ScoreBreakdown;
  source: ScoreSource;
  /** True when these scores were read from the affinity cache. */
  cached: boolean;
  breakdown: Array<{ dimension: string; score: number; weight: number; contribution: number; evidence: string[] }>;
  summary: string;
}> {
  const [source, target] = await Promise.all([getPassageById(sourcePassageId), getPassageById(targetPassageId)]);
  if (!source || !target) throw new NotFoundError('One or both passages were not found');

  const resolved = normalizeWeights(weights);

  // The explanation asks for the same five dimensions the relations list already
  // scored for this pair, so it is read from the cache rather than asking the model
  // again. Clicking "why this passage?" should not cost a request.
  const cached = (await readCachedAffinities(source.id, [target.id])).get(target.id);

  const judged = cached
    ? { value: withComposite(cached.scores, resolved as Record<AffinityDimension, number>), source: cached.source, confidence: cached.confidence }
    : await scoreAffinity(source, target, resolved);

  const scores = judged.value as ScoreBreakdown;

  // Computed once. Calling this inside the filter below re-derived the set for
  // every candidate noun.
  const targetNouns = properNouns(target.translation);

  const evidence: Record<AffinityDimension, string[]> = {
    thematic: sharedThemes(source, target),
    linguistic: sharedTerms(source, target).slice(0, 10),
    historical: historicalEvidence(source, target),
    narrative: [...properNouns(source.translation)].filter((n) => targetNouns.has(n)),
    theological: sharedThemes(source, target).filter(isDoctrinal),
  };

  const breakdown = AFFINITY_DIMENSIONS.map((dim) => ({
    dimension: dim[0].toUpperCase() + dim.slice(1),
    score: scores[dim],
    weight: resolved[dim],
    contribution: scores[dim] * resolved[dim],
    evidence: evidence[dim],
  }));

  const top = [...breakdown].sort((a, b) => b.contribution - a.contribution).filter((b) => b.contribution > 0.02).slice(0, 3);

  return {
    scores,
    source: judged.source,
    cached: Boolean(cached),
    breakdown,
    summary:
      `Composite ${(scores.composite * 100).toFixed(1)}%` +
      (top.length ? `, led by ${top.map((b) => `${b.dimension.toLowerCase()} (${(b.contribution * 100).toFixed(1)}%)`).join(', ')}` : '') +
      `. Scores are ${judged.source === 'jev' ? 'Jev judgments combined with your weights' : 'local lexical and theme overlap — set TYPESAFE_API_KEY for semantic scoring'}.`,
  };
}

// ============================================================================
// THEMATIC EXPLORATION
// ============================================================================

export async function getThematicJourney(
  theme: string,
  texts?: TextId[],
  limit = 20
): Promise<Array<{
  passageId: string;
  passageKey: string;
  textId: TextId;
  book: string;
  chapter: number;
  verse: number;
  preview: string;
  score: number;
  chronologicalOrder: number;
}>> {
  const targetTexts = (texts?.length ? texts : ALL_TEXTS) as TextId[];

  const rows = await prisma.passageTheme.findMany({
    where: { themeId: theme, passage: { textId: { in: targetTexts } } },
    include: { passage: true },
    orderBy: { score: 'desc' },
    take: limit * 4,
  });

  const steps = rows.map((row) => ({
    passageId: row.passage.id,
    passageKey: row.passage.passageKey,
    textId: row.passage.textId as TextId,
    book: row.passage.bookSlug,
    chapter: row.passage.chapterNum,
    verse: row.passage.verseNum,
    preview: row.passage.primaryTranslation.slice(0, 200),
    score: row.score,
    chronologicalOrder: row.passage.verseOrder,
  }));

  /*
   * Selection and ordering are two different questions, and this used to answer
   * both with the score.
   *
   * Score decides *which* steps make the journey: the take above already ordered
   * by it, so the strongest instances of the theme are the ones available.
   * Chronological order decides how they are *shown*, grouped corpus by corpus.
   *
   * Sorting the output by score made the `chronologicalOrder` field dead weight —
   * it was in every response and nothing read it — and it made a journey read as
   * a ranked list rather than a walk through a text. `verseOrder` is only
   * meaningful within one corpus, so corpora are separated first; Genesis 1 and
   * Quran 19:1 have no common sequence and pretending otherwise puts them in a
   * false order.
   */
  return steps
    .sort((a, b) => ALL_TEXTS.indexOf(a.textId) - ALL_TEXTS.indexOf(b.textId) || a.chronologicalOrder - b.chronologicalOrder)
    .slice(0, limit);
}

export async function getThemeMap(theme: string): Promise<{
  center: string;
  related: Array<{ theme: string; sharedPassages: number; avgScore: number }>;
}> {
  const centerPassages = await prisma.passageTheme.findMany({
    where: { themeId: theme },
    select: { passageId: true },
    take: 500,
  });
  const passageIds = centerPassages.map((p) => p.passageId);
  if (passageIds.length === 0) return { center: theme, related: [] };

  const grouped = await prisma.passageTheme.groupBy({
    by: ['themeId'],
    where: { passageId: { in: passageIds }, themeId: { not: theme } },
    _count: { themeId: true },
    _avg: { score: true },
    orderBy: { _count: { themeId: 'desc' } },
    take: 20,
  });

  return {
    center: theme,
    related: grouped.map((g) => ({
      theme: g.themeId,
      sharedPassages: g._count.themeId,
      avgScore: g._avg.score ?? 0,
    })),
  };
}

// ============================================================================
// WEIGHTS
// ============================================================================

export async function getUserWeights(userId: string): Promise<RecommendationWeights> {
  const pref = await prisma.userPreference.findUnique({ where: { userId } });
  return normalizeWeights(pref?.weights as Partial<RecommendationWeights> | undefined);
}

export async function setUserWeights(userId: string, weights: RecommendationWeights): Promise<void> {
  const resolved = normalizeWeights(weights);
  await prisma.userPreference.upsert({
    where: { userId },
    create: { userId, weights: resolved },
    update: { weights: resolved },
  });
}

export async function resetUserWeights(userId: string): Promise<RecommendationWeights> {
  await setUserWeights(userId, DEFAULT_WEIGHTS);
  return DEFAULT_WEIGHTS;
}

/** Clamp into range and rescale so the five weights always sum to 1. */
export function normalizeWeights(weights?: Partial<RecommendationWeights>): RecommendationWeights {
  if (!weights) return DEFAULT_WEIGHTS;

  const clamped = AFFINITY_DIMENSIONS.map((dim) => Math.max(0, Math.min(1, weights[dim] ?? DEFAULT_WEIGHTS[dim])));
  const total = clamped.reduce((a, b) => a + b, 0);

  if (total === 0) return DEFAULT_WEIGHTS;
  if (Math.abs(total - 1) < 0.001) return Object.fromEntries(AFFINITY_DIMENSIONS.map((dim, i) => [dim, clamped[i]])) as RecommendationWeights;

  return Object.fromEntries(AFFINITY_DIMENSIONS.map((dim, i) => [dim, clamped[i] / total])) as RecommendationWeights;
}

// ============================================================================
// PRESENTATION HELPERS
// ============================================================================

const DIMENSION_LABEL: Record<AffinityDimension, string> = {
  thematic: 'thematic resonance',
  linguistic: 'shared terminology and roots',
  // Zero-weighted by default, so the label has to say why it is usually empty
  // rather than letting an empty bar read as "no historical link found".
  historical: 'historical connection (not measured here)',
  narrative: 'narrative parallel',
  // Overlaps `thematic` by construction and is weighted down accordingly; the
  // label says which theme labels are doctrinal so a reader can check the overlap
  // rather than discover it.
  theological: 'theological alignment (a subset of thematic resonance)',
};

/** A sentence built only from the numbers, so a recommendation never overstates. */
export function explain(scores: ScoreBreakdown, source: ScoreSource): string {
  const leaders = AFFINITY_DIMENSIONS.filter((dim) => scores[dim] >= 0.5).sort((a, b) => scores[b] - scores[a]);

  if (leaders.length === 0) {
    return `Composite ${(scores.composite * 100).toFixed(0)}% with no dimension above 50%. ${source === 'derived' ? 'Derived from local overlap, not semantic scoring.' : ''}`.trim();
  }

  const parts = leaders.map((dim) => `${DIMENSION_LABEL[dim]} (${(scores[dim] * 100).toFixed(0)}%)`);
  return `${parts.join('; ')}. Composite ${(scores.composite * 100).toFixed(0)}%.`;
}

function isDoctrinal(theme: string): boolean {
  return /salvation|redemption|covenant|law|messiah|judgment|forgiveness|mercy|atonement|resurrection|sin/.test(theme);
}

/**
 * Evidence for the historical dimension.
 *
 * Previously a fabricated sentence — "nt ↔ talmud" — attached to a fabricated
 * number, so the breakdown showed a real-looking citation for a relationship
 * nothing had measured. A reader checking that evidence would find it described
 * the corpora and not the passages.
 *
 * Now it reports the corpus pair as context, which is the one true thing known,
 * and nothing that implies a link between the two verses.
 */
function historicalEvidence(source: Passage, target: Passage): string[] {
  if (source.textId === target.textId) return [];
  return [`Corpus pair only: ${source.textId} and ${target.textId}. No claim about these two passages.`];
}
