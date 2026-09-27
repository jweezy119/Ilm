/**
 * Indexing Pipeline with TypeSafe/Jev + OramaJS
 * Processes passages for themes, cross-references, embeddings, and builds Orama search index
 */

import { PrismaClient } from '@prisma/client';
import { batchScorePassages, batchDetectCrossReferences } from '../src/services/typesafe';
import { Passage } from '@ilm/shared';
import { buildOramaIndex, persistOramaIndex } from '../src/search/orama';
import { generateEmbeddingsBatch } from '../src/services/embeddings';

const prisma = new PrismaClient();

interface IndexingOptions {
  textId?: string;
  batchSize?: number;
  skipThemes?: boolean;
  skipCrossRefs?: boolean;
  skipEmbeddings?: boolean;
  skipOrama?: boolean;
}

export async function runIndexingPipeline(options: IndexingOptions = {}) {
  const { 
    textId, 
    batchSize = 10, 
    skipThemes = false, 
    skipCrossRefs = false, 
    skipEmbeddings = true,
    skipOrama = false
  } = options;
  
  console.log('🔍 Starting indexing pipeline...');
  
  const job = await prisma.indexingJob.create({
    data: {
      type: textId ? 'incremental' : 'full_reindex',
      metadata: { textId, options },
      status: 'running',
      startedAt: new Date(),
    },
  });
  
  try {
    // Get passages to process
    const where = textId ? { textId } : {};
    const totalPassages = await prisma.passage.count({ where });
    
    await prisma.indexingJob.update({
      where: { id: job.id },
      data: { totalItems: totalPassages, progress: 0 },
    });
    
    console.log(`📊 Processing ${totalPassages} passages...`);
    
    // Process in batches for TypeSafe operations
    let processed = 0;
    let offset = 0;
    
    while (true) {
      const passages = await prisma.passage.findMany({
        where,
        take: batchSize,
        skip: offset,
        orderBy: { verseOrder: 'asc' },
        include: {
          themes: { include: { theme: true } },
        },
      });
      
      if (passages.length === 0) break;
      
      // Convert to Passage type
      const typedPassages: Passage[] = passages.map(p => ({
        id: p.id,
        passageKey: p.passageKey,
        textId: p.textId as any,
        book: p.bookId,
        chapter: p.chapterNum,
        verse: p.verseNum,
        originalText: p.originalText,
        translation: p.primaryTranslation,
        alternativeTranslations: [],
        metadata: p.metadata as any,
        embeddings: p.embeddings as number[],
        themes: p.themes.map(t => ({
          theme: t.theme.name,
          score: t.score,
          confidence: t.confidence,
          evidence: t.evidence,
          source: t.source as any,
        })),
        crossReferences: [],
      }));
      
      // Step 1: Theme classification & semantic density
      if (!skipThemes) {
        console.log(`  🎯 Classifying themes for batch ${offset / batchSize + 1}...`);
        const themeResults = await batchScorePassages(typedPassages, batchSize);
        
        for (const passage of typedPassages) {
          const result = themeResults.get(passage.id);
          if (result) {
            await saveThemes(passage.id, result.themes);
            await updatePassageDensity(passage.id, result.density);
          }
        }
      }
      
      // Step 2: Cross-reference detection
      if (!skipCrossRefs) {
        console.log(`  🔗 Detecting cross-references...`);
        const crossRefResults = await batchDetectCrossReferences(typedPassages, batchSize);
        
        for (const passage of typedPassages) {
          const refs = crossRefResults.get(passage.id) || [];
          for (const ref of refs) {
            await saveCrossReference(passage.id, ref);
          }
        }
      }
      
      // Step 3: Generate embeddings (placeholder - would use OpenAI or local model)
      if (!skipEmbeddings) {
        console.log(`  🧮 Generating embeddings...`);
        await generateEmbeddings(typedPassages);
      }
      
      processed += passages.length;
      offset += batchSize;
      
      await prisma.indexingJob.update({
        where: { id: job.id },
        data: { 
          processedItems: processed,
          progress: Math.round((processed / totalPassages) * 100),
        },
      });
      
      console.log(`  ✓ Processed ${processed}/${totalPassages} passages`);
      
      // Rate limit for TypeSafe API
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // Step 4: Compute alignments for comparison
    console.log('  ⚖️  Computing alignments...');
    await computeAlignments(textId);
    
    // Step 5: Build Orama search index
    if (!skipOrama) {
      console.log('  🔍 Building Orama search index...');
      await buildOramaIndex(1000);
      await persistOramaIndex();
    }
    
    await prisma.indexingJob.update({
      where: { id: job.id },
      data: { 
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
      },
    });
    
    console.log('✅ Indexing pipeline complete!');
    
  } catch (error) {
    await prisma.indexingJob.update({
      where: { id: job.id },
      data: { 
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

async function saveThemes(passageId: string, themes: Array<{ theme: string; score: number; confidence: number; evidence: string[]; source: string }>) {
  // Ensure themes exist
  for (const t of themes) {
    await prisma.theme.upsert({
      where: { name: t.theme },
      create: { name: t.theme, category: categorizeTheme(t.theme) },
      update: {},
    });
  }
  
  // Save passage themes
  await prisma.passageTheme.deleteMany({ where: { passageId } });
  
  await prisma.passageTheme.createMany({
    data: themes.map(t => ({
      passageId,
      themeId: t.theme,
      score: t.score,
      confidence: t.confidence,
      evidence: t.evidence,
      source: t.source,
    })),
  });
}

async function updatePassageDensity(passageId: string, density: number) {
  await prisma.passage.update({
    where: { id: passageId },
    data: { metadata: { density } },
  });
}

async function saveCrossReference(sourceId: string, ref: any) {
  await prisma.crossReference.upsert({
    where: {
      sourcePassageId_targetPassageId_type: {
        sourcePassageId: sourceId,
        targetPassageId: ref.targetPassageId,
        type: ref.type,
      },
    },
    create: {
      sourcePassageId: sourceId,
      targetPassageId: ref.targetPassageId,
      type: ref.type,
      strength: ref.strength,
      direction: ref.direction,
      notes: ref.notes,
      detectedBy: ref.detectedBy,
      matchedSegments: [],
    },
    update: {
      strength: ref.strength,
      direction: ref.direction,
      notes: ref.notes,
    },
  });
}

async function generateEmbeddings(passages: Passage[]) {
  console.log(`  🧮 Generating embeddings for ${passages.length} passages...`);
  
  const texts = passages.map(p => `${p.translation} ${p.originalText}`);
  const embeddings = await generateEmbeddingsBatch(texts);
  
  for (let i = 0; i < passages.length; i++) {
    await prisma.passage.update({
      where: { id: passages[i].id },
      data: { embeddings: embeddings[i] },
    });
  }
  
  console.log(`  ✅ Stored ${passages.length} embeddings`);
}

async function computeAlignments(textId?: string) {
  // Compute pairwise alignments for passages that might be compared
  const where = textId ? { textId } : {};
  const passages = await prisma.passage.findMany({
    where,
    select: { id: true, textId: true, bookId: true, chapterNum: true, verseNum: true },
    take: 1000,
  });
  
  console.log('  Alignment computation would run here (expensive operation)');
}

function categorizeTheme(theme: string): string {
  const categories: Record<string, string[]> = {
    divine_attributes: ['mercy', 'compassion', 'justice', 'wrath', 'forgiveness', 'love', 'power', 'knowledge', 'wisdom', 'sovereignty', 'holiness', 'faithfulness'],
    covenant_law: ['covenant', 'law', 'commandment', 'obedience', 'sin', 'repentance', 'atonement', 'sacrifice', 'purity', 'righteousness'],
    salvation: ['salvation', 'redemption', 'resurrection', 'judgment', 'heaven', 'hell', 'afterlife', 'messiah', 'kingdom', 'eternal_life'],
    practice: ['prayer', 'worship', 'fasting', 'pilgrimage', 'charity', 'almsgiving', 'ritual', 'ceremony', 'sabbath', 'festival'],
    ethics: ['justice', 'charity', 'humility', 'patience', 'gratitude', 'trust', 'honesty', 'kindness', 'generosity'],
    narrative: ['creation', 'adam', 'noah', 'abraham', 'moses', 'david', 'solomon', 'jesus', 'muhammad', 'prophets', 'angels', 'satan'],
    community: ['community', 'family', 'marriage', 'parenthood', 'neighbor', 'stranger', 'poor', 'orphan', 'widow', 'governance'],
    cosmology: ['creation', 'heaven', 'earth', 'light', 'darkness', 'water', 'fire', 'wind', 'stars', 'animals', 'plants'],
  };
  
  for (const [cat, themes] of Object.entries(categories)) {
    if (themes.includes(theme)) return cat;
  }
  return 'other';
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const textId = args[0];
  
  runIndexingPipeline({ textId })
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}