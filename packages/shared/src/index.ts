import { z } from 'zod';

// ============================================================================
// Core Text Identifiers
// ============================================================================

/**
 * The corpora.
 *
 * Bukhari and Muslim are hadith, not scripture, and are named for their collections
 * rather than for a tradition. Both are ṣaḥīḥ by the consensus of Sunni scholarship,
 * which is why they are the only two: the four Sunan carry a per-hadith grade and
 * including them means shipping da'īf material with its grade attached, and al-Muwattaʾ
 * is more legal opinion than report.
 *
 * They are reported as two corpora rather than one "Hadith" corpus, because a
 * hadith is cited by its collection — al-Bukhari 2:4 is not the same claim as Muslim
 * 2:4 — and one bucket could not carry that distinction.
 */
export const TextIdSchema = z.enum(['quran', 'talmud', 'torah', 'ot', 'nt', 'bukhari', 'muslim']);
export type TextId = z.infer<typeof TextIdSchema>;

export const LanguageSchema = z.enum(['arabic', 'hebrew', 'aramaic', 'greek', 'english']);

/**
 * Where a number came from. Reported everywhere a score is, so a reader is never
 * left assuming a model produced something a rule did.
 *
 *   jev      a hosted judgment model
 *   local    a model running on this machine
 *   derived  a deterministic local rule — lexical overlap, theme intersection
 */
export const ScoreSourceSchema = z.enum(['jev', 'local', 'derived']);
export type ScoreSource = z.infer<typeof ScoreSourceSchema>;

export type Language = z.infer<typeof LanguageSchema>;

// ============================================================================
// Passage & Text Models
// ============================================================================

export const PassageMetadataSchema = z.object({
  language: LanguageSchema,
  writingSystem: z.string(),
  canonicalOrder: z.number().int().nonnegative(),
  verseOrder: z.number().int().nonnegative().default(0),
  revelationOrder: z.number().int().positive().optional(),
  madhhab: z.string().optional(),
  juz: z.number().int().min(1).max(30).optional(),
  hizb: z.number().int().min(1).max(60).optional(),
  page: z.number().int().positive().optional(),
});
export type PassageMetadata = z.infer<typeof PassageMetadataSchema>;

export const TranslationSchema = z.object({
  id: z.string(),
  language: LanguageSchema,
  translator: z.string(),
  year: z.number().int().optional(),
  text: z.string(),
  isPrimary: z.boolean().default(false),
});
export type Translation = z.infer<typeof TranslationSchema>;

export const ThemeScoreSchema = z.object({
  theme: z.string(),
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  // 'manual' is a curator's own assignment and predates the local engine.
  source: z.union([ScoreSourceSchema, z.literal('manual')]).default('jev'),
});
export type ThemeScore = z.infer<typeof ThemeScoreSchema>;

export const CrossRefTypeSchema = z.enum([
  'quote',
  'allusion',
  'thematic',
  'linguistic',
  'narrative',
  'theological',
]);
export type CrossRefType = z.infer<typeof CrossRefTypeSchema>;

export const CrossRefSchema = z.object({
  targetPassageId: z.string(),
  targetText: TextIdSchema,
  type: CrossRefTypeSchema,
  strength: z.number().min(0).max(1),
  direction: z.enum(['bidirectional', 'source_to_target', 'target_to_source']),
  notes: z.string(),
  detectedBy: z.enum(['jev', 'manual', 'derived']).default('jev'),
});
export type CrossRef = z.infer<typeof CrossRefSchema>;

export const PassageSchema = z.object({
  id: z.string(),
  passageKey: z.string(), // canonical key: "quran:2:1:255", "nt:john:3:16"
  textId: TextIdSchema,
  book: z.string(),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive(),
  originalText: z.string(),
  translation: z.string(), // Primary English translation
  /**
   * Name of the primary translation, so a switcher can say what you are reading
   * without the reader having to infer it from the text.
   */
  primaryTranslationName: z.string().optional(),
  /**
   * Translations other than the primary.
   *
   * The primary is excluded deliberately: it is already in `translation`, and
   * listing it here too made the UI offer "1 other translation" whose text was
   * identical to the one on screen.
   */
  alternativeTranslations: z.array(TranslationSchema).default([]),
  metadata: PassageMetadataSchema,
  embeddings: z.array(z.number()).default([]), // Semantic vector
  themes: z.array(ThemeScoreSchema).default([]),
  crossReferences: z.array(CrossRefSchema).default([]),
});
export type Passage = z.infer<typeof PassageSchema>;

// ============================================================================
// Search & Query Models
// ============================================================================

export const SearchIntentSchema = z.enum([
  'comparison',
  'explanation',
  'thematic_study',
  'linguistic_analysis',
  'cross_reference',
  'reading',
  'unknown',
]);
export type SearchIntent = z.infer<typeof SearchIntentSchema>;

export const SearchFiltersSchema = z.object({
  texts: z.array(TextIdSchema).optional(),
  books: z.array(z.string()).optional(),
  chapters: z.array(z.number().int().positive()).optional(),
  languages: z.array(LanguageSchema).optional(),
  themes: z.array(z.string()).optional(),
  dateRange: z.object({ start: z.number(), end: z.number() }).optional(),
});
export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

export const SearchQuerySchema = z.object({
  query: z.string().min(1),
  intent: SearchIntentSchema.optional(),
  filters: SearchFiltersSchema.optional(),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
  includeScores: z.boolean().default(true),
  /**
   * Re-rank the full-text shortlist with Jev so results are ranked by meaning,
   * not only by shared words. Costs one extra request per search.
   */
  semantic: z.boolean().default(true),
  /** Widen a literal query with the vocabulary of the theme it names. */
  expand: z.boolean().default(true),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResultSchema = z.object({
  passage: PassageSchema,
  score: z.number().min(0).max(1),
  matchedFields: z.array(z.string()),
  highlights: z.record(z.array(z.string())),
  intentConfidence: z.number().min(0).max(1).optional(),
  /** Full-text relevance before any Jev re-ranking, 0-1. */
  textScore: z.number().min(0).max(1).optional(),
  /** Jev's relevance for this result, 0-1. Absent when Jev did not run. */
  semanticScore: z.number().min(0).max(1).optional(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

/** What the corpus as a whole has to say about a query. */
export const CorpusVerdictSchema = z.enum(['addressed', 'partial', 'unaddressed', 'unknown']);
export type CorpusVerdict = z.infer<typeof CorpusVerdictSchema>;

/**
 * Which retrieval pass produced the results. See the relaxed pass in
 * apps/api/src/search/postgres.ts.
 */
export const MatchModeSchema = z.enum(['exact', 'relaxed', 'filters-only']);
export type MatchMode = z.infer<typeof MatchModeSchema>;

export const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  total: z.number().int().nonnegative(),
  query: SearchQuerySchema,
  tookMs: z.number().int().nonnegative(),
  suggestions: z.array(z.string()).default([]),
  intent: SearchIntentSchema.default('unknown'),
  intentSource: ScoreSourceSchema.default('derived'),
  /**
   * 'unaddressed' means these texts say nothing on the topic. That is a real
   * answer, and a more useful one than the least-bad keyword matches.
   */
  verdict: CorpusVerdictSchema.default('unknown'),
  rerankSource: ScoreSourceSchema.default('derived'),
  /** Theme the query was widened with, when one was recognised. */
  expandedTheme: z.string().nullable().default(null),
  /**
   * How the results were matched.
   *
   * 'relaxed' means full-text found nothing and the search fell back to trigram
   * similarity, so these passages resemble the term rather than contain it. The
   * UI shows that, because a result the reader did not type is a different kind
   * of claim than one they did.
   */
  matchMode: MatchModeSchema.default('exact'),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// ============================================================================
// Topics
// ============================================================================

/**
 * A narrower question inside a topic, run as a real search.
 *
 * `themes` is empty for every curated facet. It exists because scoping is
 * sometimes right, but a keyword classifier and a phrase query intersect to
 * almost nothing — see the note in the API's topics service.
 */
export const TopicFacetSchema = z.object({
  id: z.string(),
  query: z.string(),
  themes: z.array(z.string()).default([]),
});

/**
 * A curated entry point.
 *
 * `passages`, `books` and `corpora` are measured from the corpus, not declared.
 * A topic below the coverage floor is not served at all, so a quick link is never
 * a dead end.
 */
export const TopicSchema = z.object({
  slug: z.string(),
  theme: z.string(),
  facets: z.array(TopicFacetSchema),
  passages: z.number().int().nonnegative(),
  books: z.number().int().nonnegative(),
  corpora: z.array(TextIdSchema),
});
export type Topic = z.infer<typeof TopicSchema>;
export type TopicFacet = z.infer<typeof TopicFacetSchema>;

// ============================================================================
// Library
// ============================================================================

/**
 * A saved passage, hydrated.
 *
 * `passage` is null when the passage has left the corpus since it was saved. The
 * entry is still returned, because a list that silently shortens is
 * indistinguishable from data loss and the reader is the only one who can tell.
 */
export const LibraryEntrySchema = z.object({
  passageKey: z.string(),
  savedAt: z.string(),
  collectionId: z.string().nullable().default(null),
  passage: PassageSchema.nullable().default(null),
});
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;

// ============================================================================
// Related Passages
// ============================================================================

/**
 * One passage that relates to another, with the kind of relation stated.
 *
 * The three kinds are not comparable and the type says so. `verbatim` is
 * arithmetic over the stored texts — a run of identical words, checkable by
 * looking. `relation` is a model's judgement. `theme` is a keyword classifier's
 * tag, and every theme in the app is currently that. Ranking them in one column
 * without the label would let the first lend its authority to the third.
 */
export const RelatedPassageSchema = z.object({
  passageKey: z.string(),
  textId: TextIdSchema,
  book: z.string(),
  chapter: z.number().int(),
  verse: z.number().int(),
  preview: z.string(),
  originalText: z.string(),
  language: z.string(),
  kind: z.enum(['verbatim', 'relation', 'theme']),
  relation: z.string(),
  strength: z.number(),
  source: z.string(),
  sharedText: z.string().optional(),
  sharedTheme: z.string().optional(),
});
export type RelatedPassage = z.infer<typeof RelatedPassageSchema>;

export const RelatedPassagesSchema = z.object({
  passageKey: z.string(),
  empty: z.boolean(),
  byKind: z.object({
    verbatim: z.array(RelatedPassageSchema),
    relation: z.array(RelatedPassageSchema),
    theme: z.array(RelatedPassageSchema),
  }),
});
export type RelatedPassages = z.infer<typeof RelatedPassagesSchema>;

// ============================================================================
// Citations
// ============================================================================

/**
 * One passage that shares verbatim words with the one being read.
 *
 * `sharedText` is the run itself and `otherText` is the other passage in full, so
 * a reader can check the claim against the text without leaving the page. Neither
 * field says which passage came first, because the stored data does not.
 */
export const CitationMemberSchema = z.object({
  passageId: z.string(),
  passageKey: z.string(),
  textId: TextIdSchema,
  book: z.string(),
  chapter: z.number().int(),
  verse: z.number().int(),
  ownText: z.string(),
  otherText: z.string(),
  sharedText: z.string(),
  sharedRuns: z.array(z.string()),
  longestRun: z.number().int(),
  words: z.number().int(),
  strength: z.number(),
  detectedBy: z.string(),
  notes: z.string(),
  selfIsTextA: z.boolean(),
});

export const CitationGroupSchema = z.object({
  textId: TextIdSchema,
  count: z.number().int(),
  members: z.array(CitationMemberSchema),
});

export const PassageCitationsSchema = z.object({
  passageKey: z.string(),
  textId: TextIdSchema,
  total: z.number().int(),
  groups: z.array(CitationGroupSchema),
});
export type PassageCitations = z.infer<typeof PassageCitationsSchema>;
export type CitationGroup = z.infer<typeof CitationGroupSchema>;
export type CitationMember = z.infer<typeof CitationMemberSchema>;

/** A typed reference that resolved to a real passage. */
export const ResolvedCitationSchema = z.object({
  passageId: z.string(),
  passageKey: z.string(),
  textId: TextIdSchema,
  book: z.string(),
  chapter: z.number().int(),
  verse: z.number().int(),
  translation: z.string(),
  originalText: z.string(),
});
export type ResolvedCitation = z.infer<typeof ResolvedCitationSchema>;

// ============================================================================
// Passage Journey
// ============================================================================

/**
 * One passage inside a journey group.
 *
 * `score` is this passage's own confidence on the group's theme, which is not the
 * score of the passage the reader started from — keeping them separate is what
 * stops a strong-looking number from being read as a claim about the source.
 */
export const JourneyMemberSchema = z.object({
  passageKey: z.string(),
  textId: TextIdSchema,
  book: z.string(),
  chapter: z.number().int(),
  verse: z.number().int(),
  preview: z.string(),
  score: z.number(),
  chronologicalOrder: z.number().int(),
  source: z.string(),
});

/**
 * A context, and the passages that share it.
 *
 * `crossText` is false when every member is from one corpus. That is not a failed
 * journey, but it is a weaker finding and the UI labels it as one.
 */
export const JourneyGroupSchema = z.object({
  theme: z.string(),
  category: z.string().nullable().default(null),
  sourceScore: z.number(),
  members: z.array(JourneyMemberSchema),
  corpora: z.array(TextIdSchema),
  books: z.array(z.string()),
  crossText: z.boolean(),
});

export const PassageJourneySchema = z.object({
  passageKey: z.string(),
  textId: TextIdSchema,
  book: z.string(),
  chapter: z.number().int(),
  verse: z.number().int(),
  groups: z.array(JourneyGroupSchema),
});
export type PassageJourney = z.infer<typeof PassageJourneySchema>;
export type JourneyMember = z.infer<typeof JourneyMemberSchema>;
export type JourneyGroup = z.infer<typeof JourneyGroupSchema>;

// ============================================================================
// Comparison Models
// ============================================================================

export const AlignmentTypeSchema = z.enum([
  'direct_quote',
  'strong_allusion',
  'thematic_parallel',
  'linguistic_cognate',
  'narrative_parallel',
  'theological_echo',
  'none',
]);
export type AlignmentType = z.infer<typeof AlignmentTypeSchema>;

export const AlignmentSchema = z.object({
  passageAId: z.string(),
  passageBId: z.string(),
  type: AlignmentTypeSchema,
  strength: z.number().min(0).max(1),
  matchedSegments: z.array(
    z.object({
      textA: z.string(),
      textB: z.string(),
      startA: z.number(),
      endA: z.number(),
      startB: z.number(),
      endB: z.number(),
    })
  ),
  notes: z.string(),
  // Which judge produced the type and the strength. Without this the UI would have
  // to assert that every score came from Jev, which is false whenever the local
  // fallback ran.
  source: ScoreSourceSchema.default('derived'),
});
export type Alignment = z.infer<typeof AlignmentSchema>;

/**
 * How many passages one comparison may hold. Eight is one column per corpus in
 * TEXT_IDS plus three, which is the point at which the panel grid stops being
 * readable side by side. The cap bounds the request: alignments are all pairs, so
 * it is what keeps one comparison to a single batched Jev call of a sane size.
 */
export const MAX_COMPARISON_PASSAGES = 8;

export const ComparisonRequestSchema = z.object({
  passageIds: z.array(z.string()).min(2).max(MAX_COMPARISON_PASSAGES),
  options: z.object({
    includeAlignments: z.boolean().default(true),
    includeThemes: z.boolean().default(true),
    includeCrossRefs: z.boolean().default(true),
    syncScrolling: z.boolean().default(true),
  }).default({}),
});
export type ComparisonRequest = z.infer<typeof ComparisonRequestSchema>;

export const ComparisonResponseSchema = z.object({
  passages: z.array(PassageSchema),
  alignments: z.array(AlignmentSchema),
  sharedThemes: z.array(
    z.object({
      theme: z.string(),
      passages: z.record(z.array(z.string())), // passageId -> evidence[]
      avgScore: z.number().min(0).max(1),
    })
  ),
  crossReferences: z.array(
    z.object({
      sourcePassageId: z.string(),
      targetPassageId: z.string(),
      type: z.string(),
      strength: z.number().min(0).max(1),
      notes: z.string(),
    })
  ).default([]),
  metadata: z.object({
    textCount: z.number(),
    totalVerses: z.number(),
    // Total pairs the passages form. Equal to alignments.length only when every
    // pair cleared the interest threshold, so the UI can say what was dropped.
    totalPairs: z.number(),
    // Whether a model is reachable at all. The UI must not claim links were
    // scored locally "because no key is configured" when the truth is that they
    // came from a previous run's cache.
    jevConfigured: z.boolean(),
    // Pairs answered from the alignments table rather than by asking the model.
    cachedPairs: z.number(),
    generatedAt: z.date(),
  }),
});
export type ComparisonResponse = z.infer<typeof ComparisonResponseSchema>;

// ============================================================================
// Recommendation Models
// ============================================================================

export const RecommendationWeightsSchema = z
  .object({
    thematic: z.number().min(0).max(1),
    linguistic: z.number().min(0).max(1),
    historical: z.number().min(0).max(1),
    narrative: z.number().min(0).max(1),
    theological: z.number().min(0).max(1),
  })
  .refine(
    (w) => Math.abs(w.thematic + w.linguistic + w.historical + w.narrative + w.theological - 1) < 0.01,
    { message: 'Weights must sum to 1.0' }
  );
export type RecommendationWeights = z.infer<typeof RecommendationWeightsSchema>;

/** Weights as they arrive from a client: partial, and normalised downstream. */
export const RecommendationWeightsInputSchema = z.object({
  thematic: z.number().min(0).max(1).optional(),
  linguistic: z.number().min(0).max(1).optional(),
  historical: z.number().min(0).max(1).optional(),
  narrative: z.number().min(0).max(1).optional(),
  theological: z.number().min(0).max(1).optional(),
});
export type RecommendationWeightsInput = z.infer<typeof RecommendationWeightsInputSchema>;


export const ScoreBreakdownSchema = z.object({
  thematic: z.number().min(0).max(1),
  linguistic: z.number().min(0).max(1),
  historical: z.number().min(0).max(1),
  narrative: z.number().min(0).max(1),
  theological: z.number().min(0).max(1),
  composite: z.number().min(0).max(1),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

export const RecommendationSchema = z.object({
  passageId: z.string(),
  passageKey: z.string(),
  textId: TextIdSchema,
  book: z.string(),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive(),
  preview: z.string().max(200),
  scores: ScoreBreakdownSchema,
  reasoning: z.string(), // Human-readable breakdown
  matchedThemes: z.array(z.string()),
  matchedTerms: z.array(z.string()),
  // Whether a model judged this pair or a local rule did. Without it the UI would
  // have to present every number as model output, which is false when Jev is absent
  // or when the pair fell back.
  source: ScoreSourceSchema.default('derived'),
  // True when these scores came from a previous judgement rather than this request.
  cached: z.boolean().default(false),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const RecommendationRequestSchema = z.object({
  passageId: z.string(),
  weights: RecommendationWeightsSchema.optional(),
  limit: z.number().int().positive().max(20).default(10),
  excludeTexts: z.array(TextIdSchema).optional(),
  excludeSameBook: z.boolean().default(false),
  minScore: z.number().min(0).max(1).default(0.3),
});
export type RecommendationRequest = z.infer<typeof RecommendationRequestSchema>;

export const RecommendationResponseSchema = z.object({
  recommendations: z.array(RecommendationSchema),
  sourcePassage: PassageSchema,
  weights: RecommendationWeightsSchema,
  /** Whether any recommendation in this list was model-judged. */
  source: ScoreSourceSchema.default('derived'),
  /** How many of these were recombined from the affinity cache. */
  cachedCount: z.number().int().min(0).default(0),
  generatedAt: z.date(),
});
export type RecommendationResponse = z.infer<typeof RecommendationResponseSchema>;

// ============================================================================
// Thematic Exploration Models
// ============================================================================

export const ThemeMapNodeSchema = z.object({
  theme: z.string(),
  passages: z.array(z.string()), // passageIds
  score: z.number().min(0).max(1),
  relatedThemes: z.array(z.string()),
  texts: z.array(TextIdSchema),
});
export type ThemeMapNode = z.infer<typeof ThemeMapNodeSchema>;

export const ThemeJourneyStepSchema = z.object({
  theme: z.string(),
  passageId: z.string(),
  textId: TextIdSchema,
  book: z.string(),
  chapter: z.number(),
  verse: z.number(),
  preview: z.string(),
  chronologicalOrder: z.number(),
  score: z.number().min(0).max(1),
  /**
   * Where this passage's score on this theme came from: 'jev' or 'derived' for
   * the local classifier, 'manual' where a person set it.
   *
   * On the step rather than only on the response, because one journey mixes
   * scores from different sources and a single label for the whole page would
   * misdescribe most of the rows on it.
   */
  source: z.string().default('derived'),
});
export type ThemeJourneyStep = z.infer<typeof ThemeJourneyStepSchema>;

// ============================================================================
// Book/Structure Metadata
// ============================================================================

export const BookMetadataSchema = z.object({
  textId: TextIdSchema,
  id: z.string(), // e.g., "quran:2", "nt:john"
  name: z.string(),
  nameOriginal: z.string().optional(),
  nameTransliterated: z.string().optional(),
  chapterCount: z.number().int().positive(),
  verseCount: z.number().int().positive(),
  order: z.number().int().positive(),
  testament: z.enum(['old', 'new', 'quran', 'talmud', 'torah']).optional(),
  category: z.string().optional(), // e.g., "pentateuch", "gospel", "pauline"
  description: z.string().optional(),
});
export type BookMetadata = z.infer<typeof BookMetadataSchema>;

// ============================================================================
// API Response Wrappers
// ============================================================================

export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: z.object({
      timestamp: z.date(),
      version: z.string(),
      requestId: z.string().optional(),
    }).optional(),
  });

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
  meta: z.object({
    timestamp: z.date(),
    requestId: z.string().optional(),
  }).optional(),
});

export type ApiSuccess<T> = z.infer<ReturnType<typeof ApiSuccessSchema<z.ZodTypeAny>>> & { data: T };
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ============================================================================
// Utility Types
// ============================================================================

export type PassageKey = `${TextId}:${string}:${number}:${number}`;

export const PassageKeySchema = z
  .string()
  .regex(
    /^(quran|talmud|torah|ot|nt):[^:]+:\d+:\d+$/,
    'Passage keys look like textId:book:chapter:verse, e.g. quran:2:1:255 or nt:john:3:16'
  );

export function createPassageKey(textId: TextId, book: string, chapter: number, verse: number): PassageKey {
  return `${textId}:${book}:${chapter}:${verse}`;
}

export function parsePassageKey(key: PassageKey): { textId: TextId; book: string; chapter: number; verse: number } {
  const [textId, book, chapter, verse] = key.split(':');
  return {
    textId: textId as TextId,
    book,
    chapter: parseInt(chapter, 10),
    verse: parseInt(verse, 10),
  };
}

// ============================================================================
// Constants
// ============================================================================

export const TEXT_METADATA: Record<TextId, {
  name: string;
  originalLanguage: Language;
  englishTranslations: string[];
  bookCount: number;
  totalVerses: number;
  direction: 'rtl' | 'ltr';
}> = {
  quran: {
    name: 'Quran',
    originalLanguage: 'arabic',
    englishTranslations: ['Sahih International', 'Pickthall', 'Yusuf Ali', 'Muhsin Khan', 'Arberry'],
    bookCount: 114,
    totalVerses: 6236,
    direction: 'rtl',
  },
  talmud: {
    name: 'Talmud (Babylonian)',
    originalLanguage: 'aramaic',
    englishTranslations: ['Soncino', 'Steinsaltz', 'Artscroll', 'Koren'],
    bookCount: 63, // tractates
    totalVerses: 0, // Not verse-based
    direction: 'rtl',
  },
  torah: {
    name: 'Torah (Pentateuch)',
    originalLanguage: 'hebrew',
    englishTranslations: ['JPS 1917', 'JPS 1985', 'Artscroll', 'Fox', 'Alter'],
    bookCount: 5,
    totalVerses: 5845,
    direction: 'rtl',
  },
  ot: {
    name: 'Old Testament',
    originalLanguage: 'hebrew',
    englishTranslations: ['KJV', 'ESV', 'NRSV', 'NIV', 'JPS', 'NKJV'],
    bookCount: 39, // Protestant canon
    totalVerses: 23145,
    direction: 'ltr',
  },
  bukhari: {
    name: 'Sahih al-Bukhari',
    originalLanguage: 'arabic',
    englishTranslations: ['Sahih al-Bukhari (English)'],
    bookCount: 97, // Kitab
    totalVerses: 7589, // hadith
    direction: 'rtl',
  },
  muslim: {
    name: 'Sahih Muslim',
    originalLanguage: 'arabic',
    englishTranslations: ['Sahih Muslim (English)'],
    bookCount: 46, // Kitab
    totalVerses: 7563, // hadith
    direction: 'rtl',
  },
  nt: {
    name: 'New Testament',
    originalLanguage: 'greek',
    englishTranslations: ['KJV', 'ESV', 'NRSV', 'NIV', 'NKJV', 'NASB'],
    bookCount: 27,
    totalVerses: 7957,
    direction: 'ltr',
  },
};

export const THEME_TAXONOMY = [
  // Divine Attributes
  'mercy', 'compassion', 'justice', 'wrath', 'forgiveness', 'love', 'power',
  'knowledge', 'wisdom', 'sovereignty', 'holiness', 'faithfulness',
  // Covenant & Law
  'covenant', 'law', 'commandment', 'obedience', 'sin', 'repentance', 'atonement',
  'sacrifice', 'purity', 'righteousness',
  // Salvation & Eschatology
  'salvation', 'redemption', 'resurrection', 'judgment', 'heaven', 'hell',
  'afterlife', 'messiah', 'kingdom', 'eternal_life',
  // Practice & Ritual
  'prayer', 'worship', 'fasting', 'pilgrimage', 'charity', 'almsgiving',
  'ritual', 'ceremony', 'sabbath', 'festival',
  // Ethics & Virtue
  'humility', 'patience', 'gratitude', 'trust', 'honesty', 'kindness', 'generosity',
  // Narrative & Figures
  'creation', 'adam', 'noah', 'abraham', 'moses', 'david', 'solomon',
  'jesus', 'muhammad', 'prophets', 'angels', 'satan',
  // Community & Society
  'community', 'family', 'marriage', 'parenthood', 'neighbor', 'stranger',
  'poor', 'orphan', 'widow', 'governance',
  // Cosmology & Nature
  'earth', 'light', 'darkness', 'water', 'fire',
  'wind', 'stars', 'animals', 'plants',
] as const;

export type Theme = (typeof THEME_TAXONOMY)[number];

// ============================================================================
// Recommendation Weights
// ============================================================================

/**
 * How much each dimension is allowed to move the composite.
 *
 * Three of these four active dimensions are independent measurements of a pair of
 * passages. The fourth is not, and the weights say so.
 *
 * `thematic` and `theological` read the same thing — the theme label overlap — at
 * two different scales. Giving them 0.30 and 0.20 counted one keyword classifier
 * as half the score, which is why the old composite put a passage's fate on how
 * many of the 84 taxonomy keywords a verse happened to contain. `theological` is
 * kept at 0.10 rather than deleted so the reader can see the overlap in the
 * breakdown instead of being asked to trust it.
 *
 * `historical` is weighted zero because with no model available it was a
 * hardcoded table of corpus-pair proximities: every NT-to-Talmud pair scored
 * exactly 0.35 and every same-corpus pair exactly 0.6, regardless of the passages.
 * That is an editorial opinion wearing a decimal point, and 0.15 of the composite
 * was spent on it. It still appears in the breakdown, so the dimension is visible
 * rather than quietly deleted, and it carries nothing until something real can
 * measure it.
 */
export const DEFAULT_WEIGHTS: RecommendationWeights = {
  thematic: 0.3,
  linguistic: 0.3,
  historical: 0,
  narrative: 0.3,
  theological: 0.1,
};

// ============================================================================
// Lexicon
// ============================================================================

/**
 * One published dictionary's entry for a word.
 *
 * Reference data, never generated: these senses were written by lexicographers,
 * and `lexicon` and `source` name the dictionary so the reader can see whose
 * definition they are reading.
 */
export const LexiconEntrySchema = z.object({
  headword: z.string(),
  lexicon: z.string(),
  language: z.string(),
  transliteration: z.string().nullable().default(null),
  strongNumber: z.string().nullable().default(null),
  morphology: z.string().nullable().default(null),
  senses: z.array(z.object({ definition: z.string() })),
  source: z.string().nullable().default(null),
});
export type LexiconEntry = z.infer<typeof LexiconEntrySchema>;

export const LexiconLookupSchema = z.object({
  /** The word as looked up, with pointing stripped. */
  word: z.string(),
  entries: z.array(LexiconEntrySchema),
  /** True when the answer came from the cache rather than Sefaria. */
  cached: z.boolean(),
  /** True when no dictionary carries this word. A real answer, not an error. */
  notFound: z.boolean(),
});
export type LexiconLookup = z.infer<typeof LexiconLookupSchema>;

// Citation parsing lives in its own module; re-exported so both apps have one path.
export { parseCitation, isUnambiguousCitation, type CitationMatch } from './citation.js';
