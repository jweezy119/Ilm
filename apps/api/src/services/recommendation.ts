/**
 * Recommendation Service - Pure scoring-based recommendations
 * NO INFERENCES - only weighted composite scores from Jev judgments
 */

import { PrismaClient } from '@prisma/client';
import { Passage, TextId, RecommendationWeights, RecommendationRequest, RecommendationResponse, DEFAULT_WEIGHTS, ScoreBreakdown } from '@ilm/shared';
import { 
  scoreThematicAffinity, 
  scoreLinguisticAffinity, 
  scoreHistoricalAffinity, 
  scoreNarrativeAffinity, 
  scoreTheologicalAffinity,
  computeRecommendationScores 
} from './typesafe';
import { getPassageById, getPassagesByText, getPassageThemes } from './passage';

const prisma = new PrismaClient();

// ============================================================================
// RECOMMENDATION ENGINE
// ============================================================================

/**
 * Generate recommendations for a passage based on scored affinities
 * PURE SCORING - no generated inferences, only weighted Jev scores
 */
export async function generateRecommendations(
  request: RecommendationRequest
): Promise<RecommendationResponse> {
  const sourcePassage = await getPassageById(request.passageId);
  if (!sourcePassage) {
    throw new Error(`Source passage not found: ${request.passageId}`);
  }
  
  const weights = request.weights || DEFAULT_WEIGHTS;
  
  // Get candidate passages
  let candidates: Passage[];
  
  if (request.excludeTexts?.length) {
    // Get from all texts except excluded
    const allTexts: TextId[] = ['quran', 'talmud', 'torah', 'ot', 'nt'];
    const allowedTexts = allTexts.filter(t => !request.excludeTexts!.includes(t));
    
    candidates = [];
    for (const textId of allowedTexts) {
      const passages = await getPassagesByText(textId, 500); // Limit per text
      candidates.push(...passages);
    }
  } else {
    // Get from all texts
    candidates = [];
    for (const textId of ['quran', 'talmud', 'torah', 'ot', 'nt'] as TextId[]) {
      const passages = await getPassagesByText(textId, 500);
      candidates.push(...passages);
    }
  }
  
  // Filter out same passage
  candidates = candidates.filter(p => p.id !== sourcePassage.id);
  
  // Filter out same book if requested
  if (request.excludeSameBook) {
    candidates = candidates.filter(p => p.book !== sourcePassage.book);
  }
  
  // Compute scores using Jev
  const scored = await computeRecommendationScores(sourcePassage, candidates, weights);
  
  // Apply minimum score threshold
  const filtered = scored.filter(r => r.scores.composite >= (request.minScore || 0.15));
  
  // Limit results
  const limited = filtered.slice(0, request.limit || 10);
  
  // Format response
  const recommendations = limited.map(r => ({
    passageId: r.passage.id,
    textId: r.passage.textId,
    book: r.passage.book,
    chapter: r.passage.chapter,
    verse: r.passage.verse,
    preview: r.passage.translation.substring(0, 200),
    scores: r.scores,
    reasoning: r.reasoning,
    matchedThemes: r.matchedThemes,
    matchedTerms: r.matchedTerms,
  }));
  
  return {
    recommendations,
    sourcePassage,
    weights,
    generatedAt: new Date(),
  };
}

/**
 * Get recommendation explanation - breaks down scores for transparency
 */
export async function getRecommendationExplanation(
  sourcePassageId: string,
  targetPassageId: string,
  weights: RecommendationWeights = DEFAULT_WEIGHTS
): Promise<{
  scores: ScoreBreakdown;
  breakdown: {
    dimension: string;
    score: number;
    weight: number;
    contribution: number;
    evidence: string[];
  }[];
  summary: string;
}> {
  const [source, target] = await Promise.all([
    getPassageById(sourcePassageId),
    getPassageById(targetPassageId),
  ]);
  
  if (!source || !target) {
    throw new Error('Passage not found');
  }
  
  // Compute individual scores
  const [thematic, linguistic, historical, narrative, theological] = await Promise.all([
    scoreThematicAffinity(source, target),
    scoreLinguisticAffinity(source, target),
    scoreHistoricalAffinity(source, target),
    scoreNarrativeAffinity(source, target),
    scoreTheologicalAffinity(source, target),
  ]);
  
  const composite = 
    thematic * weights.thematic +
    linguistic * weights.linguistic +
    historical * weights.historical +
    narrative * weights.narrative +
    theological * weights.theological;
  
  const breakdown = [
    {
      dimension: 'Thematic',
      score: thematic,
      weight: weights.thematic,
      contribution: thematic * weights.thematic,
      evidence: findThematicEvidence(source, target),
    },
    {
      dimension: 'Linguistic',
      score: linguistic,
      weight: weights.linguistic,
      contribution: linguistic * weights.linguistic,
      evidence: findLinguisticEvidence(source, target),
    },
    {
      dimension: 'Historical',
      score: historical,
      weight: weights.historical,
      contribution: historical * weights.historical,
      evidence: findHistoricalEvidence(source, target),
    },
    {
      dimension: 'Narrative',
      score: narrative,
      weight: weights.narrative,
      contribution: narrative * weights.narrative,
      evidence: findNarrativeEvidence(source, target),
    },
    {
      dimension: 'Theological',
      score: theological,
      weight: weights.theological,
      contribution: theological * weights.theological,
      evidence: findTheologicalEvidence(source, target),
    },
  ];
  
  const summary = `Composite score: ${(composite * 100).toFixed(1)}%. ` +
    `Top factors: ${breakdown
      .filter(b => b.contribution > 0.05)
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3)
      .map(b => `${b.dimension} (${(b.contribution * 100).toFixed(1)}%)`)
      .join(', ')}.`;
  
  return {
    scores: { thematic, linguistic, historical, narrative, theological, composite },
    breakdown,
    summary,
  };
}

/**
 * Get thematic journey - trace a theme across texts chronologically
 */
export async function getThematicJourney(
  theme: string,
  texts?: TextId[],
  limit = 20
): Promise<Array<{
  passageId: string;
  textId: TextId;
  book: string;
  chapter: number;
  verse: number;
  preview: string;
  score: number;
  chronologicalOrder: number;
}>> {
  const targetTexts = texts || ['quran', 'talmud', 'torah', 'ot', 'nt'] as TextId[];
  
  // Find passages with this theme
  const passageThemes = await prisma.passageTheme.findMany({
    where: {
      themeId: theme,
      passage: {
        textId: { in: targetTexts },
      },
    },
    include: {
      passage: {
        include: {
          themes: { include: { theme: true } },
        },
      },
    },
    orderBy: { score: 'desc' },
    take: limit * 2,
  });
  
  // Sort by chronological order within each text
  const results = passageThemes
    .map(pt => ({
      passageId: pt.passage.id,
      textId: pt.passage.textId as TextId,
      book: pt.passage.bookId,
      chapter: pt.passage.chapterNum,
      verse: pt.passage.verseNum,
      preview: pt.passage.primaryTranslation.substring(0, 200),
      score: pt.score,
      chronologicalOrder: pt.passage.verseOrder,
    }))
    .sort((a, b) => a.chronologicalOrder - b.chronologicalOrder)
    .slice(0, limit);
  
  return results;
}

/**
 * Get theme map - related themes network
 */
export async function getThemeMap(theme: string): Promise<{
  center: string;
  related: Array<{ theme: string; cooccurrence: number; passages: number }>;
}> {
  // Find passages with the center theme
  const centerPassages = await prisma.passageTheme.findMany({
    where: { themeId: theme },
    select: { passageId: true },
  });
  
  const passageIds = centerPassages.map(p => p.passageId);
  
  // Find co-occurring themes
  const cooccurring = await prisma.passageTheme.groupBy({
    by: ['themeId'],
    where: {
      passageId: { in: passageIds },
      themeId: { not: theme },
    },
    _count: { themeId: true },
    _avg: { score: true },
    orderBy: { _count: { themeId: 'desc' } },
    take: 20,
  });
  
  return {
    center: theme,
    related: cooccurring.map(c => ({
      theme: c.themeId,
      cooccurrence: c._avg.score || 0,
      passages: c._count.themeId,
    })),
  };
}

// ============================================================================
// WEIGHT MANAGEMENT
// ============================================================================

export async function getUserWeights(userId: string): Promise<RecommendationWeights> {
  const pref = await prisma.userPreference.findUnique({ where: { userId } });
  return pref?.weights as RecommendationWeights || DEFAULT_WEIGHTS;
}

export async function setUserWeights(userId: string, weights: RecommendationWeights): Promise<void> {
  await prisma.userPreference.upsert({
    where: { userId },
    create: { userId, weights },
    update: { weights },
  });
}

export async function resetUserWeights(userId: string): Promise<RecommendationWeights> {
  await prisma.userPreference.upsert({
    where: { userId },
    create: { userId, weights: DEFAULT_WEIGHTS },
    update: { weights: DEFAULT_WEIGHTS },
  });
  return DEFAULT_WEIGHTS;
}

// ============================================================================
// EVIDENCE FINDERS (for transparency)
// ============================================================================

function findThematicEvidence(source: Passage, target: Passage): string[] {
  const sharedThemes = new Set(source.themes.map(t => t.theme))
    .intersection(new Set(target.themes.map(t => t.theme)));
  return [...sharedThemes].slice(0, 5);
}

function findLinguisticEvidence(source: Passage, target: Passage): string[] {
  // Extract significant terms from both
  const terms1 = extractTerms(source.translation);
  const terms2 = extractTerms(target.translation);
  const shared = [...terms1].filter(t => terms2.has(t));
  return shared.slice(0, 10);
}

function findHistoricalEvidence(source: Passage, target: Passage): string[] {
  // In production, use historical metadata
  const evidence: string[] = [];
  if (source.textId === target.textId) {
    evidence.push(`Same text (${source.textId})`);
  }
  // Check for known historical connections
  const connections = getKnownHistoricalConnections(source.textId, target.textId);
  evidence.push(...connections);
  return evidence.slice(0, 3);
}

function findNarrativeEvidence(source: Passage, target: Passage): string[] {
  // Extract proper nouns (names, places)
  const names1 = extractProperNouns(source.translation);
  const names2 = extractProperNouns(target.translation);
  const shared = [...names1].filter(n => names2.has(n));
  return shared.slice(0, 5);
}

function findTheologicalEvidence(source: Passage, target: Passage): string[] {
  // Use theme overlap as proxy for theological concepts
  const sharedThemes = findThematicEvidence(source, target);
  return sharedThemes.filter(t => 
    ['salvation', 'redemption', 'covenant', 'law', 'messiah', 'judgment', 'forgiveness', 'mercy'].includes(t)
  );
}

function extractTerms(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
    'a', 'an', 'his', 'her', 'its', 'their', 'our', 'your', 'my', 'me',
    'he', 'she', 'it', 'they', 'we', 'you', 'i', 'him', 'them', 'us',
    'lord', 'god', 'lord', 'said', 'say', 'unto', 'upon', 'shall', 'will',
  ]);
  
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s']/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w))
  );
}

function extractProperNouns(text: string): Set<string> {
  // Simple proper noun extraction (capitalized words)
  const words = text.match(/\b[A-Z][a-z]+\b/g) || [];
  return new Set(words.filter(w => w.length > 2));
}

function getKnownHistoricalConnections(textA: TextId, textB: TextId): string[] {
  const connections: Record<string, Record<string, string[]>> = {
    quran: {
      ot: ['Shared Abrahamic narratives', 'Moses/Exodus parallels', 'Psalms echoes'],
      nt: ['Jesus/Mary narratives', 'Gospel parallels', 'Pauline theology contrasts'],
      torah: ['Direct Torah narratives', 'Legal parallels', 'Covenant theology'],
      talmud: ['Rabbinic parallels', 'Legal methodology', 'Scriptural interpretation'],
    },
    ot: {
      quran: ['Shared Abrahamic narratives', 'Prophetic figures', 'Legal parallels'],
      nt: ['Messianic prophecies', 'Typology', 'Direct quotations'],
      torah: ['Same text (Pentateuch)', 'Identical narratives'],
      talmud: ['Rabbinic interpretation', 'Midrashic expansion'],
    },
    nt: {
      quran: ['Jesus narratives', 'Mary narratives', 'Eschatological parallels'],
      ot: ['Fulfillment citations', 'Typological reading', 'Septuagint influence'],
      torah: ['Jesus as prophet like Moses', 'New covenant theology'],
      talmud: ['Contemporary Judaism context', 'Halakhic debates'],
    },
    torah: {
      quran: ['Direct narrative parallels', 'Legal similarities'],
      ot: ['Identical text (Pentateuch)'],
      nt: ['Foundation for Gospel narratives'],
      talmud: ['Basis for Mishnah/Gemara'],
    },
    talmud: {
      quran: ['Rabbinic-Jewish context', 'Legal parallels'],
      ot: ['Scriptural interpretation'],
      nt: ['Second Temple Judaism context'],
      torah: ['Oral Torah on Written Torah'],
    },
  };
  
  return connections[textA]?.[textB] || [];
}