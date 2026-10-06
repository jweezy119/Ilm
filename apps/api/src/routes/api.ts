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
  parseCitation,
} from '@ilm/shared';
import { searchPassages, logSearch, listThemes, getIndexStats } from '../services/search';
import { crossExamine } from '../services/cross-examine';
import { compareTheme, isKnownTheme } from '../services/compare';
import { getFigure, getFiguresForPassage } from '../services/figures';
import {
  getPassageById,
  getPassageByKey,
  getPassagesByKeys,
  getPassagesByIds,
  getPassagesByBook,
  getPassagesByChapter,
  getBooks,
  getBook,
  getTextStats,
  getCorpusStats,
  prisma,
} from '../services/passage';
import { getBookReading } from '../services/reader';
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
import { getPassageJourney, DEFAULT_PER_GROUP } from '../services/journey';
import { getTopics } from '../services/topics';
import { getCitationsForPassage } from '../services/citations';
import { getRelatedPassages } from '../services/related';
import { resolveIdentity, cookieOptions, getLibrary, getSavedKeys, savePassage, removePassage, LIBRARY_COOKIE } from '../services/library';
import { corpusCache, catalogueCache } from '../lib/corpus-cache';
import { repairStatus } from '../services/sefaria-repair';
import {
  listJourneys,
  createJourney,
  renameJourney,
  deleteJourney,
  addJourneyNode,
  removeJourneyNode,
  setJourneyNodeNote,
  reorderJourney,
  getJourneyGraph,
  JourneyError,
} from '../services/journey-graph';
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
/*
 * The embedding count, memoised for much longer than coverage.
 *
 * Five minutes, because the answer changes only when something is ingested or the
 * process restarts, and a stale count on a diagnostics panel is harmless — the
 * panel says how many are embedded out of how many exist, and both of those move
 * together. The first caller after a cold start still pays the scan, which is why
 * it is opt-in rather than merely cached: a free instance sleeps, and a cold start
 * is the common case, not the edge case.
 */
let embeddedMemo: { at: number; value: number } | null = null;

async function embeddedPassageCount(): Promise<number> {
  if (embeddedMemo && Date.now() - embeddedMemo.at < 300_000) return embeddedMemo.value;

  // Counted in SQL rather than through Prisma's JSON filter, which does not
  // match an empty array reliably and reported every row as embedded.
  const [{ embedded } = { embedded: 0 }] = await prisma.$queryRaw<Array<{ embedded: number }>>`
    SELECT count(*)::int AS embedded FROM passages WHERE jsonb_array_length(embeddings) > 0
  `;
  embeddedMemo = { at: Date.now(), value: embedded };
  return embedded;
}

async function coverageCache(passages: number): Promise<Coverage> {
  if (coverageMemo && Date.now() - coverageMemo.at < 60_000) return coverageMemo.value;

  // Awaited once, here. The Orama engine answers from configuration; the Postgres
  // engine has to ask the database, and the route used to call this a second time
  // for the same answer.
  const indexedTexts = await indexedTextIds();

  /*
   * The Postgres engine indexes every text, so there is no subset to describe and
   * the DISTINCT plus per-text count below is pure cost on the one route the
   * platform polls. It was enough to push /health past 500ms on a cold pool and
   * get the service restarted for being slow — three queries to report a
   * coverage gap that does not exist.
   */
  /*
   * The corpus list comes from the `texts` table, which holds one row per corpus.
   * A DISTINCT over `passages` is the obvious way to get the same five values and
   * scans 45,453 rows to do it; the texts table is a five-row lookup.
   */
  const rows = await prisma.$queryRaw<Array<{ text_id: string }>>`
    SELECT text_id FROM texts ORDER BY text_id
  `;
  const allTexts = rows.map((r) => r.text_id);
  const value: Coverage = {
    allTexts,
    indexedTexts,
    // A per-text count is only meaningful when the engine holds a subset. When it
    // holds everything, counting again is the same number the caller already has.
    indexedPassages: indexedTexts
      ? await prisma.passage.count({ where: { textId: { in: indexedTexts as never[] } } })
      : passages,
  };
  coverageMemo = { at: Date.now(), value };
  return value;
}



export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------- health
  /*
   * Liveness only, and deliberately so.
   *
   * This route was answering with corpus statistics, which meant it counted every
   * passage to report `passagesIndexed` and parsed 45,453 JSONB values to count
   * embedded ones. The second is a full scan by nature — `jsonb_array_length` has
   * to be evaluated per row, and when every row matches the planner rightly
   * prefers a sequential scan to an index range — so it measured 1,988 ms. At
   * that cost the platform's own health check timed out, the service was
   * restarted for being slow, and it did it again on the next cold pool.
   *
   * None of that is a liveness signal. A service that cannot count its own
   * embeddings is still serving requests. So this answers from memory only, and
   * the numbers a reader or an operator actually wants live in /api/corpus,
   * which nothing polls on a timer.
   */
  app.get('/health', async () => {
    const judge = getJevJudge();

    return ok({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
      search: {
        ready: isIndexReady(),
        // Which engine answered, because the two rank differently: the in-process
        // index matches theme names and book slugs, Postgres matches the scripture.
        engine: engineName,
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
      /*
       * How often the corpus is being answered without the database.
       *
       * In memory, because it is a property of this process and disappears with
       * it, which makes it a liveness-adjacent number in the same way the rest of
       * this route is: it is here because an operator will want it and nowhere
       * else would look, and it costs nothing to read.
       */
      cache: { corpus: corpusCache.stats, catalogue: catalogueCache.stats },
    });
  });


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

  app.post('/api/cross-examine', async (request: FastifyRequest<{ Body: { query?: string } }>) => {
    const query = request.body?.query?.trim() ?? '';
    if (query.length < 2) return ok({ query, resultsByCorpus: {}, source: 'derived' });
    return ok(await crossExamine(query));
  });

  app.get('/api/themes', async () => ok({ themes: await listThemes() }));

  // ---------------------------------------------------------------- tts
  app.get('/api/tts', async (request: FastifyRequest<{ Querystring: { text?: string; lang?: string } }>, reply: FastifyReply) => {
    const text = (request.query.text ?? '').trim();
    // Default to Guy Neural for English
    const voice = request.query.lang === 'ar' ? 'ar-SA-HamedNeural' : 'en-US-GuyNeural';
    if (!text) return fail(reply, 400, 'INVALID_INPUT', 'Text is required');

    try {
      const { EdgeTTS } = await import('edge-tts-universal');
      const tts = new EdgeTTS(text, voice);
      const result = await tts.synthesize();
      
      const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
      reply.header('Content-Type', 'audio/mpeg');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(audioBuffer);
    } catch (e) {
      return fail(reply, 502, 'BAD_GATEWAY', 'Failed to fetch TTS: ' + (e as Error).message);
    }
  });

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

  app.get('/api/passages/:id/markdown', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = decodeURIComponent(request.params.id);
    const passage = await getPassageById(id);
    if (!passage) return reply.status(404).type('text/markdown').send('# Not Found\n\nThe requested passage was not found.');
    
    // We fetch cross-references to give the LLM a rich response
    const { references } = await getCrossReferencesForPassage(passage.id, { refresh: false });
    
    let md = `# ${passage.passageKey}\n\n`;
    md += `**Corpus:** ${passage.textId}\n`;
    md += `**Book:** ${passage.book}\n`;
    md += `**Chapter:** ${passage.chapter}\n`;
    md += `**Verse:** ${passage.verse}\n\n`;
    md += `## Text\n${passage.translation}\n\n`;
    
    if (passage.originalText) {
      md += `## Original Text\n${passage.originalText}\n\n`;
    }
    
    if (references && references.length > 0) {
      md += `## Cross-References\n`;
      // Fetch the actual passage text for the references
      const targetIds = references.slice(0, 10).map(r => r.targetPassageId);
      const targetPassages = await getPassagesByIds(targetIds);
      
      references.slice(0, 10).forEach(ref => {
        const p = targetPassages.find(p => p.id === ref.targetPassageId);
        if (p) {
          md += `- **${p.passageKey}**: ${p.translation}\n`;
        }
      });
      md += `\n`;
    }
    
    return reply.status(200).type('text/markdown').send(md);
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
   * The curated topics behind the quick links.
   *   GET /api/topics
   *
   * Counts are measured per request rather than stored, because a corpus that
   * gains or loses passages should not leave a stale number on a link the reader
   * is about to trust. Topics under the coverage floor are omitted entirely.
   */
  app.get('/api/topics', async () => ok({ topics: await getTopics() }));

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

  /**
   * The themed journey outward from one passage.
   *   GET /api/passages/:id/journey[?limit=n&texts=a,b]
   *
   * Distinct from /cross-references: those are detected links to this passage,
   * capped and flat. This walks the themes the passage carries and collects the
   * other passages sharing each one, so the answer is grouped by context rather
   * than by strength.
   *
   * `texts` restricts the corpora searched, which is how the reader narrows a
   * journey to the traditions they care about instead of scrolling five of them.
   */
  app.get('/api/passages/:id/journey', async (request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: string; texts?: string } }>, reply: FastifyReply) => {
    const id = decodeURIComponent(request.params.id);
    const passage = await getPassageById(id);
    if (!passage) return fail(reply, 404, 'NOT_FOUND', `No passage with id ${id}`);

    // A limit of 0 or 1000 is a client bug, not a request for everything, so it
    // is clamped rather than honoured. `slice(0, 0)` would return no groups and
    // look like a passage with no themes.
    // Clamped like the theme journey's limit: a per-group page size, not a
    // request for the whole corpus.
    const limit = clamp(Number(request.query.limit ?? DEFAULT_PER_GROUP), 1, 20);
    const texts = request.query.texts?.split(',').filter((t): t is TextId => TextIdSchema.safeParse(t).success);

    return ok(await getPassageJourney(passage, { limit, texts }));
  });

  /**
   * Cross-corpus citations for one passage.
   *   GET /api/passages/:id/citations[?limit=n]
   *
   * Distinct from /cross-references, which is a mixed ranked list. This is only
   * the verbatim cross-corpus matches, with the shared words attached, grouped by
   * which corpus they come from.
   */
  app.get('/api/passages/:id/citations', async (request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const id = decodeURIComponent(request.params.id);
    const passage = await getPassageById(id);
    if (!passage) return fail(reply, 404, 'NOT_FOUND', `No passage with id ${id}`);

    const parsed = Number(request.query.limit);
    const limit = Number.isFinite(parsed) ? Math.min(60, Math.max(1, Math.trunc(parsed))) : undefined;

    return ok(await getCitationsForPassage(passage.id, { limit }));
  });

  /**
   * Everything on the site that relates to this passage, ranked and labelled.
   *   GET /api/passages/:id/related
   *
   * Merges the three relation families that were previously in three places, each
   * of which answered a third of the question: verbatim citation, model-detected
   * relation, shared theme. Each row says which kind it is, because an eleven-word
   * verbatim run and a shared theme are not the same claim.
   */
  /*
   * Which figures a passage names, so the relation is offered from the passage page
   * where a reader meets the figure, and not only from a figure index they would
   * have to know to look for.
   */
  app.get('/api/passages/:id/figures', async (request: FastifyRequest<{ Params: { id: string } }>) => {
    return ok({ figures: await getFiguresForPassage(request.params.id) });
  });

  app.get('/api/passages/:id/related', async (request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const id = decodeURIComponent(request.params.id);
    const passage = await getPassageById(id);
    if (!passage) return fail(reply, 404, 'NOT_FOUND', `No passage with id ${id}`);

    const parsed = Number(request.query.limit);
    const limit = Number.isFinite(parsed) ? Math.min(20, Math.max(1, Math.trunc(parsed))) : undefined;

    return ok(await getRelatedPassages(passage.id, { limit }));
  });

  /**
   * Resolve a typed citation to real passages.
   *   GET /api/passages/resolve?ref=John+3:16
   *
   * Parsing happens in @ilm/shared, but existence is checked here: "Gen 1:1"
   * parses to two keys, and a key that is not in the database is a dead link.
   * The response lists only the references that resolve, so the caller can offer
   * a choice without a second round trip to find out which choices are real.
   */
  app.get('/api/passages/resolve', async (request: FastifyRequest<{ Querystring: { ref?: string } }>, reply: FastifyReply) => {
    const ref = (request.query.ref ?? '').trim();
    if (ref.length === 0) return fail(reply, 400, 'INVALID_INPUT', 'Pass a reference as ?ref=John+3:16');

    const matches = parseCitation(ref);
    if (matches.length === 0) {
      // Not an error: "mercy" is not a citation, and the caller falls back to
      // searching it. Reported as a successful empty result so the two are
      // distinguishable.
      return ok({ reference: ref, matches: [] });
    }

    const passages = await getPassagesByKeys(matches.map((m) => m.passageKey));
    const found = new Map(passages.map((p) => [p.passageKey, p]));

    return ok({
      reference: ref,
      matches: matches
        .filter((m) => found.has(m.passageKey))
        .map((m) => {
          const passage = found.get(m.passageKey)!;
          return {
            passageId: passage.id,
            passageKey: m.passageKey,
            textId: passage.textId,
            book: m.bookLabel,
            chapter: m.chapter,
            verse: m.verse,
            translation: passage.translation,
            originalText: passage.originalText ?? '',
          };
        }),
    });
  });

  /*
   * The reader's library.
   *
   * Every route below resolves an anonymous id from a cookie, minting one if it is
   * absent and setting it on the reply. There is no account and no signup: a tool
   * people open to check a reference cannot put an email wall in front of "save
   * this verse". The cost is that clearing cookies loses the library, which is
   * why a saved passage is treated as a staging area for a citation rather than
   * as the artefact.
   */
  const identityOf = (request: FastifyRequest, reply: FastifyReply) => {
    const identity = resolveIdentity(request.cookies?.[LIBRARY_COOKIE]);
    if (identity.isNew) reply.setCookie(LIBRARY_COOKIE, identity.userId, cookieOptions());
    return identity.userId;
  };

  app.get('/api/library', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    return ok({ entries: await getLibrary(userId) });
  });

  /** Just the keys, for the save buttons. Cheaper than the hydrated list. */
  app.get('/api/library/keys', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    return ok({ keys: await getSavedKeys(userId) });
  });

  app.post('/api/library', async (request: FastifyRequest<{ Body: { passageKey?: string; collectionId?: string | null } }>, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    const passageKey = (request.body?.passageKey ?? '').trim();
    if (!passageKey) return fail(reply, 400, 'INVALID_INPUT', 'passageKey is required');

    try {
      return ok(await savePassage(userId, passageKey, request.body?.collectionId));
    } catch (error) {
      // A key that parses but is not in the corpus is a client bug — a stale
      // bookmark, or a fabricated key — and a 404 is the honest answer.
      return fail(reply, 404, 'NOT_FOUND', error instanceof Error ? error.message : 'Passage not found');
    }
  });

  app.delete('/api/library/:passageKey', async (request: FastifyRequest<{ Params: { passageKey: string } }>, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    const removed = await removePassage(userId, decodeURIComponent(request.params.passageKey));
    // Deleting something that is not there is the state the caller wanted, so
    // this is a success rather than a 404.
    return ok({ removed });
  });

  /* ==========================================================================
     Journeys
     ========================================================================== */

  /**
   * One error shape for the whole journey surface.
   *
   * The service already distinguishes "not yours" from "that passage is not in
   * the corpus" from "you have too many", and those are genuinely different
   * answers. What they share is a code the client can branch on, which is why
   * this exists rather than a bare catch.
   */
  const journeyFail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof JourneyError) {
      const code =
        error.status === 404 ? 'NOT_FOUND' : error.status === 409 ? 'CONFLICT' : 'INVALID_INPUT';
      return fail(reply, error.status, code, error.message);
    }
    // Anything else is ours, and the global handler already masks its message in
    // production — so rethrowing rather than reporting it as a bad request.
    throw error;
  };

  app.get('/api/journeys', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    return ok({ journeys: await listJourneys(userId) });
  });

  app.post('/api/journeys', async (request: FastifyRequest<{ Body: { name?: string; description?: string } }>, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    const body = request.body ?? {};
    if (typeof body.name !== 'string') {
      return fail(reply, 400, 'INVALID_INPUT', 'name is required');
    }
    try {
      return ok({ journey: await createJourney(userId, { name: body.name, description: body.description }) });
    } catch (error) {
      return journeyFail(reply, error);
    }
  });

  app.get('/api/journeys/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    try {
      return ok({ graph: await getJourneyGraph(userId, request.params.id) });
    } catch (error) {
      return journeyFail(reply, error);
    }
  });

  app.patch('/api/journeys/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: { name?: string; description?: string | null } }>, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    try {
      return ok({ journey: await renameJourney(userId, request.params.id, request.body ?? {}) });
    } catch (error) {
      return journeyFail(reply, error);
    }
  });

  app.delete('/api/journeys/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    try {
      await deleteJourney(userId, request.params.id);
      return ok({ removed: true });
    } catch (error) {
      return journeyFail(reply, error);
    }
  });

  app.post('/api/journeys/:id/nodes', async (request: FastifyRequest<{ Params: { id: string }; Body: { passageKey?: string } }>, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    const passageKey = (request.body?.passageKey ?? '').trim();
    if (!passageKey) return fail(reply, 400, 'INVALID_INPUT', 'passageKey is required');
    try {
      return ok(await addJourneyNode(userId, request.params.id, passageKey));
    } catch (error) {
      // A key that parses but names no passage is the same client bug as the
      // library's 404: a stale link, or a fabricated key.
      if (error instanceof z.ZodError) {
        return fail(reply, 400, 'INVALID_INPUT', 'That does not look like a passage reference.');
      }
      return journeyFail(reply, error);
    }
  });

  app.delete('/api/journeys/:id/nodes/:passageKey', async (request: FastifyRequest<{ Params: { id: string; passageKey: string } }>, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    try {
      return ok(await removeJourneyNode(userId, request.params.id, decodeURIComponent(request.params.passageKey)));
    } catch (error) {
      return journeyFail(reply, error);
    }
  });

  app.put('/api/journeys/:id/nodes/:passageKey/note', async (request: FastifyRequest<{ Params: { id: string; passageKey: string }; Body: { note?: string | null } }>, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    try {
      return ok(await setJourneyNodeNote(userId, request.params.id, decodeURIComponent(request.params.passageKey), request.body?.note ?? null));
    } catch (error) {
      return journeyFail(reply, error);
    }
  });

  /**
   * The order the reader wants, as passage keys.
   *
   * Deliberately not a list of positions. What the client has after the reader
   * dragged something is an order of rows, and translating it server-side is
   * where two nodes end up claiming one slot.
   */
  app.put('/api/journeys/:id/order', async (request: FastifyRequest<{ Params: { id: string }; Body: { keys?: unknown } }>, reply: FastifyReply) => {
    const userId = identityOf(request, reply);
    const keys = request.body?.keys;
    if (!Array.isArray(keys)) {
      return fail(reply, 400, 'INVALID_INPUT', 'keys must be an array of passage keys');
    }
    if (keys.length > 500) {
      return fail(reply, 400, 'INVALID_INPUT', 'Send at most 500 keys in one reorder');
    }
    try {
      return ok(await reorderJourney(userId, request.params.id, keys.filter((k): k is string => typeof k === 'string')));
    } catch (error) {
      return journeyFail(reply, error);
    }
  });

  /*
   * Whether the Sefaria check is working, without a shell.
   *
   * Two failures look identical from outside and need opposite responses: a
   * deploy that never happened, where the corpus stays broken and the fix is to
   * deploy; and a deploy that ran but cannot reach Sefaria, where the corpus
   * stays broken and the fix is to stop asking Sefaria. `everRan` separates
   * them, and `lastReport` says which happened.
   *
   * Nothing secret is in here — corpus counts and timings. It is on the public
   * API, so it reports the shape of the work rather than any of it.
   */
  app.get('/api/maintenance/sefaria', async () => ok(repairStatus()));

  app.post('/api/passages/batch', async (request: FastifyRequest<{ Body: { keys?: unknown } }>, reply: FastifyReply) => {
    const keys = request.body?.keys;
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > 50) {
      return fail(reply, 400, 'INVALID_INPUT', 'Provide 1-50 passage keys');
    }
    return ok({ passages: await getPassagesByKeys(keys as string[]) });
  });

  // ---------------------------------------------------------------- texts
  /*
   * Corpus statistics, and the home of the numbers that used to sit on /health.
   *
   * Nothing polls this on a timer, so it can afford to be thorough. The embedded
   * count in particular has to parse 45,453 JSONB values, which is ~2s and is why
   * it moved off the liveness route rather than being made faster — there is no
   * faster way to evaluate jsonb_array_length across every row, because when every
   * row matches, a sequential scan is the correct plan.
   */
  /*
   * `?include=embeddings` is opt-in because the query it guards is ruinous.
   *
   *   SELECT count(*) FROM passages WHERE jsonb_array_length(embeddings) > 0
   *
   * took 53.6 seconds on its own, measured against production: a full scan that
   * evaluates a JSON function over all 45,453 rows, every one of which carries an
   * embedding vector. It sat on this route unguarded and unmemoised, so every
   * page load paid it, and at 61 seconds the whole request crossed Render's 60
   * second limit and came back as a 500 through the web proxy.
   *
   * Which meant `fetchCoverage()` had been failing silently in production for as
   * long as this route existed: the unindexed markers on the search filters, the
   * partial-coverage warning, and the "this deployment searches only some of the
   * texts" copy were all dead, because the one call they shared never resolved.
   *
   * Only the settings page displays embedding counts. The search page needs
   * coverage and nothing else, so the scan is now asked for explicitly and
   * memoised for anyone who does.
   */
  app.get('/api/texts', async (request: FastifyRequest<{ Querystring: { include?: string } }>) => {
    const stats = await getCorpusStats();
    const passages = stats.totals.passages;
    const coverage = await coverageCache(passages);

    const wanted = (request.query?.include ?? '').split(',').includes('embeddings');
    const embeddingConfig = getEmbeddingConfig();

    return ok({
      ...stats,
      search: {
        passagesIndexed: coverage.indexedPassages,
        passagesTotal: passages,
        indexedTexts: coverage.indexedTexts ?? coverage.allTexts,
        unindexedTexts: coverage.allTexts.filter((t) => !new Set(coverage.indexedTexts ?? coverage.allTexts).has(t)),
        partial: coverage.indexedPassages < passages,
      },
      embeddings: {
        provider: embeddingConfig?.provider ?? null,
        model: embeddingConfig?.model ?? null,
        embedded: wanted ? await embeddedPassageCount() : null,
        of: passages,
      },
    });
  });

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

  /*
   * Reading, as against searching.
   *
   * One chapter per request, with the chapter list, the English translations and
   * the neighbouring books attached, so turning a page needs no further round trip.
   * The original text travels with the English rather than behind a toggle: a
   * reader working through a Hebrew or Arabic scripture wants both at once, and
   * naming the source beside the rendering is this project's standing rule.
   */
  app.get('/api/texts/:textId/books/:bookId/read', async (request: FastifyRequest<{ Params: { textId: string; bookId: string }; Querystring: { chapter?: string; translation?: string } }>, reply: FastifyReply) => {
    const textId = parse(TextIdSchema, request.params.textId);
    const bookId = request.params.bookId;
    const reading = await getBookReading(textId, bookId, {
      chapter: request.query.chapter ? Number(request.query.chapter) : undefined,
      translationId: request.query.translation,
    });
    if (!reading) {
      return fail(reply, 404, 'NOT_FOUND', `No book ${bookId} in ${textId}, or it has no English translation`);
    }
    return ok(reading);
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

  /*
   * One theme, one column per tradition.
   *
   * `bar` is a query parameter rather than a constant so the reader can move it and
   * see what changes, which is the point: the bar decides which columns exist, so
   * hiding it would make an absence of evidence look like an absence of content.
   *
   * An unknown theme is a 404 rather than an empty comparison. A theme with no
   * labelled passages anywhere is a valid 200 with every column absent, which is a
   * different answer from a theme that does not exist.
   */
  /*
   * A figure named across traditions.
   *
   * `?figure=` on the passage route rather than a second one, because the question
   * "which figures does this passage name" is a property of the passage and there
   * is exactly one passage.
   */
  app.get('/api/figures/:slug', async (request: FastifyRequest<{ Params: { slug: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const limit = clamp(Number(request.query.limit ?? 4), 1, 12);
    const figure = await getFigure(request.params.slug, limit);
    if (!figure) return fail(reply, 404, 'NOT_FOUND', `No figure called "${request.params.slug}"`);
    return ok(figure);
  });

  app.get('/api/themes/:theme/compare', async (request: FastifyRequest<{ Params: { theme: string }; Querystring: { bar?: string; texts?: string; per?: string } }>, reply: FastifyReply) => {
    const theme = request.params.theme;
    if (!isKnownTheme(theme)) return fail(reply, 404, 'NOT_FOUND', `"${theme}" is not a theme in the taxonomy`);

    const requested = Number(request.query.bar);
    const bar = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), 1) : undefined;
    const texts = request.query.texts?.split(',').filter((t): t is TextId => TextIdSchema.safeParse(t).success);
    const per = Number(request.query.per);
    const perColumn = Number.isFinite(per) ? Math.min(Math.max(per, 1), 10) : undefined;

    return ok(await compareTheme(theme, { bar, texts, perColumn }));
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
