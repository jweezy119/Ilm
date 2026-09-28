/**
 * HTTP routes.
 *
 * Handlers stay thin: validate, call a service, wrap the result. Every response
 * uses the same { success, data } / { success, error } envelope.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  TextIdSchema,
  TextId,
  RecommendationWeightsInputSchema,
  PassageKeySchema as SharedPassageKeySchema,
  ComparisonRequestSchema,
} from '@ilm/shared';
import { searchPassages, logSearch, listThemes, getIndexStats } from '../services/search';
import {
  getPassageById,
  getPassageByKey,
  getPassagesByKeys,
  getPassagesByBook,
  getPassagesByChapter,
  getBooks,
  getBook,
  getTextStats,
  getCorpusStats,
  prisma,
} from '../services/passage';
import {
  generateRecommendations,
  getRecommendationExplanation,
  getThematicJourney,
  getThemeMap,
  getUserWeights,
  setUserWeights,
  normalizeWeights,
} from '../services/recommendation';
import { comparePassages, getParallelTranslations, generateComparisonUrl, computeSharedThemes } from '../services/comparison';
import { getCrossReferencesForPassage } from '../services/crossrefs';
import { lookupWord } from '../services/lexicon';
import { classifySearchIntent } from '../services/typesafe';
import { getJevJudge, describeJudgeChain, judgeBudget } from '../services/typesafe-client';
import { isIndexReady, invalidateOramaIndex, indexedTextIds, engineName } from '../search/engine';
import { getEmbeddingConfig } from '../services/embeddings';
import { HttpError } from '../lib/errors';

// ============================================================================
// REQUEST SCHEMAS
// ============================================================================

const SearchBodySchema = z.object({
  query: z.string().min(1).max(500),
  intent: z.enum(['comparison', 'explanation', 'thematic_study', 'linguistic_analysis', 'cross_reference', 'reading', 'unknown']).optional(),
  filters: z
    .object({
      texts: z.array(TextIdSchema).optional(),
      books: z.array(z.string()).optional(),
      chapters: z.array(z.number().int().positive()).optional(),
      languages: z.array(z.enum(['arabic', 'hebrew', 'aramaic', 'greek', 'english'])).optional(),
      themes: z.array(z.string()).optional(),
    })
    .optional(),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
  includeScores: z.boolean().default(true),
  // One extra Jev request per search; turn it off for cheap literal search.
  semantic: z.boolean().default(true),
  expand: z.boolean().default(true),
});

const PassageKeySchema = SharedPassageKeySchema;

const RecommendationBodySchema = z.object({
  passageId: z.string().min(1),
  weights: RecommendationWeightsInputSchema.optional(),
  limit: z.number().int().positive().max(25).default(10),
  excludeTexts: z.array(TextIdSchema).optional(),
  excludeSameBook: z.boolean().default(false),
  minScore: z.number().min(0).max(1).default(0.15),
});

// The comparison body is validated by the shared schema rather than a second copy
// here. Two copies is how the passage cap came to disagree with the one the web
// client enforces.

const WeightsBodySchema = z
  .object({
    thematic: z.number().min(0).max(1),
    linguistic: z.number().min(0).max(1),
    historical: z.number().min(0).max(1),
    narrative: z.number().min(0).max(1),
    theological: z.number().min(0).max(1),
  })
  .refine((w) => Math.abs(w.thematic + w.linguistic + w.historical + w.narrative + w.theological - 1) < 0.02, {
    message: 'Weights must sum to 1.0',
  });

// ============================================================================
// HELPERS
// ============================================================================

const ok = (data: unknown) => ({ success: true as const, data });

function fail(reply: FastifyReply, status: number, code: string, message: string, details?: unknown) {
  return reply.status(status).send({ success: false, error: { code, message, ...(details ? { details } : {}) } });
}

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request body failed validation', result.error.flatten());
  }
  return result.data;
}

// ============================================================================
// ROUTES
// ============================================================================

interface Coverage {
  indexedPassages: number;
  allTexts: string[];
  /** Texts the engine has, or null when it has all of them. */
  indexedTexts: string[] | null;
}

let coverageMemo: { at: number; value: Coverage } | null = null;

/** Index coverage, recomputed at most every 60s. See the call site for why. */
async function coverageCache(passages: number): Promise<Coverage> {
  if (coverageMemo && Date.now() - coverageMemo.at < 60_000) return coverageMemo.value;

  // Awaited once, here. The Orama engine answers from configuration; the Postgres
  // engine has to ask the database, and the route used to call this a second time
  // for the same answer.
  const indexedTexts = await indexedTextIds();
  // DISTINCT rather than Prisma's groupBy, which pulls every row through the
  // client; this is one index scan.
  const rows = await prisma.$queryRaw<Array<{ text_id: string }>>`
    SELECT DISTINCT text_id FROM passages ORDER BY text_id
  `;
  const allTexts = rows.map((r) => r.text_id);
  const value: Coverage = {
    allTexts,
    indexedTexts,
    indexedPassages: indexedTexts
      ? await prisma.passage.count({ where: { textId: { in: indexedTexts as never[] } } })
      : passages,
  };
  coverageMemo = { at: Date.now(), value };
  return value;
}



export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------- health
  app.get('/health', async () => {
    const judge = getJevJudge();
    const passages = await prisma.passage.count();
    // "Has a real vector", counted by length. Not `IS NOT NULL`, which is true
    // for an empty array and so reported every row as embedded — it claimed
    // 45,453 of 45,453 on a corpus where 16,853 passages held '[]', and the
    // interface repeated that claim. Not the old `jsonb_typeof(...) = 'array'`
    // version either: correct, but 4.3 s because the type check forces a full
    // scan.
    //
    // The index on jsonb_array_length brings this to ~33 ms, and the CHECK
    // constraint from migration 3 is what makes the bare form safe: it forbids a
    // JSON null, which is the one input that makes jsonb_array_length raise
    // 22023 rather than return null. With the constraint in place a row is
    // either SQL NULL (returns null, comparison drops it) or a real array.
    const [{ embedded } = { embedded: 0 }] = await prisma.$queryRaw<Array<{ embedded: number }>>`
      SELECT count(*)::int AS embedded FROM passages WHERE jsonb_array_length(embeddings) > 0
    `;
    const embeddingConfig = getEmbeddingConfig();

    // The in-memory index holds a subset of the corpus on small instances, so
    // health reports which texts are actually searchable. A caller that cannot
    // tell "not in the index" from "does not exist" will conclude the texts are
    // missing, which is the one thing that must not be left ambiguous.
    //
    // Cached: a DISTINCT over every passage made this route take seconds, and a
    // health check that slow is a health check the platform stops trusting. The
    // corpus only moves when something is ingested, so a short TTL is enough.
    const coverage = await coverageCache(passages);
    const { indexedPassages, allTexts, indexedTexts } = coverage;
    const indexed = indexedTexts ? new Set(indexedTexts) : new Set(allTexts);

    return ok({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
      search: {
        ready: isIndexReady(),
        // Which engine answered, because the two rank differently: the in-process
        // index matches theme names and book slugs, Postgres matches the scripture.
        engine: engineName,
        passagesIndexed: indexedPassages,
        passagesTotal: passages,
        // Texts a search will cover, and texts it will not. `null` means all.
        indexedTexts: indexedTexts ?? allTexts,
        unindexedTexts: allTexts.filter((t) => !indexed.has(t)),
        partial: indexedPassages < passages,
      },
      // Kept for compatibility with anything already reading `jev`, but the chain
      // below is the real answer: `configured` is true only if some engine can run.
      jev: { configured: judge.available, reason: judge.reason },
      // Every engine in the order it is tried, so a reader can see whether a result
      // was judged by the hosted model, by something running locally, or not at all.
      judges: describeJudgeChain(),
      // What this process has spent on the hosted judge, and the ceiling it will
      // not pass. Surfaced so a budget stop is visible rather than silent.
      budget: {
        spentUsd: Number(judgeBudget().spentUsd.toFixed(6)),
        limitUsd: judgeBudget().limitUsd,
        exhausted: judgeBudget().exhausted,
        refused: judgeBudget().refused,
      },
      embeddings: {
        provider: embeddingConfig?.provider ?? null,
        model: embeddingConfig?.model ?? null,
        embedded,
        of: passages,
      },
    });
  });

  // ---------------------------------------------------------------- search
  app.post('/api/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parse(SearchBodySchema, request.body);
    const result = await searchPassages(body);

    void logSearch({
      query: body.query,
      intent: result.intent,
      filters: body.filters,
      resultCount: result.results.length,
      tookMs: result.tookMs,
      userId: headerValue(request, 'x-user-id'),
      sessionId: headerValue(request, 'x-session-id'),
    });

    return ok(result);
  });

  app.get('/api/search/suggest', async (request: FastifyRequest<{ Querystring: { q?: string; limit?: string } }>) => {
    const q = request.query.q?.trim() ?? '';
    const limit = Math.min(20, Math.max(1, Number(request.query.limit ?? 5)));
    if (q.length < 2) return ok({ suggestions: [] });

    const result = await searchPassages({ query: q, limit, offset: 0, includeScores: true, semantic: false, expand: true });
    const suggestions = result.results.map((r) => `${r.passage.book} ${r.passage.chapter}:${r.passage.verse}`);
    return ok({ suggestions: [...new Set(suggestions)].slice(0, limit) });
  });

  app.post('/api/search/intent', async (request: FastifyRequest<{ Body: { query?: string } }>) => {
    const query = request.body?.query?.trim() ?? '';
    if (query.length < 3) return ok({ intent: 'unknown', confidence: 0, source: 'derived' });
    return ok(await classifySearchIntent(query));
  });

  app.get('/api/themes', async () => ok({ themes: await listThemes() }));

  // ---------------------------------------------------------------- lexicon
  app.get('/api/lexicon', async (request: FastifyRequest<{ Querystring: { word?: string } }>) => {
    const word = (request.query.word ?? '').trim();
    if (!word) throw new HttpError(400, 'VALIDATION_ERROR', 'A word is required');
    // Bounded so a long sentence cannot be sent as one lookup.
    if (word.length > 64) throw new HttpError(400, 'VALIDATION_ERROR', 'That is too long to be a single word');
    return ok(await lookupWord(word));
  });

  app.get('/api/search/stats', async () => ok(await getIndexStats()));

  // ---------------------------------------------------------------- passages
  app.get('/api/passages/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const passage = await getPassageById(decodeURIComponent(request.params.id));
    if (!passage) return fail(reply, 404, 'NOT_FOUND', `No passage with id ${request.params.id}`);
    return ok(passage);
  });

  app.get(
    '/api/passages/by-key/:key',
    async (request: FastifyRequest<{ Params: { key: string }; Querystring: { refresh?: string } }>, reply: FastifyReply) => {
    const key = decodeURIComponent(request.params.key);
    if (!PassageKeySchema.safeParse(key).success) {
      return fail(reply, 400, 'INVALID_KEY', 'Passage keys look like textId:book:chapter:verse, e.g. quran:2:1:255');
    }
      const passage = await getPassageByKey(key);
      if (!passage) return fail(reply, 404, 'NOT_FOUND', `No passage with key ${key}`);
      return ok({ ...passage, crossReferences: await crossReferencesFor(request, passage.id, request.query.refresh === '1') });
    }
  );

  /**
   * Cross-references, computed on first request and stored after that.
   *   GET /api/passages/:id/cross-references[?refresh=1]
   */
  app.get('/api/passages/:id/cross-references', async (request: FastifyRequest<{ Params: { id: string }; Querystring: { refresh?: string } }>, reply: FastifyReply) => {
    const id = decodeURIComponent(request.params.id);
    const passage = await getPassageById(id);
    if (!passage) return fail(reply, 404, 'NOT_FOUND', `No passage with id ${id}`);

    const result = await getCrossReferencesForPassage(passage.id, { refresh: request.query.refresh === '1' });
    return ok({ references: result.references, computed: result.computed });
  });

  app.post('/api/passages/batch', async (request: FastifyRequest<{ Body: { keys?: unknown } }>, reply: FastifyReply) => {
    const keys = request.body?.keys;
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > 50) {
      return fail(reply, 400, 'INVALID_INPUT', 'Provide 1-50 passage keys');
    }
    return ok({ passages: await getPassagesByKeys(keys as string[]) });
  });

  // ---------------------------------------------------------------- texts
  app.get('/api/texts', async () => ok(await getCorpusStats()));

  app.get('/api/texts/:textId', async (request: FastifyRequest<{ Params: { textId: string } }>, reply: FastifyReply) => {
    const textId = parse(TextIdSchema, request.params.textId);
    return ok(await getTextStats(textId));
  });

  app.get('/api/texts/:textId/books', async (request: FastifyRequest<{ Params: { textId: string } }>, reply: FastifyReply) => {
    const textId = parse(TextIdSchema, request.params.textId);
    const books = await getBooks(textId);
    return ok({ textId, books, total: books.length });
  });

  app.get('/api/texts/:textId/books/:bookId', async (request: FastifyRequest<{ Params: { textId: string; bookId: string } }>, reply: FastifyReply) => {
    const textId = parse(TextIdSchema, request.params.textId);
    const book = await getBook(textId, request.params.bookId);
    if (!book) return fail(reply, 404, 'NOT_FOUND', `No book ${request.params.bookId} in ${textId}`);
    return ok(book);
  });

  app.get(
    '/api/texts/:textId/books/:bookId/passages',
    async (request: FastifyRequest<{ Params: { textId: string; bookId: string }; Querystring: { limit?: string; offset?: string } }>, reply: FastifyReply) => {
      const textId = parse(TextIdSchema, request.params.textId);
      const limit = clamp(Number(request.query.limit ?? 100), 1, 500);
      const offset = clamp(Number(request.query.offset ?? 0), 0, Number.MAX_SAFE_INTEGER);
      const passages = await getPassagesByBook(textId, request.params.bookId, limit, offset);
      return ok({ textId, book: request.params.bookId, passages, total: passages.length, limit, offset });
    }
  );

  app.get(
    '/api/texts/:textId/books/:bookId/chapters/:chapter',
    async (request: FastifyRequest<{ Params: { textId: string; bookId: string; chapter: string } }>, reply: FastifyReply) => {
      const textId = parse(TextIdSchema, request.params.textId);
      const chapter = Number(request.params.chapter);
      if (!Number.isInteger(chapter) || chapter < 1) {
        return fail(reply, 400, 'INVALID_CHAPTER', 'Chapter must be a positive integer');
      }
      return ok({ textId, book: request.params.bookId, chapter, passages: await getPassagesByChapter(textId, request.params.bookId, chapter) });
    }
  );

  // ---------------------------------------------------------------- recommendations
  app.post('/api/recommendations', async (request: FastifyRequest) => {
    const body = parse(RecommendationBodySchema, request.body);
    return ok(await generateRecommendations({ ...body, weights: normalizeWeights(body.weights) }));
  });

  app.get(
    '/api/recommendations/explain/:sourceId/:targetId',
    async (request: FastifyRequest<{ Params: { sourceId: string; targetId: string }; Querystring: { weights?: string } }>, reply: FastifyReply) => {
      const weights = parseWeightsParam(request.query.weights);
      return ok(await getRecommendationExplanation(request.params.sourceId, request.params.targetId, weights));
    }
  );

  // ---------------------------------------------------------------- themes
  app.get('/api/themes/:theme/journey', async (request: FastifyRequest<{ Params: { theme: string }; Querystring: { texts?: string; limit?: string } }>, reply: FastifyReply) => {
    const texts = request.query.texts?.split(',').filter((t): t is TextId => TextIdSchema.safeParse(t).success);
    const limit = clamp(Number(request.query.limit ?? 20), 1, 100);
    return ok({ theme: request.params.theme, journey: await getThematicJourney(request.params.theme, texts, limit) });
  });

  app.get('/api/themes/:theme/map', async (request: FastifyRequest<{ Params: { theme: string } }>) => {
    return ok(await getThemeMap(request.params.theme));
  });

  app.get('/api/themes/:theme/shared', async (request: FastifyRequest<{ Params: { theme: string }; Querystring: { keys: string } }>, reply: FastifyReply) => {
    const keys = (request.query.keys ?? '').split(',').filter(Boolean);
    if (keys.length < 2) return fail(reply, 400, 'INVALID_INPUT', 'Pass at least two passage keys as ?keys=a,b');

    const passages = await getPassagesByKeys(keys);
    return ok({ theme: request.params.theme, sharedThemes: computeSharedThemes(passages) });
  });

  // ---------------------------------------------------------------- weights
  app.get('/api/users/:userId/weights', async (request: FastifyRequest<{ Params: { userId: string } }>) => {
    return ok(await getUserWeights(request.params.userId));
  });

  app.put('/api/users/:userId/weights', async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
    const weights = parse(WeightsBodySchema, request.body);
    await setUserWeights(request.params.userId, weights);
    return ok(weights);
  });

  // ---------------------------------------------------------------- comparison
  app.post('/api/compare', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parse(ComparisonRequestSchema, request.body);
    const result = await comparePassages(body);
    return ok({ ...result, shareUrl: generateComparisonUrl(result.passages.map((p) => p.passageKey)) });
  });

  app.get(
    '/api/compare/translations/:textId/:book/:chapter/:verse',
    async (request: FastifyRequest<{ Params: { textId: string; book: string; chapter: string; verse: string }; Querystring: { translations?: string } }>) => {
      const textId = parse(TextIdSchema, request.params.textId);
      const chapter = Number(request.params.chapter);
      const verse = Number(request.params.verse);
      if (!Number.isInteger(chapter) || !Number.isInteger(verse) || chapter < 1 || verse < 1) {
        throw new HttpError(400, 'INVALID_REFERENCE', 'Chapter and verse must be positive integers');
      }
      return ok(await getParallelTranslations(textId, request.params.book, chapter, verse, request.query.translations?.split(',')));
    }
  );

  // ---------------------------------------------------------------- admin
  app.post('/api/admin/reindex', async (request: FastifyRequest<{ Body?: { type?: string } }>, reply: FastifyReply) => {
    if (process.env.NODE_ENV === 'production' && !request.headers['x-admin-token']) {
      return fail(reply, 401, 'UNAUTHORIZED', 'Reindexing requires an x-admin-token header in production');
    }

    const job = await prisma.indexingJob.create({
      data: { type: request.body?.type ?? 'full_reindex', status: 'running', startedAt: new Date() },
    });

    try {
      await invalidateOramaIndex();
      const { initializeOramaIndex } = await import('../search/engine');
      await initializeOramaIndex();
      await prisma.indexingJob.update({ where: { id: job.id }, data: { status: 'completed', completedAt: new Date(), progress: 100 } });
      return ok({ jobId: job.id, status: 'completed' });
    } catch (error) {
      await prisma.indexingJob.update({ where: { id: job.id }, data: { status: 'failed', error: (error as Error).message } });
      throw error;
    }
  });

  app.get('/api/admin/jobs/:jobId', async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
    const job = await prisma.indexingJob.findUnique({ where: { id: request.params.jobId } });
    if (!job) return fail(reply, 404, 'NOT_FOUND', `No job ${request.params.jobId}`);
    return ok(job);
  });
}

/**
 * Cross-references for a passage, or an empty list if detection fails.
 * A slow first load should still show the passage, so detection never fails the
 * request.
 */
async function crossReferencesFor(request: FastifyRequest, passageId: string, refresh: boolean) {
  try {
    return (await getCrossReferencesForPassage(passageId, { refresh })).references;
  } catch (error) {
    request.log.warn({ err: error }, 'cross-reference detection failed; serving the passage without them');
    return [];
  }
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function parseWeightsParam(raw?: string) {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    const weights = WeightsBodySchema.safeParse(parsed);
    return weights.success ? weights.data : undefined;
  } catch {
    return undefined;
  }
}
