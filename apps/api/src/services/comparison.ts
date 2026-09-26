/**
 * Comparison Service - Side-by-side passage alignment and comparison
 */

import { PrismaClient } from '@prisma/client';
import { Passage, ComparisonRequest, ComparisonResponse, Alignment, TextId } from '@ilm/shared';
import { computeAlignment } from './typesafe';
import { getPassageById, getPassagesByKeys, getAlignments } from './passage';

const prisma = new PrismaClient();

// ============================================================================
// COMPARISON ENGINE
// ============================================================================

/**
 * Compare multiple passages side-by-side with Jev-powered alignments
 */
export async function comparePassages(request: ComparisonRequest): Promise<ComparisonResponse> {
  const passages = await getPassagesByKeys(request.passageIds);
  
  if (passages.length !== request.passageIds.length) {
    const found = new Set(passages.map(p => p.id));
    const missing = request.passageIds.filter(id => !found.has(id));
    throw new Error(`Passages not found: ${missing.join(', ')}`);
  }
  
  // Compute pairwise alignments
  const alignments: Alignment[] = [];
  
  if (request.options?.includeAlignments) {
    for (let i = 0; i < passages.length; i++) {
      for (let j = i + 1; j < passages.length; j++) {
        // Check cached alignment first
        const cached = await getCachedAlignment(passages[i].id, passages[j].id);
        
        if (cached && cached.strength > 0) {
          alignments.push({
            passageAId: cached.sourcePassageId,
            passageBId: cached.targetPassageId,
            type: cached.type as any,
            strength: cached.strength,
            matchedSegments: cached.matchedSegments as any,
            notes: cached.notes || '',
          });
        } else {
          // Compute new alignment with Jev
          const alignment = await computeAlignment(passages[i], passages[j]);
          
          if (alignment.strength > 0.2) {
            alignments.push({
              passageAId: passages[i].id,
              passageBId: passages[j].id,
              type: alignment.type as any,
              strength: alignment.strength,
              matchedSegments: alignment.matchedSegments,
              notes: alignment.notes,
            });
            
            // Cache for future
            await cacheAlignment(passages[i].id, passages[j].id, alignment);
          }
        }
      }
    }
  }
  
  // Compute shared themes
  const sharedThemes = computeSharedThemes(passages);
  
  return {
    passages,
    alignments,
    sharedThemes,
    metadata: {
      textCount: new Set(passages.map(p => p.textId)).size,
      totalVerses: passages.length,
      generatedAt: new Date(),
    },
  };
}

/**
 * Get cached alignment or compute if not cached
 */
async function getCachedAlignment(sourceId: string, targetId: string) {
  return prisma.alignment.findUnique({
    where: {
      sourcePassageId_targetPassageId: {
        sourcePassageId: sourceId,
        targetPassageId: targetId,
      },
    },
  });
}

async function cacheAlignment(sourceId: string, targetId: string, alignment: {
  type: string;
  strength: number;
  matchedSegments: any[];
  notes: string;
}) {
  await prisma.alignment.upsert({
    where: {
      sourcePassageId_targetPassageId: {
        sourcePassageId: sourceId,
        targetPassageId: targetId,
      },
    },
    create: {
      sourcePassageId: sourceId,
      targetPassageId: targetId,
      type: alignment.type,
      strength: alignment.strength,
      matchedSegments: alignment.matchedSegments,
      notes: alignment.notes,
    },
    update: {
      type: alignment.type,
      strength: alignment.strength,
      matchedSegments: alignment.matchedSegments,
      notes: alignment.notes,
    },
  });
}

/**
 * Compute shared themes across passages
 */
function computeSharedThemes(passages: Passage[]): Array<{
  theme: string;
  passages: Record<string, string[]>;
  avgScore: number;
}> {
  const themeMap = new Map<string, Map<string, { score: number; evidence: string[] }>>();
  
  for (const passage of passages) {
    for (const theme of passage.themes) {
      if (!themeMap.has(theme.theme)) {
        themeMap.set(theme.theme, new Map());
      }
      themeMap.get(theme.theme)!.set(passage.id, {
        score: theme.score,
        evidence: theme.evidence,
      });
    }
  }
  
  const results: Array<{
    theme: string;
    passages: Record<string, string[]>;
    avgScore: number;
  }> = [];
  
  for (const [theme, passageData] of themeMap) {
    if (passageData.size >= 2) { // Shared by at least 2 passages
      const scores = Array.from(passageData.values()).map(v => v.score);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      
      const passagesObj: Record<string, string[]> = {};
      for (const [pid, data] of passageData) {
        passagesObj[pid] = data.evidence;
      }
      
      results.push({ theme, passages: passagesObj, avgScore });
    }
  }
  
  return results.sort((a, b) => b.avgScore - a.avgScore);
}

/**
 * Get pre-computed comparison for common pairs (e.g., same verse across translations)
 */
export async function getParallelTranslations(
  textId: TextId,
  book: string,
  chapter: number,
  verse: number,
  translationIds?: string[]
): Promise<{
  original: Passage;
  translations: Passage[];
}> {
  const baseKey = `${textId}:${book}:${chapter}:${verse}`;
  const original = await getPassageByKey(baseKey);
  
  if (!original) {
    throw new Error(`Passage not found: ${baseKey}`);
  }
  
  // Get all translations for this passage
  const translations = await prisma.passageTranslation.findMany({
    where: { passageId: original.id },
    include: { translation: true },
  });
  
  let filtered = translations;
  if (translationIds?.length) {
    filtered = translations.filter(t => translationIds.includes(t.translationId));
  }
  
  const translationPassages = filtered.map(t => ({
    ...original,
    translation: t.text,
    id: `${original.id}:${t.translationId}`,
    alternativeTranslations: [],
  })) as Passage[];
  
  return { original, translations: translationPassages };
}

/**
 * Compare same passage across different texts (e.g., Quran 2:255 vs Bible John 3:16)
 */
export async function compareAcrossTexts(
  passageA: Passage,
  textB: TextId,
  limit = 5
): Promise<{
  source: Passage;
  matches: Array<{ passage: Passage; alignment: Alignment; scores: any }>;
}> {
  // Search for related passages in target text
  // This would use the search service with semantic similarity
  // For now, return empty - implement with search service
  
  return {
    source: passageA,
    matches: [],
  };
}

/**
 * Get verse-by-verse comparison for a chapter across texts
 */
export async function compareChapterAcrossTexts(
  textId: TextId,
  book: string,
  chapter: number,
  targetTexts: TextId[]
): Promise<{
  sourcePassages: Passage[];
  comparisons: Map<string, Passage[]>; // targetTextId -> passages
}> {
  const sourcePassages = await getPassagesByChapter(textId, book, chapter);
  
  // For each target text, find thematic parallels
  const comparisons = new Map<string, Passage[]>();
  
  for (const targetText of targetTexts) {
    // This would use thematic search - placeholder
    comparisons.set(targetText, []);
  }
  
  return { sourcePassages, comparisons };
}

/**
 * Synchronized scrolling positions for comparison view
 */
export function calculateSyncPositions(
  passages: Passage[],
  viewportHeight: number,
  lineHeight: number = 24
): Record<string, { top: number; height: number }> {
  // Calculate relative positions for synchronized scrolling
  // Based on verse position within chapter/book
  
  const positions: Record<string, { top: number; height: number }> = {};
  
  for (const passage of passages) {
    // Normalize position (0-1) based on verse order in text
    const totalVerses = TEXT_VERSE_COUNTS[passage.textId] || 10000;
    const position = passage.metadata.verseOrder / totalVerses;
    
    positions[passage.id] = {
      top: position * viewportHeight,
      height: lineHeight * Math.max(1, Math.ceil(passage.translation.length / 80)),
    };
  }
  
  return positions;
}

// Approximate verse counts for position normalization
const TEXT_VERSE_COUNTS: Record<TextId, number> = {
  quran: 6236,
  talmud: 50000, // Approximate
  torah: 5845,
  ot: 23145,
  nt: 7957,
};

/**
 * Generate comparison URL for sharing
 */
export function generateComparisonUrl(passageIds: string[]): string {
  const params = new URLSearchParams();
  params.set('compare', passageIds.join(','));
  return `/compare?${params.toString()}`;
}

/**
 * Parse comparison URL
 */
export function parseComparisonUrl(url: string): string[] {
  const params = new URLSearchParams(url.split('?')[1] || '');
  const compare = params.get('compare');
  return compare ? compare.split(',') : [];
}