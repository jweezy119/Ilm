import { z } from 'zod';

// ============================================================================
// Core Text Identifiers
// ============================================================================

export const TextIdSchema = z.enum(['quran', 'talmud', 'torah', 'ot', 'nt']);
export type TextId = z.infer<typeof TextIdSchema>;

export const LanguageSchema = z.enum(['arabic', 'hebrew', 'aramaic', 'greek', 'english']);
export type Language = z.infer<typeof LanguageSchema>;

// ============================================================================
// Passage & Text Models
// ============================================================================

export const PassageMetadataSchema = z.object({
  language: LanguageSchema,
  writingSystem: z.string(),
  canonicalOrder: z.number().int().positive(),
  revelationOrder: z.number().int().positive().optional(),
  madhhab: z.string().optional(),
  juz: z.number().int().min(1).max(30).optional(),
  hizb: z.number().int().min(1).max(60).optional(),
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
  source: z.enum(['jev', 'manual', 'derived']).default('jev'),
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
  detectedBy: z.enum(['jev', 'manual']).default('jev'),
});
export type CrossRef = z.infer<typeof CrossRefSchema>;

export const PassageSchema = z.object({
  id: z.string(), // e.g., "quran:2:255", "nt:john:3:16"
  textId: TextIdSchema,
  book: z.string(),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive(),
  originalText: z.string(),
  translation: z.string(), // Primary English translation
  alternativeTranslations: z.array(TranslationSchema).default([]),
  metadata: PassageMetadataSchema,
  embeddings: z.array(z.number()).default([]), // Semantic vector
  themes: z.array(ThemeScoreSchema).default([]),
  crossReferences: z.array(CrossRefSchema).default([]),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
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
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResultSchema = z.object({
  passage: PassageSchema,
  score: z.number().min(0).max(1),
  matchedFields: z.array(z.string()),
  highlights: z.record(z.array(z.string())),
  intentConfidence: z.number().min(0).max(1).optional(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  total: z.number().int().nonnegative(),
  query: SearchQuerySchema,
  tookMs: z.number().int().nonnegative(),
  suggestions: z.array(z.string()).default([]),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

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
});
export type Alignment = z.infer<typeof AlignmentSchema>;

export const ComparisonRequestSchema = z.object({
  passageIds: z.array(z.string()).min(2).max(5),
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
  metadata: z.object({
    textCount: z.number(),
    totalVerses: z.number(),
    generatedAt: z.date(),
  }),
});
export type ComparisonResponse = z.infer<typeof ComparisonResponseSchema>;

// ============================================================================
// Recommendation Models
// ============================================================================

export const RecommendationWeightsSchema = z.object({
  thematic: z.number().min(0).max(1).default(0.3),
  linguistic: z.number().min(0).max(1).default(0.2),
  historical: z.number().min(0).max(1).default(0.15),
  narrative: z.number().min(0).max(1).default(0.15),
  theological: z.number().min(0).max(1).default(0.2),
});
export type RecommendationWeights = z.infer<typeof RecommendationWeightsSchema>;

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
  textId: TextIdSchema,
  book: z.string(),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive(),
  preview: z.string().max(200),
  scores: ScoreBreakdownSchema,
  reasoning: z.string(), // Human-readable breakdown
  matchedThemes: z.array(z.string()),
  matchedTerms: z.array(z.string()),
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
  'sacrifice', 'purity', 'holiness', 'righteousness',
  // Salvation & Eschatology
  'salvation', 'redemption', 'resurrection', 'judgment', 'heaven', 'hell',
  'afterlife', 'messiah', 'kingdom', 'eternal_life',
  // Practice & Ritual
  'prayer', 'worship', 'fasting', 'pilgrimage', 'charity', 'almsgiving',
  'ritual', 'ceremony', 'sabbath', 'festival',
  // Ethics & Virtue
  'justice', 'charity', 'humility', 'patience', 'gratitude', 'trust',
  'honesty', 'kindness', 'generosity', 'forgiveness',
  // Narrative & Figures
  'creation', 'adam', 'noah', 'abraham', 'moses', 'david', 'solomon',
  'jesus', 'muhammad', 'prophets', 'angels', 'satan',
  // Community & Society
  'community', 'family', 'marriage', 'parenthood', 'neighbor', 'stranger',
  'poor', 'orphan', 'widow', 'justice', 'governance',
  // Cosmology & Nature
  'creation', 'heaven', 'earth', 'light', 'darkness', 'water', 'fire',
  'wind', 'stars', 'animals', 'plants',
] as const;

export type Theme = typeof THEME_TAXONOMY[number];