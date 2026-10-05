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
import { xlingualTermsForTheme } from './xlingual';
import type { WidenedTerm, WidenedLabel } from './xlingual';
import { classifySearchIntent, localIntent, expandQueryTheme, rerankForQuery, blendSearchScore, themeSearchTerms, significantTerms, type QueryExpansion, type ScoreSource } from './typesafe';
import { matchesAnyReading } from '../lib/script-normalize';

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

/**
 * Total time this search may spend waiting on the judge.
 *
 * A per-call timeout bounds each call and not the search, and a search makes up to
 * three: intent, then theme expansion, then the rerank. Three bounded calls still
 * sum to a wait, and a reader who typed a word is watching the clock through all
 * of it.
 *
 * Measured on the deployed service: a search was 8.7 seconds, of which the text
 * search was 2.5 and the judge was 6.2 — and theme expansion alone was 5.1 of
 * that, because it fires on almost every query. The corpus has nothing to do with
 * it: dropping the whole New Testament moved it by one per cent.
 *
 * So the budget is spent across the search rather than per call. Once it is gone,
 * the remaining steps use local scoring, which is already implemented and already
 * labelled `derived` rather than `jev` — the reader is told which they got, so
 * being faster costs no honesty.
 */
const JUDGE_BUDGET_MS = Number(process.env.SEARCH_JUDGE_BUDGET_MS ?? 2500);

export async function searchPassages(query: SearchQuery): Promise<SearchResponse> {
  const startedAt = Date.now();
  const judgeDeadline = startedAt + JUDGE_BUDGET_MS;
  const judgeLeft = () => Date.now() < judgeDeadline;

  /*
   * The text search and the intent classification run together.
   *
   * They did not have to be sequential: the full-text pass takes filters and a
   * limit, never the intent, so starting the judge call only after the database
   * answered made every search wait for both to finish one after the other rather
   * than for the slower of the two. The rerank further down still waits for the
   * candidates, because it scores them.
   */
  const intentPromise = query.intent
    ? Promise.resolve({ intent: query.intent as SearchIntent, confidence: 1, probabilities: {}, source: 'derived' as const })
    : // Local classification is not a degraded path: it is the same shape, labelled
      // as derived, and it costs nothing. The judge is consulted when there is
      // budget for it and skipped when there is not.
      (judgeLeft() ? classifySearchIntent(query.query) : Promise.resolve(localIntent(query.query)));

  // Widen the query when it names a theme the literal words miss. The full-text
  // pass runs first so we only pay for expansion when there is a reason to.
  const firstPass = await runFullText(query.query, query);
  const intent = await intentPromise;

  /*
   * Two reasons to widen, and the second is the one that matters.
   *
   * The first is thin recall: the words are wrong, so find the passages anyway.
   * That was the only condition until the cross-lingual map existed, and it is the
   * wrong condition for it. "wisdom" is not a thin-recall query — it matches
   * hundreds of passages — but every one of those matches is an English
   * translation, so the Hebrew, Greek, Arabic and Aramaic passages carrying the
   * theme were all invisible while the result count looked perfectly healthy.
   *
   * The gap is not "we found too little". It is "we found nothing in the languages
   * the reader did not ask in", and the only way to see that from the outside is to
   * check whether any literal hit reached the original text at all.
   *
   * Which also keeps the cost honest: a reader who typed Hebrew and was shown
   * Hebrew does not get a widening, and the searches that already work pay for
   * nothing.
   */
  const reachedOriginal = firstPass.hits.some((h) => (h.document.matchedIn ?? '').includes('original'));
  const shouldWiden = firstPass.count < THIN_RECALL || !reachedOriginal;

  let expansion: QueryExpansion = { theme: null, confidence: 0, source: 'derived' };
  if (query.expand !== false && shouldWiden) {
    /*
     * The widening is the single most expensive thing a search does — it reached
     * the judge on nearly every query, because "did we reach the original text"
     * is false for an English query almost by definition.
     *
     * It is also the most worth skipping. A widening improves recall across
     * languages for a query whose literal words miss; it does not make a result
     * more correct. Spending the whole budget on it meant a reader waited five
     * seconds for a better-ranked list, and got none of that when the budget was
     * gone.
     */
    if (judgeLeft()) {
      expansion = await expandQueryTheme(query.query);
    }
  }

  const indexResult = expansion.theme ? await runExpanded(query.query, query, expansion.theme) : firstPass;

  const passages = await getPassagesByKeys(indexResult.hits.map((h) => h.document.passageKey));
  const byKey = new Map(passages.map((p) => [p.passageKey, p]));

  // Full-text order is the starting point. Jev then re-ranks it when available.
  const terms = queryTerms(query.query);

  const candidates = indexResult.hits
    .map((hit) => ({ hit, passage: byKey.get(hit.document.passageKey) }))
    .filter((c): c is { hit: typeof c.hit; passage: Passage } => Boolean(c.passage))
    .map((c) => ({
      ...c,
      textScore: scoreCandidate(
        normalizeBm25(c.hit.score),
        c.hit.document.density,
        termCoverage(c.passage, terms, indexResult.provenance?.get(c.passage.passageKey))
      ),
    }))
    /*
     * Sort by the score we are about to report, not by the index's BM25 order.
     *
     * `scoreCandidate` is not BM25: it multiplies in query-term coverage and
     * result density, so the reported number and the index's own order drift apart.
     * Without this sort the literal path returns a list that disagrees with its own
     * scores — a live search for "sabbath" put a passage scoring 0.0625 above one
     * scoring 0.0672, thirty-eighth row, so the reader saw 6% above 7%.
     *
     * Stable, so passages with equal scores keep the index's ordering and the
     * result is deterministic across identical requests.
     */
    .sort((a, b) => b.textScore - a.textScore)
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

  // Last, because it re-scores the candidates and so is the step most
  // improved by the search having gone quickly to get them.
  const reranked = query.semantic === false || !judgeLeft() ? null : await rerankForQuery(query.query, candidates.map((c) => c.passage));

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
      // Absent on a literal match, which is the case that needs no explanation.
      ...(indexResult.provenance?.get(passage.passageKey)
        ? { widenedVia: indexResult.provenance.get(passage.passageKey) }
        : {}),
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
    widenedTerms: indexResult.widenedTerms ?? [],
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

/**
 * How much of the query a passage actually contains.
 *
 * The original text counts, not just the translation, and that is the whole
 * reason the field is looked at both ways: a reader who searches الرحمن and gets
 * a Quranic verse whose English translation never says "the Most Merciful" has
 * found the best possible match, and measuring coverage against the English alone
 * scored it zero and threw it away. That is the difference between original-text
 * search working and appearing to work while returning nothing.
 *
 * Terms are compared in the form the search itself used, so a query normalised to
 * match a vocalised corpus is compared the same way rather than against a spelling
 * it can never contain.
 */
function termCoverage(passage: Passage, terms: string[], widenedVia?: WidenedLabel | null): number {
  /*
   * A passage found through a widened term counts as covered.
   *
   * Coverage is what separates "a weak match on your words" from "a different
   * passage", and the filter built on it is right for the literal path. A passage
   * reached through חכמה contains none of the English words in "wisdom", so without
   * this it scores zero coverage and is discarded as a different passage — which
   * would delete every result the cross-lingual map exists to produce, silently,
   * while looking like the feature had simply found nothing.
   *
   * Full coverage rather than a share, because the term that matched is the whole
   * of what this passage was retrieved for; there is no partial credit to give
   * against a query it does not otherwise contain.
   */
  if (widenedVia) return 1;
  if (terms.length === 0) return 1;

  let hits = 0;
  for (const term of terms) {
    // Both fields and every reading, because the index is built that way and a
    // coverage score computed any other way discards hits the index just found.
    if (
      matchesAnyReading(passage.translation, term) ||
      matchesAnyReading(passage.originalText ?? '', term)
    ) {
      hits += 1;
    }
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

export async function runFullText(term: string, query: SearchQuery) {
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
  const widenedTerms: WidenedTerm[] = [];

  const candidates: PassageDoc[] = [];
  const seen = new Set<string>();
  /*
   * Which term reached each passage, so a result can say it was widened.
   *
   * Without this the widening is silent, and a silent widening is the one failure
   * this product cannot have: a reader who searched "wisdom" and was shown a
   * Hebrew verse has been shown a passage that does not contain the word they
   * typed. The term is carried per passage rather than per query so the row can
   * name the word that actually found it, which is also the only way a reader can
   * check the claim.
   */
  const provenance = new Map<string, WidenedLabel>();

  const add = (hits: Array<{ document: PassageDoc }>, via: WidenedLabel | null) => {
    let fresh = 0;
    for (const hit of hits) {
      const key = hit.document.passageKey;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(hit.document);
      if (via) provenance.set(key, via);
      fresh += 1;
    }
    return fresh;
  };

  // Literal matches first, so an exact hit is never demoted by the widening.
  const literal = await runFullText(term, query);
  add(literal.hits, null);

  const searchFor = async (t: string) =>
    searchIndex({
      term: t,
      textIds: query.filters?.texts,
      books: query.filters?.books,
      chapters: query.filters?.chapters,
      languages: query.filters?.languages,
      limit: Math.min(query.limit + query.offset + EXAMINATION_SLACK, MAX_HYDRATE),
      properties: ['translation', 'themes'],
    });

  const record = (via: WidenedTerm, hits: number, novel: number) => {
    const existing = widenedTerms.find((w) => w.term === via.term);
    if (existing) existing.novel += novel;
    else widenedTerms.push({ ...via, hits, novel });
  };

  for (const themeTerm of terms.slice(0, 3)) {
    const hits = (await searchFor(themeTerm)).hits;
    const label: WidenedLabel = { kind: 'theme', term: themeTerm };
    record({ ...label, hits: 0, novel: 0 }, hits.length, add(hits, label));
  }

  /*
   * And now the same theme in the languages the reader did not type.
   *
   * Every term above is an English keyword, so the widening can only ever reach the
   * English translations. These are the theme's own words in Hebrew, Greek, Arabic
   * and Aramaic, derived from the corpus, and they go through the same index call —
   * which searches `search_vector_original` as well as `search_vector` — so a
   * query in English reaches a passage that contains none of the query's words.
   *
   * That last clause is why these passages need a coverage credit below. A Hebrew
   * passage has zero coverage of the English query, and the filter that discards
   * zero-coverage results as "a different passage" would otherwise throw away
   * exactly the results this exists to find.
   */
  for (const x of await xlingualTermsForTheme(theme)) {
    const via: WidenedTerm = { kind: 'xlingual', term: x.term, language: x.language, hits: 0, novel: 0 };
    const hits = (await searchFor(x.term)).hits;
    record(via, hits.length, add(hits, via));
  }

  return {
    hits: candidates.map((document, i) => ({ document, score: Math.max(0.1, 1 - i / candidates.length) })),
    count: candidates.length,
    elapsedMs: 0,
    // The theme terms are always matched exactly, so the widened set is only as
    // relaxed as the literal query the reader actually typed was.
    matchMode: literal.matchMode,
    provenance,
    widenedTerms,
  };
}

/**
 * Which fields of the passage the term was found in.
 *
 * 'original' is a first-class value now, not folded into 'translation'. A reader
 * who searched a Hebrew or Arabic word is looking at a result whose matching text
 * is on screen in a script they searched in, and the field list is the only place
 * that says so.
 */
function matchedFields(passage: Passage, term: string): string[] {
  const fields: string[] = [];
  if (matches(passage.translation, term)) fields.push('translation');

  if ((passage.originalText ?? '').length > 0 && matchesAnyReading(passage.originalText ?? '', term)) {
    fields.push('original');
  }

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
