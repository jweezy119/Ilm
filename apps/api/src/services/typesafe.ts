/**
 * TypeSafe Service - Core AI Intelligence Layer
 * Uses Jev (TypeSafe's System One model) for semantic judgments
 * All recommendations are SCORE-BASED only - no generated inferences
 */

import { createTypeSafeClient, TypeSafeClient, ScoreResult, ChoiceResult, NoulResult } from './typesafe-client';
import { Passage, ThemeScore, CrossRef, CrossRefType, TextId, THEME_TAXONOMY, Theme } from '@ilm/shared';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// TypeSafe client - initialized lazily
let typesafeClient: TypeSafeClient | null = null;

function getTypeSafeClient(): TypeSafeClient {
  if (!typesafeClient) {
    const apiKey = process.env.TYPESAFE_API_KEY;
    typesafeClient = createTypeSafeClient(apiKey);
  }
  return typesafeClient;
}

// ============================================================================
// JEV PRIMITIVE WRAPPERS
// ============================================================================

/**
 * Score primitive: Degree along a described dimension (0-5 levels)
 * Returns probability-weighted position on ordered levels
 */
export async function jejScore<T extends Record<string, unknown>>(
  question: string,
  state: T,
  criteria: Array<{ level: number; description: string }>
): Promise<{ score: number; confidence: number; distribution: Record<number, number> }> {
  const client = getTypeSafeClient();
  const result = await client.score({
    question,
    state,
    criteria,
  });
  return {
    score: result.score / 5, // Normalize to 0-1
    confidence: result.confidence,
    distribution: result.distribution,
  };
}

/**
 * Choice primitive: One of a defined set
 * Returns probability distribution over options
 */
export async function jejChoice<T extends Record<string, unknown>>(
  question: string,
  state: T,
  options: Array<{ id: string; label: string; description?: string }>
): Promise<{ choice: string; confidence: number; distribution: Record<string, number> }> {
  const client = getTypeSafeClient();
  const result = await client.choice({
    question,
    state,
    criteria: options.map((o, i) => ({ level: i, description: o.description || o.label })),
  });
  return {
    choice: options[result.choice]?.id || 'unknown',
    confidence: result.confidence,
    distribution: result.distribution,
  };
}

/**
 * Noul primitive: Whether a condition holds (probability of yes)
 */
export async function jejNoul<T extends Record<string, unknown>>(
  question: string,
  state: T
): Promise<{ probability: number; confidence: number }> {
  const client = getTypeSafeClient();
  const result = await client.noul({
    question,
    state,
  });
  return {
    probability: result.probability,
    confidence: result.confidence,
  };
}

// ============================================================================
// SEMANTIC INDEXING PIPELINE
// ============================================================================

/**
 * Score semantic density/richness of a passage (0-1)
 * Used for indexing priority and search ranking boost
 */
export async function scoreSemanticDensity(passage: Passage): Promise<number> {
  const result = await jejScore(
    'How semantically dense and conceptually rich is this religious text passage?',
    {
      text: passage.originalText,
      translation: passage.translation,
      textId: passage.textId,
      book: passage.book,
      chapter: passage.chapter,
      verse: passage.verse,
    },
    [
      { level: 0, description: 'Minimal content, purely functional/structural' },
      { level: 1, description: 'Basic narrative or legal statement, single concept' },
      { level: 2, description: 'Multiple concepts, some theological depth' },
      { level: 3, description: 'Rich theological/ethical content, multiple layers' },
      { level: 4, description: 'Dense with meaning, profound theological significance' },
      { level: 5, description: 'Exceptionally rich, foundational doctrinal passage' },
    ]
  );
  return result.score;
}

/**
 * Classify passage themes using Jev Choice over known taxonomy
 * Returns top themes with scores
 */
export async function classifyThemes(passage: Passage, maxThemes: number = 5): Promise<ThemeScore[]> {
  const themeOptions = THEME_TAXONOMY.map(t => ({ id: t, label: t, description: `Theme: ${t}` }));
  
  const results: ThemeScore[] = [];
  
  // Run multiple choice judgments for top themes
  for (let i = 0; i < Math.min(maxThemes * 2, themeOptions.length); i++) {
    const result = await jejChoice(
      `Which theme from the taxonomy is MOST prominently addressed in this passage?`,
      {
        text: passage.originalText,
        translation: passage.translation,
        textId: passage.textId,
        excludedThemes: results.map(r => r.theme),
      },
      themeOptions.filter(o => !results.map(r => r.theme).includes(o.id))
    );
    
    if (result.confidence < 0.3) break; // Low confidence, stop
    
    // Now score the strength of this theme
    const scoreResult = await jejScore(
      `How strongly does this passage embody the theme "${result.choice}"?`,
      {
        text: passage.originalText,
        translation: passage.translation,
        theme: result.choice,
      },
      [
        { level: 0, description: 'Theme not present' },
        { level: 1, description: 'Theme barely mentioned' },
        { level: 2, description: 'Theme present but not central' },
        { level: 3, description: 'Theme clearly addressed' },
        { level: 4, description: 'Theme is central to passage' },
        { level: 5, description: 'Passage is definitive for this theme' },
      ]
    );
    
    results.push({
      theme: result.choice,
      score: scoreResult.score,
      confidence: Math.min(result.confidence, scoreResult.confidence),
      evidence: extractEvidence(passage.translation, result.choice),
      source: 'jev',
    });
    
    if (results.length >= maxThemes) break;
  }
  
  return results.sort((a, b) => b.score - a.score);
}

/**
 * Detect cross-references between a passage and candidate passages
 * Uses Jev Noul for binary detection + Score for strength
 */
export async function detectCrossReferences(
  sourcePassage: Passage,
  candidatePassages: Passage[],
  maxRefs: number = 10
): Promise<CrossRef[]> {
  const refs: CrossRef[] = [];
  
  for (const candidate of candidatePassages) {
    if (candidate.id === sourcePassage.id) continue;
    
    // First check: is there ANY meaningful connection?
    const hasConnection = await jejNoul(
      'Do these two religious text passages share a meaningful connection (quote, allusion, thematic parallel, linguistic link, or narrative parallel)?',
      {
        sourceText: sourcePassage.originalText,
        sourceTranslation: sourcePassage.translation,
        sourceTextId: sourcePassage.textId,
        targetText: candidate.originalText,
        targetTranslation: candidate.translation,
        targetTextId: candidate.textId,
      }
    );
    
    if (hasConnection.probability < 0.4) continue;
    
    // Classify connection type
    const typeResult = await jejChoice(
      'What type of connection exists between these passages?',
      {
        sourceText: sourcePassage.originalText,
        sourceTranslation: sourcePassage.translation,
        targetText: candidate.originalText,
        targetTranslation: candidate.translation,
      },
      [
        { id: 'quote', label: 'Direct Quote', description: 'Verbatim or near-verbatim quotation' },
        { id: 'allusion', label: 'Allusion', description: 'Indirect reference or echo' },
        { id: 'thematic', label: 'Thematic Parallel', description: 'Same theme, different expression' },
        { id: 'linguistic', label: 'Linguistic Cognate', description: 'Shared terminology/roots/cognates' },
        { id: 'narrative', label: 'Narrative Parallel', description: 'Same story/event/character' },
        { id: 'theological', label: 'Theological Echo', description: 'Same doctrinal concept' },
      ]
    );
    
    // Score strength
    const strengthResult = await jejScore(
      `How strong is the ${typeResult.choice} connection between these passages?`,
      {
        sourceText: sourcePassage.originalText,
        sourceTranslation: sourcePassage.translation,
        targetText: candidate.originalText,
        targetTranslation: candidate.translation,
        connectionType: typeResult.choice,
      },
      [
        { level: 0, description: 'Negligible connection' },
        { level: 1, description: 'Weak, possibly coincidental' },
        { level: 2, description: 'Moderate, clear but not strong' },
        { level: 3, description: 'Strong, significant connection' },
        { level: 4, description: 'Very strong, major parallel' },
        { level: 5, description: 'Definitive, foundational connection' },
      ]
    );
    
    if (strengthResult.score < 0.3) continue;
    
    refs.push({
      targetPassageId: candidate.id,
      targetText: candidate.textId,
      type: typeResult.choice as CrossRefType,
      strength: strengthResult.score,
      direction: 'bidirectional',
      notes: `Jev ${typeResult.choice} detection: ${strengthResult.confidence.toFixed(2)} confidence`,
      detectedBy: 'jev',
    });
    
    if (refs.length >= maxRefs) break;
  }
  
  return refs.sort((a, b) => b.strength - a.strength);
}

/**
 * Compute alignment between two passages for side-by-side comparison
 */
export async function computeAlignment(
  passageA: Passage,
  passageB: Passage
): Promise<{
  type: string;
  strength: number;
  matchedSegments: Array<{
    textA: string;
    textB: string;
    startA: number;
    endA: number;
    startB: number;
    endB: number;
  }>;
  notes: string;
}> {
  // Check for alignment
  const hasAlignment = await jejNoul(
    'Do these two passages align in a way useful for side-by-side comparison (shared theme, quote, parallel, linguistic link)?',
    {
      textA: passageA.originalText,
      translationA: passageA.translation,
      textIdA: passageA.textId,
      textB: passageB.originalText,
      translationB: passageB.translation,
      textIdB: passageB.textId,
    }
  );
  
  if (hasAlignment.probability < 0.35) {
    return {
      type: 'none',
      strength: 0,
      matchedSegments: [],
      notes: 'No significant alignment detected',
    };
  }
  
  // Classify alignment type
  const typeResult = await jejChoice(
    'What type of alignment best describes the relationship between these passages?',
    {
      textA: passageA.originalText,
      translationA: passageA.translation,
      textB: passageB.originalText,
      translationB: passageB.translation,
    },
    [
      { id: 'direct_quote', label: 'Direct Quote', description: 'Verbatim quotation' },
      { id: 'strong_allusion', label: 'Strong Allusion', description: 'Clear indirect reference' },
      { id: 'thematic_parallel', label: 'Thematic Parallel', description: 'Same theme developed similarly' },
      { id: 'linguistic_cognate', label: 'Linguistic Cognate', description: 'Shared terminology/etymology' },
      { id: 'narrative_parallel', label: 'Narrative Parallel', description: 'Same story/event' },
      { id: 'theological_echo', label: 'Theological Echo', description: 'Same doctrinal concept' },
    ]
  );
  
  // Score strength
  const strengthResult = await jejScore(
    `How strong is the ${typeResult.choice} alignment between these passages?`,
    {
      textA: passageA.originalText,
      translationA: passageA.translation,
      textB: passageB.originalText,
      translationB: passageB.translation,
      alignmentType: typeResult.choice,
    },
    [
      { level: 0, description: 'No alignment' },
      { level: 1, description: 'Faint trace' },
      { level: 2, description: 'Weak alignment' },
      { level: 3, description: 'Moderate alignment' },
      { level: 4, description: 'Strong alignment' },
      { level: 5, description: 'Exceptional alignment' },
    ]
  );
  
  // Extract matched segments (simplified - in production use more sophisticated extraction)
  const matchedSegments = extractMatchedSegments(
    passageA.translation,
    passageB.translation,
    typeResult.choice
  );
  
  return {
    type: typeResult.choice,
    strength: strengthResult.score,
    matchedSegments,
    notes: `Jev ${typeResult.choice}: ${strengthResult.confidence.toFixed(2)} confidence`,
  };
}

// ============================================================================
// RECOMMENDATION ENGINE (SCORING-BASED ONLY)
// ============================================================================

export interface RecommendationWeights {
  thematic: number;
  linguistic: number;
  historical: number;
  narrative: number;
  theological: number;
}

export const DEFAULT_WEIGHTS: RecommendationWeights = {
  thematic: 0.3,
  linguistic: 0.2,
  historical: 0.15,
  narrative: 0.15,
  theological: 0.2,
};

/**
 * Score thematic affinity between two passages (0-1)
 * PURE SCORING - no inference generation
 */
export async function scoreThematicAffinity(passageA: Passage, passageB: Passage): Promise<number> {
  const result = await jejScore(
    'How strongly do these two passages share thematic content?',
    {
      textA: passageA.originalText,
      translationA: passageA.translation,
      themesA: passageA.themes.map(t => `${t.theme}:${t.score.toFixed(2)}`).join(', '),
      textB: passageB.originalText,
      translationB: passageB.translation,
      themesB: passageB.themes.map(t => `${t.theme}:${t.score.toFixed(2)}`).join(', '),
    },
    [
      { level: 0, description: 'No thematic overlap' },
      { level: 1, description: 'Superficial word overlap only' },
      { level: 2, description: 'Related but distinct themes' },
      { level: 3, description: 'Clear shared theme with different emphasis' },
      { level: 4, description: 'Same core theme, complementary perspectives' },
      { level: 5, description: 'Directly addressing identical theme with deep resonance' },
    ]
  );
  return result.score;
}

/**
 * Score linguistic affinity (shared terminology, roots, cognates)
 */
export async function scoreLinguisticAffinity(passageA: Passage, passageB: Passage): Promise<number> {
  const result = await jejScore(
    'How much shared terminology, linguistic roots, or cognates exist between these passages in their original languages?',
    {
      originalA: passageA.originalText,
      translationA: passageA.translation,
      langA: passageA.metadata.language,
      originalB: passageB.originalText,
      translationB: passageB.translation,
      langB: passageB.metadata.language,
    },
    [
      { level: 0, description: 'No linguistic connection' },
      { level: 1, description: 'Only common function words' },
      { level: 2, description: 'Some shared religious terminology' },
      { level: 3, description: 'Significant shared vocabulary/roots' },
      { level: 4, description: 'Strong linguistic parallels, cognates' },
      { level: 5, description: 'Direct linguistic derivation or shared source language' },
    ]
  );
  return result.score;
}

/**
 * Score historical/contextual affinity
 */
export async function scoreHistoricalAffinity(passageA: Passage, passageB: Passage): Promise<number> {
  const result = await jejScore(
    'How strong is the historical or contextual connection between these passages (same period, related communities, historical influence)?',
    {
      textA: passageA.translation,
      textIdA: passageA.textId,
      bookA: passageA.book,
      chapterA: passageA.chapter,
      textB: passageB.translation,
      textIdB: passageB.textId,
      bookB: passageB.book,
      chapterB: passageB.chapter,
    },
    [
      { level: 0, description: 'No historical connection' },
      { level: 1, description: 'Vague temporal proximity' },
      { level: 2, description: 'Same general era/region' },
      { level: 3, description: 'Clear historical relationship' },
      { level: 4, description: 'Direct historical influence/response' },
      { level: 5, description: 'Contemporaneous, directly interacting communities' },
    ]
  );
  return result.score;
}

/**
 * Score narrative affinity (shared stories, characters, events)
 */
export async function scoreNarrativeAffinity(passageA: Passage, passageB: Passage): Promise<number> {
  const result = await jejScore(
    'Do these passages share narrative elements (same story, characters, events, locations)?',
    {
      textA: passageA.translation,
      textIdA: passageA.textId,
      textB: passageB.translation,
      textIdB: passageB.textId,
    },
    [
      { level: 0, description: 'No narrative connection' },
      { level: 1, description: 'Generic narrative tropes only' },
      { level: 2, description: 'Similar narrative structure' },
      { level: 3, description: 'Shared characters or events' },
      { level: 4, description: 'Same story from different perspectives' },
      { level: 5, description: 'Identical narrative core' },
    ]
  );
  return result.score;
}

/**
 * Score theological/doctrinal affinity
 */
export async function scoreTheologicalAffinity(passageA: Passage, passageB: Passage): Promise<number> {
  const result = await jejScore(
    'How closely do these passages align theologically or doctrinally?',
    {
      textA: passageA.translation,
      textIdA: passageA.textId,
      themesA: passageA.themes.map(t => t.theme).join(', '),
      textB: passageB.translation,
      textIdB: passageB.textId,
      themesB: passageB.themes.map(t => t.theme).join(', '),
    },
    [
      { level: 0, description: 'No theological connection' },
      { level: 1, description: 'Generic religious language only' },
      { level: 2, description: 'Related but distinct doctrines' },
      { level: 3, description: 'Shared doctrinal concept' },
      { level: 4, description: 'Complementary theological perspectives' },
      { level: 5, description: 'Same core doctrine, authoritative parallel' },
    ]
  );
  return result.score;
}

/**
 * Generate composite recommendation scores - PURE SCORING
 * NO INFERENCES - only weighted scores from Jev judgments
 */
export async function computeRecommendationScores(
  sourcePassage: Passage,
  candidatePassages: Passage[],
  weights: RecommendationWeights = DEFAULT_WEIGHTS
): Promise<Array<{
  passage: Passage;
  scores: {
    thematic: number;
    linguistic: number;
    historical: number;
    narrative: number;
    theological: number;
    composite: number;
  };
  reasoning: string;
  matchedThemes: string[];
  matchedTerms: string[];
}>> {
  const results = [];
  
  for (const candidate of candidatePassages) {
    if (candidate.id === sourcePassage.id) continue;
    
    // Run all scoring dimensions in parallel
    const [thematic, linguistic, historical, narrative, theological] = await Promise.all([
      scoreThematicAffinity(sourcePassage, candidate),
      scoreLinguisticAffinity(sourcePassage, candidate),
      scoreHistoricalAffinity(sourcePassage, candidate),
      scoreNarrativeAffinity(sourcePassage, candidate),
      scoreTheologicalAffinity(sourcePassage, candidate),
    ]);
    
    const composite = 
      thematic * weights.thematic +
      linguistic * weights.linguistic +
      historical * weights.historical +
      narrative * weights.narrative +
      theological * weights.theological;
    
    if (composite < 0.15) continue; // Filter noise
    
    // Build human-readable reasoning from scores ONLY
    const reasoningParts = [];
    if (thematic > 0.5) reasoningParts.push(`strong thematic resonance (${(thematic*100).toFixed(0)}%)`);
    if (linguistic > 0.5) reasoningParts.push(`shared terminology/roots (${(linguistic*100).toFixed(0)}%)`);
    if (historical > 0.5) reasoningParts.push(`historical connection (${(historical*100).toFixed(0)}%)`);
    if (narrative > 0.5) reasoningParts.push(`narrative parallel (${(narrative*100).toFixed(0)}%)`);
    if (theological > 0.5) reasoningParts.push(`theological alignment (${(theological*100).toFixed(0)}%)`);
    
    const matchedThemes = findSharedThemes(sourcePassage, candidate);
    const matchedTerms = findSharedTerms(sourcePassage, candidate);
    
    results.push({
      passage: candidate,
      scores: { thematic, linguistic, historical, narrative, theological, composite },
      reasoning: reasoningParts.length > 0 
        ? `Recommended because: ${reasoningParts.join('; ')}`
        : 'Low-scoring match across dimensions',
      matchedThemes,
      matchedTerms,
    });
  }
  
  return results.sort((a, b) => b.scores.composite - a.scores.composite);
}

// ============================================================================
// SEARCH INTENT CLASSIFICATION
// ============================================================================

export type SearchIntent = 
  | 'comparison'
  | 'explanation'
  | 'thematic_study'
  | 'linguistic_analysis'
  | 'cross_reference'
  | 'reading'
  | 'unknown';

export async function classifySearchIntent(query: string): Promise<{
  intent: SearchIntent;
  confidence: number;
  distribution: Record<string, number>;
}> {
  const result = await jejChoice(
    'What is the user\'s intent in searching religious texts?',
    { query },
    [
      { id: 'comparison', label: 'Comparison', description: 'User wants to compare passages side-by-side' },
      { id: 'explanation', label: 'Explanation', description: 'User wants to understand a passage meaning' },
      { id: 'thematic_study', label: 'Thematic Study', description: 'User explores a theme across texts' },
      { id: 'linguistic_analysis', label: 'Linguistic Analysis', description: 'User analyzes language/terminology' },
      { id: 'cross_reference', label: 'Cross Reference', description: 'User seeks related passages' },
      { id: 'reading', label: 'Reading', description: 'User wants to read a specific passage' },
    ]
  );
  
  return {
    intent: result.choice as SearchIntent,
    confidence: result.confidence,
    distribution: result.distribution,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function extractEvidence(text: string, theme: string): string[] {
  // Simple keyword-based evidence extraction
  // In production, use Jev value extraction
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20);
  const themeKeywords = theme.toLowerCase().split('_');
  return sentences
    .filter(s => themeKeywords.some(k => s.toLowerCase().includes(k)))
    .slice(0, 3);
}

function extractMatchedSegments(
  textA: string,
  textB: string,
  alignmentType: string
): Array<{ textA: string; textB: string; startA: number; endA: number; startB: number; endB: number }> {
  // Simplified - in production use proper alignment algorithm
  const segments: Array<{ textA: string; textB: string; startA: number; endA: number; startB: number; endB: number }> = [];
  
  // Find common phrases (3+ words)
  const wordsA = textA.toLowerCase().split(/\s+/);
  const wordsB = textB.toLowerCase().split(/\s+/);
  
  for (let i = 0; i < wordsA.length - 2; i++) {
    const phrase = wordsA.slice(i, i + 3).join(' ');
    const idx = textB.toLowerCase().indexOf(phrase);
    if (idx !== -1) {
      segments.push({
        textA: phrase,
        textB: phrase,
        startA: textA.toLowerCase().indexOf(phrase),
        endA: textA.toLowerCase().indexOf(phrase) + phrase.length,
        startB: idx,
        endB: idx + phrase.length,
      });
    }
  }
  
  return segments.slice(0, 5);
}

function findSharedThemes(passageA: Passage, passageB: Passage): string[] {
  const themesA = new Set(passageA.themes.map(t => t.theme));
  const themesB = new Set(passageB.themes.map(t => t.theme));
  return [...themesA].filter(t => themesB.has(t));
}

function findSharedTerms(passageA: Passage, passageB: Passage): string[] {
  // Extract significant terms (nouns, proper nouns) - simplified
  const termsA = extractSignificantTerms(passageA.translation);
  const termsB = extractSignificantTerms(passageB.translation);
  return [...termsA].filter(t => termsB.has(t)).slice(0, 10);
}

function extractSignificantTerms(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
    'a', 'an', 'his', 'her', 'its', 'their', 'our', 'your', 'my', 'me',
    'he', 'she', 'it', 'they', 'we', 'you', 'i', 'him', 'them', 'us'
  ]);
  
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s']/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w))
  );
}

// ============================================================================
// BATCH PROCESSING FOR INDEXING
// ============================================================================

export async function batchScorePassages(
  passages: Passage[],
  batchSize: number = 10
): Promise<Map<string, { themes: ThemeScore[]; density: number }>> {
  const results = new Map<string, { themes: ThemeScore[]; density: number }>();
  
  for (let i = 0; i < passages.length; i += batchSize) {
    const batch = passages.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (passage) => {
      const [themes, density] = await Promise.all([
        classifyThemes(passage, 5),
        scoreSemanticDensity(passage),
      ]);
      results.set(passage.id, { themes, density });
    }));
    
    // Rate limiting
    if (i + batchSize < passages.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  return results;
}

export async function batchDetectCrossReferences(
  passages: Passage[],
  batchSize: number = 5
): Promise<Map<string, CrossRef[]>> {
  const results = new Map<string, CrossRef[]>();
  
  for (let i = 0; i < passages.length; i += batchSize) {
    const batch = passages.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (passage) => {
      const refs = await detectCrossReferences(passage, passages);
      results.set(passage.id, refs);
    }));
    
    if (i + batchSize < passages.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  return results;
}