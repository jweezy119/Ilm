/**
 * Search service
 *
 * Orama ranks candidates in-process; Postgres hydrates them into full passages
 * with themes and cross-references. Intent classification from Jev is advisory —
 * it annotates results and shapes suggestions, it does not gate them.
 */

import { SearchQuery, SearchResponse, SearchResult, Passage, TextId, SearchIntent, CorpusVerdict, MatchMode } from '@ilm/shared';
import { searchIndex, getIndexedPassage, getIndexedThemes, initializeOramaIndex, type PassageDoc } from '../search/engine';
import { getPassagesByKeys, prisma } from './passage';
import { classifySearchIntent, localIntent, expandQueryTheme, rerankForQuery, blendSearchScore, themeSearchTerms, significantTerms, type QueryExpansion, type ScoreSource } from './typesafe';

export { initializeOramaIndex };

const MAX_HYDRATE = 100;

/**
 * Hits examined beyond the requested page. Coverage filtering happens after the
 * index returns, so without a wider window the reported total would just be the
 * page size.
 */
const EXAMINATION_SLACK = 200;

// ============================================================================
// UNIFIED SEARCH
// ============================================================================

export async function searchPassages(query: SearchQuery): Promise<SearchResponse> {
  const startedAt = Date.now();

  const intent = query.intent
    ? { intent: query.intent as SearchIntent, confidence: 1, probabilities: {}, source: 'derived' as const }
    : await classifySearchIntent(query.query);

  // Widen the query when it names a theme the literal words miss. The full-text
  // pass runs first so we only pay for expansion when recall looks thin.
  const firstPass = await runFullText(query.query, query);

  let expansion: QueryExpansion = { theme: null, confidence: 0, source: 'derived' };
  if (query.expand !== false && firstPass.count < THIN_RECALL) {
    expansion = await expandQueryTheme(query.query);
  }

  const indexResult = expansion.theme ? await runExpanded(query.query, query, expansion.theme) : firstPass;

  const passages = await getPassagesByKeys(indexResult.hits.map((h) => h.document.passageKey));
  const byKey = new Map(passages.map((p) => [p.passageKey, p]));

  // Full-text order is the starting point. Jev then re-ranks it when available.
  const terms = queryTerms(query.query);

  const candidates = indexResult.hits
    .map((hit) => ({ hit, passage: byKey.get(hit.document.passageKey) }))
    .filter((c): c is { hit: typeof c.hit; passage: Passage } => Boolean(c.passage))
    .map((c) => ({ ...c, textScore: scoreCandidate(normalizeBm25(c.hit.score), c.hit.document.density, termCoverage(c.passage, terms)) }))
    // A passage that contains none of the query's words is not a weak match, it
    // is a different passage. Dropping it is what makes a long query usable.
    .filter((c) => terms.length === 0 || c.textScore > 0);

  // Two cases, and they need different numbers.
  //
  // When nothing was filtered out, the index's own count is accurate and we
  // should report it: "mercy" really does match 736 passages, even though only
  // the first hundred were examined. When coverage did filter, the index count is
  // inflated by passages that merely shared a common word, so the filtered count
  // is the honest one.
  const windowSize = Math.min(query.limit + query.offset + EXAMINATION_SLACK, MAX_HYDRATE);
  const total = candidates.length >= windowSize && indexResult.count > candidates.length ? indexResult.count : candidates.length;

  const reranked = query.semantic === false ? null : await rerankForQuery(query.query, candidates.map((c) => c.passage));

  const ordered = reranked
    ? [...candidates].sort((a, b) => {
        const keyA = a.passage.passageKey;
        const keyB = b.passage.passageKey;
        const rankA = reranked.order.indexOf(keyA);
        const rankB = reranked.order.indexOf(keyB);
        // Anything Jev did not see keeps its full-text position, after the rest.
        if (rankA === -1 || rankB === -1) return rankA === -1 ? 1 : -1;
        return rankA - rankB;
      })
    : candidates;

  const results: SearchResult[] = ordered.map(({ passage, textScore }) => {
    const semanticScore = reranked?.relevance[passage.passageKey];
    return {
      passage,
      score: semanticScore === undefined ? textScore : blendSearchScore(semanticScore, textScore),
      matchedFields: matchedFields(passage, query.query),
      highlights: buildHighlights(passage, query.query),
      intentConfidence: intent.confidence || undefined,
      textScore,
      ...(semanticScore === undefined ? {} : { semanticScore }),
    };
  });

  return {
    results: results.slice(query.offset, query.offset + query.limit),
    total,
    query,
    tookMs: Date.now() - startedAt,
    suggestions: buildSuggestions(query.query, intent.intent),
    intent: intent.intent,
    intentSource: intent.source,
    verdict: reranked?.verdict ?? 'unknown',
    // Off the reply, so a fallback engine is reported as itself.
    rerankSource: reranked?.source ?? 'derived',
    expandedTheme: expansion.theme,
    // Carried through from the retrieval layer so the UI can say when the
    // results came from the trigram fallback rather than the query as typed.
    matchMode: (indexResult.matchMode ?? 'exact') as MatchMode,
  };
}

/** Below this many literal hits, a query is probably phrased in other words. */
const THIN_RECALL = 5;

/** How much a passage's scored density can lift its full-text rank. */
const DENSITY_WEIGHT = Number(process.env.SEARCH_DENSITY_WEIGHT ?? 0.15);

/**
 * A multi-word query must not match on a single common word.
 *
 * The index tokenises and matches any term, so "divine compassion for the humble"
 * ranks every passage containing "humble" — tens of thousands of them, none of
 * them answering the question. Coverage measures what fraction of the query's
 * meaningful words a passage actually contains, which turns that noise back into
 * relevance. It is also the fallback that keeps literal search usable when Jev is
 * not configured to re-rank.
 */
const COVERAGE_WEIGHT = Number(process.env.SEARCH_COVERAGE_WEIGHT ?? 0.65);

function queryTerms(query: string): string[] {
  return [...significantTerms(query)].map((term) => term.toLowerCase()).filter((term) => term.length > 2);
}

function termCoverage(passage: Passage, terms: string[]): number {
  if (terms.length === 0) return 1;

  const haystack = passage.translation.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (haystack.includes(term)) hits += 1;
  }
  return hits / terms.length;
}

/**
 * Combine full-text relevance with coverage and density.
 *
 * Coverage scales the score down rather than pushing it up, so a passage that
 * contains every query word keeps its own full-text score and one that contains
 * half is discounted. Scaling up instead saturated every strong result at 1.00,
 * which reads as a bug and destroys the ordering the UI displays.
 */
function scoreCandidate(bm25: number, density: number, coverage: number): number {
  const safeDensity = Number.isFinite(density) ? density : 0;
  const covered = bm25 * (1 - COVERAGE_WEIGHT * (1 - coverage)) * (1 + DENSITY_WEIGHT * safeDensity);
  return Number.isFinite(covered) ? Math.min(1, covered) : 0;
}

async function runFullText(term: string, query: SearchQuery) {
  return searchIndex({
    term,
    textIds: query.filters?.texts,
    books: query.filters?.books,
    chapters: query.filters?.chapters,
    languages: query.filters?.languages,
    themes: query.filters?.themes,
    limit: Math.min(query.limit + query.offset + EXAMINATION_SLACK, MAX_HYDRATE),
    offset: 0,
    properties: ['translation', 'book', 'themes'],
  });
}

/**
 * Widen a query with a theme's vocabulary, keeping the literal matches.
 * Orama has no OR operator across terms, so the theme's strongest term stands in
 * for the query and the literal term is passed as a second property search.
 */
async function runExpanded(term: string, query: SearchQuery, theme: string) {
  const terms = themeSearchTerms(theme);
  if (terms.length === 0) return runFullText(term, query);

  const candidates: PassageDoc[] = [];
  const seen = new Set<string>();

  const add = (hits: Array<{ document: PassageDoc }>) => {
    for (const hit of hits) {
      if (seen.has(hit.document.passageKey)) continue;
      seen.add(hit.document.passageKey);
      candidates.push(hit.document);
    }
  };

  // Literal matches first, so an exact hit is never demoted by the widening.
  const literal = await runFullText(term, query);
  add(literal.hits);

  for (const themeTerm of terms.slice(0, 3)) {
    add(
      (
        await searchIndex({
          term: themeTerm,
          textIds: query.filters?.texts,
          books: query.filters?.books,
          chapters: query.filters?.chapters,
          languages: query.filters?.languages,
          limit: Math.min(query.limit + query.offset + EXAMINATION_SLACK, MAX_HYDRATE),
          properties: ['translation', 'themes'],
        })
      ).hits
    );
  }

  return {
    hits: candidates.map((document, i) => ({ document, score: Math.max(0.1, 1 - i / candidates.length) })),
    count: candidates.length,
    elapsedMs: 0,
    // The theme terms are always matched exactly, so the widened set is only as
    // relaxed as the literal query the reader actually typed was.
    matchMode: literal.matchMode,
  };
}

function matchedFields(passage: Passage, term: string): string[] {
  const fields: string[] = [];
  if (matches(passage.translation, term)) fields.push('translation');
  if (passage.themes.some((theme: { theme: string }) => theme.theme.includes(term.toLowerCase()))) fields.push('themes');
  return fields;
}

/** BM25 grows without bound; map it to 0-1 while keeping the ordering. */
function normalizeBm25(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.min(1, score / (score + 6));
}

function matches(text: string, term: string): boolean {
  if (!term.trim()) return false;
  return text.toLowerCase().includes(term.toLowerCase());
}

function buildHighlights(passage: Passage, term: string): Record<string, string[]> {
  const highlights: Record<string, string[]> = {};
  if (!term.trim()) return highlights;

  if (matches(passage.translation, term)) highlights.translation = [snippet(passage.translation, term)];
  if (passage.themes.length > 0) highlights.themes = passage.themes.slice(0, 3).map((t) => t.theme);

  return highlights;
}

function snippet(text: string, term: string, radius = 90): string {
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index === -1) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;

  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + term.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

// ============================================================================
// SINGLE PASSAGE LOOKUPS
// ============================================================================

export async function findByPassageKey(key: string): Promise<{ doc: PassageDoc; passage: Passage } | null> {
  const doc = await getIndexedPassage(key);
  if (!doc) return null;

  const passage = await getPassagesByKeys([key]).then((rows) => rows[0] ?? null);
  if (!passage) return null;

  return { doc, passage };
}

export async function getRandomPassage(textId?: TextId): Promise<Passage | null> {
  const { hits } = await searchIndex({ term: '', textIds: textId ? [textId] : undefined, limit: 500, sortBy: 'verseOrder' });
  if (hits.length === 0) return null;

  const pick = hits[Math.floor(Math.random() * hits.length)];
  const rows = await getPassagesByKeys([pick.document.passageKey]);
  return rows[0] ?? null;
}

/** Distinct theme names present in the index. */
export async function listThemes(): Promise<string[]> {
  return getIndexedThemes();
}

/** Search restricted to passages carrying a given theme. */
export async function searchByTheme(
  theme: string,
  options: { limit?: number; textIds?: TextId[] } = {}
): Promise<Passage[]> {
  const result = await searchIndex({
    term: '',
    themes: [theme],
    textIds: options.textIds,
    limit: options.limit ?? 50,
    sortBy: 'verseOrder',
  });
  const rows = await getPassagesByKeys(result.hits.map((h) => h.document.passageKey));
  return rows;
}

export async function getIndexStats(): Promise<{ totalDocuments: number; byText: Record<string, number> }> {
  const result = await searchIndex({ term: '', limit: MAX_HYDRATE });
  const byText: Record<string, number> = {};
  for (const hit of result.hits) {
    byText[hit.document.textId] = (byText[hit.document.textId] ?? 0) + 1;
  }
  return { totalDocuments: result.count, byText };
}

// ============================================================================
// SUGGESTIONS
// ============================================================================

const INTENT_SUGGESTIONS: Record<string, string[]> = {
  comparison: ['compare', 'side by side', 'versus'],
  explanation: ['meaning', 'significance'],
  thematic_study: ['theme', 'across texts'],
  linguistic_analysis: ['etymology', 'original language'],
  cross_reference: ['quoted in', 'parallel to'],
  reading: ['full text', 'chapter'],
};

function buildSuggestions(query: string, intent: string): string[] {
  const suffixes = INTENT_SUGGESTIONS[intent] ?? INTENT_SUGGESTIONS[localIntent(query).intent] ?? [];
  return suffixes.map((suffix) => `${query.trim()} ${suffix}`.trim());
}

// ============================================================================
// ANALYTICS
// ============================================================================

export async function logSearch(params: {
  query: string;
  intent?: string;
  filters?: unknown;
  resultCount: number;
  tookMs: number;
  userId?: string;
  sessionId?: string;
}): Promise<void> {
  try {
    await prisma.searchLog.create({
      data: {
        query: params.query,
        intent: params.intent ?? 'unknown',
        filters: (params.filters ?? {}) as never,
        resultCount: params.resultCount,
        tookMs: params.tookMs,
        userId: params.userId ?? null,
        sessionId: params.sessionId ?? null,
        ipHash: null,
      },
    });
  } catch (error) {
    // Analytics must never break a search.
    console.error('[search] could not log search:', (error as Error).message);
  }
}
