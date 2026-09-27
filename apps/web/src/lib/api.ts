import type {
  Alignment,
  BookMetadata,
  ComparisonRequest,
  CorpusVerdict,
  CrossRef,
  LexiconLookup,
  Passage,
  Recommendation,
  RecommendationWeights,
  ScoreBreakdown,
  SearchResponse,
  TextId,
  ThemeJourneyStep,
} from '@ilm/shared';

/** The comparison options the API accepts, as the client sends them. */
type CompareOptions = ComparisonRequest['options'];

/**
 * API client.
 *
 * Requests go to the relative /api path, which next.config.js rewrites to the
 * Fastify server. One origin in development means no CORS preflight and no
 * leaking an internal API host into the browser bundle.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', `Could not reach the Ilm API at ${path}. Is it running?`);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.success === false) {
    const error = payload?.error ?? {};
    throw new ApiError(response.status, error.code ?? 'ERROR', error.message ?? `Request failed with ${response.status}`);
  }

  return payload.data as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) });

// ============================================================================
// Types mirrored from the API's own responses
// ============================================================================

export interface TextStats {
  textId: TextId;
  name: string;
  originalLanguage: string | null;
  direction: 'rtl' | 'ltr';
  passageCount: number;
  bookCount: number;
  themeCount: number;
  crossRefCount: number;
  alignmentCount: number;
}

export interface CorpusStats {
  texts: TextStats[];
  totals: { passages: number; books: number; crossReferences: number };
}

export interface Health {
  status: string;
  search: { ready: boolean; passagesIndexed: number };
  jev: { configured: boolean; reason: string };
}

export type { CorpusVerdict };

export interface RecommendationExplanation {
  scores: ScoreBreakdown;
  source: 'jev' | 'derived';
  breakdown: Array<{ dimension: string; score: number; weight: number; contribution: number; evidence: string[] }>;
  summary: string;
}

export interface ComparisonResult {
  passages: Passage[];
  alignments: Alignment[];
  sharedThemes: Array<{ theme: string; passages: Record<string, string[]>; avgScore: number }>;
  crossReferences: Array<{
    sourcePassageId: string;
    targetPassageId: string;
    type: string;
    strength: number;
    notes: string;
  }>;
  metadata: { textCount: number; totalVerses: number; totalPairs: number; jevConfigured: boolean; cachedPairs: number; generatedAt: string };
  shareUrl: string;
}

export interface RecommendationResponse {
  recommendations: Array<Recommendation & { passageKey: string }>;
  sourcePassage: Passage;
  weights: RecommendationWeights;
  /** Whether any recommendation here was model-judged. */
  source: 'jev' | 'derived';
  /** How many came from the affinity cache rather than this request. */
  cachedCount: number;
  generatedAt: string;
}

export interface ThemeMap {
  center: string;
  related: Array<{ theme: string; sharedPassages: number; avgScore: number }>;
}

// ============================================================================
// Endpoints
// ============================================================================

export const api = {
  health: () => get<Health>('/health'),

  search: (body: {
    query: string;
    limit?: number;
    offset?: number;
    intent?: string;
    /** Re-rank by meaning with Jev. One extra request; defaults to true. */
    semantic?: boolean;
    /** Widen the query with the vocabulary of the theme it names. */
    expand?: boolean;
    filters?: { texts?: TextId[]; books?: string[]; themes?: string[]; chapters?: number[] };
  }) => post<SearchResponse>('/api/search', body),

  suggest: (query: string, limit = 5) => get<{ suggestions: string[] }>(`/api/search/suggest?q=${encodeURIComponent(query)}&limit=${limit}`),

  themes: () => get<{ themes: string[] }>('/api/themes'),

  corpus: () => get<CorpusStats>('/api/texts'),

  text: (textId: TextId) => get<TextStats>(`/api/texts/${textId}`),

  books: (textId: TextId) => get<{ textId: TextId; books: BookMetadata[]; total: number }>(`/api/texts/${textId}/books`),

  book: (textId: TextId, bookId: string) => get<BookMetadata>(`/api/texts/${textId}/books/${encodeURIComponent(bookId)}`),

  chapter: (textId: TextId, bookId: string, chapter: number) =>
    get<{ textId: TextId; book: string; chapter: number; passages: Passage[] }>(
      `/api/texts/${textId}/books/${encodeURIComponent(bookId)}/chapters/${chapter}`
    ),

  passage: (id: string) => get<Passage>(`/api/passages/${encodeURIComponent(id)}`),

  passageByKey: (key: string) => get<Passage>(`/api/passages/by-key/${encodeURIComponent(key)}`),

  crossReferences: (passageId: string, refresh = false) =>
    get<{ references: Array<CrossRef & { targetPassageKey: string }>; computed: boolean }>(
      `/api/passages/${encodeURIComponent(passageId)}/cross-references${refresh ? '?refresh=1' : ''}`
    ),

  passagesByKeys: (keys: string[]) => post<{ passages: Passage[] }>('/api/passages/batch', { keys }),

  recommendations: (body: {
    passageId: string;
    weights?: Partial<RecommendationWeights>;
    limit?: number;
    excludeTexts?: TextId[];
    minScore?: number;
  }) => post<RecommendationResponse>('/api/recommendations', body),

  explain: (sourceId: string, targetId: string) =>
    get<RecommendationExplanation>(`/api/recommendations/explain/${encodeURIComponent(sourceId)}/${encodeURIComponent(targetId)}`),

  /**
   * `syncScrolling` is the one option the server cannot act on — it is a display
   * instruction, and passing it keeps the request shape honest about what the page
   * is doing rather than silently dropping it.
   */
  compare: (passageKeys: string[], options?: Partial<CompareOptions>) =>
    post<ComparisonResult>('/api/compare', {
      passageIds: passageKeys,
      options: { includeAlignments: true, includeThemes: true, includeCrossRefs: true, syncScrolling: true, ...options },
    }),

  /**
   * Dictionary entries for a word in its original script.
   *
   * The Sefaria lexicons are Hebrew and Aramaic, so this answers for the Torah,
   * Talmud and Old Testament and returns `notFound` elsewhere rather than
   * pretending an Arabic or Greek word has no entry because nothing was asked.
   */
  lexicon: (word: string) => get<LexiconLookup>(`/api/lexicon?word=${encodeURIComponent(word)}`),

  journey: (theme: string, limit = 20) =>
    get<{ theme: string; journey: Array<ThemeJourneyStep & { passageKey: string }> }>(
      `/api/themes/${encodeURIComponent(theme)}/journey?limit=${limit}`
    ),

  themeMap: (theme: string) => get<ThemeMap>(`/api/themes/${encodeURIComponent(theme)}/map`),

  weights: (userId: string) => get<RecommendationWeights>(`/api/users/${encodeURIComponent(userId)}/weights`),

  saveWeights: (userId: string, weights: RecommendationWeights) =>
    put<RecommendationWeights>(`/api/users/${encodeURIComponent(userId)}/weights`, weights),
};

export default api;
