/**
 * API Routes - Main HTTP endpoints
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SearchQuery, SearchIntent, TextId, PassageKey, RecommendationWeights, DEFAULT_WEIGHTS } from '@ilm/shared';
import { searchPassages, searchByPassageKey, logSearch, hybridSearch } from '../services/search';
import { getPassageById, getPassageByKey, getBooks, getBook, getPassagesByBook, getPassagesByChapter, getTextStats } from '../services/passage';
import { generateRecommendations, getRecommendationExplanation, getThematicJourney, getThemeMap, getUserWeights, setUserWeights } from '../services/recommendation';
import { comparePassages, getParallelTranslations, generateComparisonUrl } from '../services/comparison';
import { classifySearchIntent } from '../services/typesafe';

// Validation schemas
const SearchQuerySchema = z.object({
  query: z.string().min(1).max(500),
  intent: z.enum(['comparison', 'explanation', 'thematic_study', 'linguistic_analysis', 'cross_reference', 'reading', 'unknown']).optional(),
  filters: z.object({
    texts: z.array(z.enum(['quran', 'talmud', 'torah', 'ot', 'nt'])).optional(),
    books: z.array(z.string()).optional(),
    chapters: z.array(z.number().int().positive()).optional(),
    languages: z.array(z.enum(['arabic', 'hebrew', 'aramaic', 'greek', 'english'])).optional(),
    themes: z.array(z.string()).optional(),
  }).optional(),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
  includeScores: z.boolean().default(true),
});

const PassageKeySchema = z.string().regex(/^(quran|talmud|torah|ot|nt):.+:\d+:\d+$/);

const RecommendationRequestSchema = z.object({
  passageId: z.string().min(1),
  weights: z.object({
    thematic: z.number().min(0).max(1).default(0.3),
    linguistic: z.number().min(0).max(1).default(0.2),
    historical: z.number().min(0).max(1).default(0.15),
    narrative: z.number().min(0).max(1).default(0.15),
    theological: z.number().min(0).max(1).default(0.2),
  }).optional(),
  limit: z.number().int().positive().max(20).default(10),
  excludeTexts: z.array(z.enum(['quran', 'talmud', 'torah', 'ot', 'nt'])).optional(),
  excludeSameBook: z.boolean().default(false),
  minScore: z.number().min(0).max(1).default(0.15),
});

const ComparisonRequestSchema = z.object({
  passageIds: z.array(z.string().min(1)).min(2).max(5),
  options: z.object({
    includeAlignments: z.boolean().default(true),
    includeThemes: z.boolean().default(true),
    includeCrossRefs: z.boolean().default(true),
    syncScrolling: z.boolean().default(true),
  }).optional(),
});

const WeightsSchema = z.object({
  thematic: z.number().min(0).max(1),
  linguistic: z.number().min(0).max(1),
  historical: z.number().min(0).max(1),
  narrative: z.number().min(0).max(1),
  theological: z.number().min(0).max(1),
}).refine(w => {
  const sum = w.thematic + w.linguistic + w.historical + w.narrative + w.theological;
  return Math.abs(sum - 1.0) < 0.01;
}, 'Weights must sum to 1.0');

export async function registerRoutes(app: FastifyInstance) {
  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.1.0',
  }));

  // ========================================================================
  // SEARCH ENDPOINTS
  // ========================================================================

  /**
   * Unified search across all texts
   * POST /api/search
   */
  app.post('/api/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      const query = SearchQuerySchema.parse(request.body);
      
      const result = await searchPassages(query);
      
      // Log search for analytics
      await logSearch(
        query.query,
        query.intent,
        query.filters,
        result.results.length,
        result.tookMs,
        request.headers['x-user-id'] as string,
        request.headers['x-session-id'] as string
      );
      
      return reply.send({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid search query', details: error.flatten() },
        });
      }
      throw error;
    }
  });

  /**
   * Search suggestions/autocomplete
   * GET /api/search/suggest?q=...
   */
  app.get('/api/search/suggest', async (request: FastifyRequest<{ Querystring: { q: string; limit?: string } }>) => {
    const { q, limit = '5' } = request.query;
    
    if (!q || q.length < 2) {
      return { success: true, data: { suggestions: [] } };
    }
    
    // Use MeiliSearch for suggestions
    // In production, use a dedicated suggestions index
    const result = await searchPassages({
      query: q,
      limit: parseInt(limit),
      filters: {},
    });
    
    const suggestions = result.results
      .map(r => `${r.passage.book} ${r.passage.chapter}:${r.passage.verse}`)
      .slice(0, parseInt(limit));
    
    return { success: true, data: { suggestions } };
  });

  /**
   * Classify search intent
   * POST /api/search/intent
   */
  app.post('/api/search/intent', async (request: FastifyRequest<{ Body: { query: string } }>) => {
    const { query } = request.body;
    
    if (!query || query.length < 3) {
      return { success: true, data: { intent: 'unknown', confidence: 0 } };
    }
    
    const result = await classifySearchIntent(query);
    
    return { success: true, data: result };
  });

  // ========================================================================
  // PASSAGE ENDPOINTS
  // ========================================================================

  /**
   * Get passage by ID
   * GET /api/passages/:id
   */
  app.get('/api/passages/:id', async (request: FastifyRequest<{ Params: { id: string } }>) => {
    const passage = await getPassageById(request.params.id);
    
    if (!passage) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Passage not found' },
      });
    }
    
    return { success: true, data: passage };
  });

  /**
   * Get passage by canonical key (e.g., quran:2:255)
   * GET /api/passages/by-key/:key
   */
  app.get('/api/passages/by-key/:key', async (request: FastifyRequest<{ Params: { key: string } }>) => {
    const key = request.params.key;
    
    if (!PassageKeySchema.safeParse(key).success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_KEY', message: 'Invalid passage key format. Use textId:book:chapter:verse' },
      });
    }
    
    const passage = await getPassageByKey(key);
    
    if (!passage) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Passage not found' },
      });
    }
    
    return { success: true, data: passage };
  });

  /**
   * Get multiple passages by keys
   * POST /api/passages/batch
   */
  app.post('/api/passages/batch', async (request: FastifyRequest<{ Body: { keys: string[] } }>) => {
    const { keys } = request.body;
    
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > 50) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Provide 1-50 passage keys' },
      });
    }
    
    const passages = await getPassagesByKeys(keys);
    
    return { success: true, data: { passages } };
  });

  /**
   * Get all books for a text
   * GET /api/texts/:textId/books
   */
  app.get('/api/texts/:textId/books', async (request: FastifyRequest<{ Params: { textId: TextId } }>) => {
    const { textId } = request.params;
    
    const books = await getBooks(textId);
    
    return { success: true, data: { books, textId, total: books.length } };
  });

  /**
   * Get book metadata
   * GET /api/texts/:textId/books/:bookId
   */
  app.get('/api/texts/:textId/books/:bookId', async (request: FastifyRequest<{ Params: { textId: TextId; bookId: string } }>) => {
    const { textId, bookId } = request.params;
    
    const book = await getBook(textId, bookId);
    
    if (!book) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Book not found' },
      });
    }
    
    return { success: true, data: book };
  });

  /**
   * Get passages in a book
   * GET /api/texts/:textId/books/:bookId/passages
   */
  app.get('/api/texts/:textId/books/:bookId/passages', async (request: FastifyRequest<{
    Params: { textId: TextId; bookId: string };
    Querystring: { limit?: string; offset?: string };
  }>) => {
    const { textId, bookId } = request.params;
    const limit = parseInt(request.query.limit || '100');
    const offset = parseInt(request.query.offset || '0');
    
    const passages = await getPassagesByBook(textId, bookId, limit, offset);
    
    return { success: true, data: { passages, total: passages.length } };
  });

  /**
   * Get passages in a chapter
   * GET /api/texts/:textId/books/:bookId/chapters/:chapter
   */
  app.get('/api/texts/:textId/books/:bookId/chapters/:chapter', async (request: FastifyRequest<{
    Params: { textId: TextId; bookId: string; chapter: string };
  }>) => {
    const { textId, bookId, chapter } = request.params;
    const chapterNum = parseInt(chapter);
    
    if (isNaN(chapterNum) || chapterNum < 1) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_CHAPTER', message: 'Invalid chapter number' },
      });
    }
    
    const passages = await getPassagesByChapter(textId, bookId, chapterNum);
    
    return { success: true, data: { passages, chapter: chapterNum } };
  });

  /**
   * Get text statistics
   * GET /api/texts/:textId/stats
   */
  app.get('/api/texts/:textId/stats', async (request: FastifyRequest<{ Params: { textId: TextId } }>) => {
    const { textId } = request.params;
    const stats = await getTextStats(textId);
    
    return { success: true, data: stats };
  });

  // ========================================================================
  // RECOMMENDATION ENDPOINTS
  // ========================================================================

  /**
   * Get recommendations for a passage
   * POST /api/recommendations
   */
  app.post('/api/recommendations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = RecommendationRequestSchema.parse(request.body);
      
      const result = await generateRecommendations(body);
      
      return { success: true, data: result };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.flatten() },
        });
      }
      throw error;
    }
  });

  /**
   * Get detailed explanation for a recommendation
   * GET /api/recommendations/explain/:sourceId/:targetId
   */
  app.get('/api/recommendations/explain/:sourceId/:targetId', async (request: FastifyRequest<{
    Params: { sourceId: string; targetId: string };
    Querystring: { weights?: string };
  }>) => {
    const { sourceId, targetId } = request.params;
    
    let weights = DEFAULT_WEIGHTS;
    if (request.query.weights) {
      try {
        weights = JSON.parse(request.query.weights);
      } catch {
        // Use defaults
      }
    }
    
    const explanation = await getRecommendationExplanation(sourceId, targetId, weights);
    
    return { success: true, data: explanation };
  });

  /**
   * Get thematic journey across texts
   * GET /api/themes/:theme/journey
   */
  app.get('/api/themes/:theme/journey', async (request: FastifyRequest<{
    Params: { theme: string };
    Querystring: { texts?: string; limit?: string };
  }>) => {
    const { theme } = request.params;
    const texts = request.query.texts?.split(',') as TextId[] | undefined;
    const limit = parseInt(request.query.limit || '20');
    
    const journey = await getThematicJourney(theme, texts, limit);
    
    return { success: true, data: { theme, journey } };
  });

  /**
   * Get theme map (related themes)
   * GET /api/themes/:theme/map
   */
  app.get('/api/themes/:theme/map', async (request: FastifyRequest<{ Params: { theme: string } }>) => {
    const { theme } = request.params;
    const map = await getThemeMap(theme);
    
    return { success: true, data: map };
  });

  /**
   * Get user recommendation weights
   * GET /api/users/:userId/weights
   */
  app.get('/api/users/:userId/weights', async (request: FastifyRequest<{ Params: { userId: string } }>) => {
    const weights = await getUserWeights(request.params.userId);
    return { success: true, data: weights };
  });

  /**
   * Set user recommendation weights
   * PUT /api/users/:userId/weights
   */
  app.put('/api/users/:userId/weights', async (request: FastifyRequest<{
    Params: { userId: string };
    Body: RecommendationWeights;
  }>, reply: FastifyReply) => {
    try {
      const weights = WeightsSchema.parse(request.body);
      await setUserWeights(request.params.userId, weights);
      return { success: true, data: weights };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Weights must sum to 1.0', details: error.flatten() },
        });
      }
      throw error;
    }
  });

  // ========================================================================
  // COMPARISON ENDPOINTS
  // ========================================================================

  /**
   * Compare passages side-by-side
   * POST /api/compare
   */
  app.post('/api/compare', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = ComparisonRequestSchema.parse(request.body);
      
      const result = await comparePassages(body);
      
      // Generate shareable URL
      const shareUrl = generateComparisonUrl(body.passageIds);
      
      return { success: true, data: { ...result, shareUrl } };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid comparison request', details: error.flatten() },
        });
      }
      throw error;
    }
  });

  /**
   * Get parallel translations for a verse
   * GET /api/compare/translations/:textId/:book/:chapter/:verse
   */
  app.get('/api/compare/translations/:textId/:book/:chapter/:verse', async (request: FastifyRequest<{
    Params: { textId: TextId; book: string; chapter: string; verse: string };
    Querystring: { translations?: string };
  }>) => {
    const { textId, book, chapter, verse } = request.params;
    const translationIds = request.query.translations?.split(',');
    
    const result = await getParallelTranslations(textId, book, parseInt(chapter), parseInt(verse), translationIds);
    
    return { success: true, data: result };
  });

  // ========================================================================
  // TEXT METADATA ENDPOINTS
  // ========================================================================

  /**
   * Get all available texts metadata
   * GET /api/texts
   */
  app.get('/api/texts', async () => {
    const texts = await Promise.all(
      ['quran', 'talmud', 'torah', 'ot', 'nt'].map(async (textId) => {
        const stats = await getTextStats(textId as TextId);
        return { textId, ...stats };
      })
    );
    
    return { success: true, data: { texts } };
  });

  // ========================================================================
  // ADMIN/INDEXING ENDPOINTS (protected in production)
  // ========================================================================

  /**
   * Trigger re-indexing
   * POST /api/admin/reindex
   */
  app.post('/api/admin/reindex', async (request: FastifyRequest<{ Body: { textId?: TextId } }>) => {
    // In production, add authentication
    const { textId } = request.body;
    
    // Create indexing job
    const job = await prisma.indexingJob.create({
      data: {
        type: textId ? 'incremental' : 'full_reindex',
        metadata: { textId },
      },
    });
    
    // Trigger background job (would use BullMQ)
    // await indexingQueue.add('reindex', { jobId: job.id, textId });
    
    return { success: true, data: { jobId: job.id, status: 'queued' } };
  });

  /**
   * Get indexing job status
   * GET /api/admin/jobs/:jobId
   */
  app.get('/api/admin/jobs/:jobId', async (request: FastifyRequest<{ Params: { jobId: string } }>) => {
    const job = await prisma.indexingJob.findUnique({
      where: { id: request.params.jobId },
    });
    
    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }
    
    return { success: true, data: job };
  });
}