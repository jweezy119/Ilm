/**
 * Semantic layer
 *
 * Turns passages into typed judgments using Jev (TypeSafe's System One model).
 * Every judgment is a score, a choice, or a noul — Ilm never asks a model to
 * write prose, so nothing here can invent content.
 *
 * Two properties this module is responsible for:
 *  1. Fan-out: many independent questions go out in one request, not one per question.
 *  2. Deterministic fallback: with no TypeSafe key, local lexical/theme scoring
 *     keeps search, comparison and recommendations working. The response is
 *     tagged `derived` so the UI can say where the numbers came from.
 */

import { Passage, CrossRef, CrossRefType, TextId, THEME_TAXONOMY, type ScoreSource } from '@ilm/shared';

// Re-exported so callers can keep importing the type from the module that uses it.
export type { ScoreSource };
import { createBoundedMemo } from '../lib/memo';
import { getJevJudge } from './typesafe-client';
import type { EntryType, JevQuestion } from './typesafe-client';

// ============================================================================
// Shared scoring dimensions
// ============================================================================

export const AFFINITY_DIMENSIONS = ['thematic', 'linguistic', 'historical', 'narrative', 'theological'] as const;
export type AffinityDimension = (typeof AFFINITY_DIMENSIONS)[number];

export interface AffinityScores {
  thematic: number;
  linguistic: number;
  historical: number;
  narrative: number;
  theological: number;
  composite: number;
}

/** Where a set of numbers came from, so the UI can be honest about it. */


export interface Judged<T> {
  value: T;
  source: ScoreSource;
}

const NO_OVERLAP = 0;
const FULL_OVERLAP = 1;

const AFFINITY_RUBRIC: Record<AffinityDimension, string[]> = {
  thematic: [
    'No thematic overlap whatsoever',
    'Only generic religious vocabulary in common',
    'Related but clearly distinct themes',
    'A clearly shared theme, weighted differently in each passage',
    'The same core theme, approached from complementary angles',
    'The same theme treated directly and with deep mutual resonance',
  ],
  linguistic: [
    'No linguistic relationship',
    'Only common function words such as "the" or "and"',
    'Some shared religious terminology',
    'Substantial shared vocabulary',
    'Shared terminology with recognisable cognate roots',
    'Direct derivation from a shared source language, or near-identical phrasing',
  ],
  historical: [
    'No historical relationship',
    'Vague proximity in time or place',
    'Same broad era or region',
    'A clear historical relationship',
    'One text directly responds to, quotes, or reworks the other',
    'Contemporaneous communities in direct contact',
  ],
  narrative: [
    'No narrative connection',
    'Generic story shapes only',
    'A similar narrative structure with different content',
    'Shared characters, events, or places',
    'The same story told from a different vantage point',
    'The same narrative core, recognisably the same episode',
  ],
  theological: [
    'No theological relationship',
    'Generic religious language and nothing more',
    'Related but distinct doctrines',
    'A shared doctrinal concept',
    'Complementary theological perspectives on one idea',
    'The same core doctrine, treated authoritatively in both',
  ],
};

const AFFINITY_QUESTION: Record<AffinityDimension, (a: Passage, b: Passage) => EntryType> = {
  thematic: (a, b) => ({
    question: 'How strongly do these two passages share thematic content?',
    source: passageView(a),
    candidate: passageView(b),
  }),
  linguistic: (a, b) => ({
    question: 'How much shared terminology, root vocabulary, or cognate material is there between these passages?',
    source: passageView(a),
    candidate: passageView(b),
  }),
  historical: (a, b) => ({
    question: 'How strong is the historical or contextual relationship between these two passages?',
    source: passageView(a),
    candidate: passageView(b),
  }),
  narrative: (a, b) => ({
    question: 'Do these two passages share narrative elements — the same story, figures, events, or places?',
    source: passageView(a),
    candidate: passageView(b),
  }),
  theological: (a, b) => ({
    question: 'How closely do these two passages align theologically or doctrinally?',
    source: passageView(a),
    candidate: passageView(b),
  }),
};

function passageView(p: Passage) {
  return {
    text: p.textId,
    reference: `${p.book} ${p.chapter}:${p.verse}`,
    originalLanguage: p.metadata.language,
    original: p.originalText,
    translation: p.translation,
    themes: p.themes.map((t) => t.theme),
  };
}

// ============================================================================
// Local, deterministic signals (also used to prefilter candidates)
// ============================================================================

const STOP_WORDS = new Set([
  'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
  'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
  'these', 'those', 'a', 'an', 'his', 'her', 'its', 'their', 'our', 'your', 'my', 'me',
  'he', 'she', 'it', 'they', 'we', 'you', 'i', 'him', 'them', 'us', 'unto', 'upon',
  'shall', 'said', 'say', 'says', 'lord', 'god', 'thou', 'thee', 'ye',
]);

export function significantTerms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  );
}

export function properNouns(text: string): Set<string> {
  const words = text.match(/\b[\p{Lu}][\p{L}]{2,}\b/gu) ?? [];
  return new Set(words.map((w) => w.toLowerCase()).filter((w) => !STOP_WORDS.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const v of a) if (b.has(v)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function sharedTerms(a: Passage, b: Passage): string[] {
  const ta = significantTerms(a.translation);
  const tb = significantTerms(b.translation);
  return [...ta].filter((t) => tb.has(t));
}

export function sharedThemes(a: Passage, b: Passage): string[] {
  const ta = new Set(a.themes.map((t) => t.theme));
  return b.themes.map((t) => t.theme).filter((t) => ta.has(t));
}

/** Coarse local estimate, used to rank candidates before spending Jev calls. */
export function localAffinity(a: Passage, b: Passage): number {
  const themes = jaccard(new Set(a.themes.map((t) => t.theme)), new Set(b.themes.map((t) => t.theme)));
  const terms = jaccard(significantTerms(a.translation), significantTerms(b.translation));
  const names = jaccard(properNouns(a.translation), properNouns(b.translation));
  const sameText = a.textId === b.textId ? 0.1 : 0;
  return Math.min(1, 0.55 * themes + 0.3 * terms + 0.15 * names + sameText);
}

/** 0-1 similarity between two passages from vector embeddings, when present. */
export function embeddingSimilarity(a: Passage, b: Passage): number {
  const ea = a.embeddings;
  const eb = b.embeddings;
  if (!ea?.length || !eb?.length || ea.length !== eb.length) return 0;

  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < ea.length; i += 1) {
    dot += ea[i] * eb[i];
    na += ea[i] * ea[i];
    nb += eb[i] * eb[i];
  }
  if (na === 0 || nb === 0) return 0;
  return Math.max(0, dot / (Math.sqrt(na) * Math.sqrt(nb)));
}

// ============================================================================
// Jev-backed scoring
// ============================================================================

const MIN_JEV_SCORE = 0.1;

/**
 * Ask the judge chain one batch of questions.
 *
 * The source comes back on the reply rather than being asserted here, so a fallback
 * engine that answered is reported as itself. Returning null means no engine could
 * answer, and every caller has a deterministic path for that.
 */
async function askJev(state: EntryType, questions: JevQuestion[]): Promise<{ answers: Record<string, { value: number; probabilities: Record<string, number>; confidence: number; choice?: string }>; source: ScoreSource } | null> {
  const judge = getJevJudge();
  if (!judge.available) return null;

  try {
    const verdict = await judge.ask(state, questions);
    if (Object.keys(verdict.answers).length === 0) return null;
    return { answers: verdict.answers, source: verdict.source };
  } catch (error) {
    console.error('[judge] every engine failed, falling back to local scoring:', (error as Error).message);
    return null;
  }
}

/**
 * Score one passage pair across all five affinity dimensions.
 * One Jev request; deterministic scoring when Jev is unavailable.
 */
export async function scoreAffinity(
  a: Passage,
  b: Passage,
  weights: Record<AffinityDimension, number>
): Promise<Judged<AffinityScores>> {
  const questions: JevQuestion[] = AFFINITY_DIMENSIONS.map((dim) => ({
    kind: 'score' as const,
    id: dim,
    instructions: AFFINITY_QUESTION[dim](a, b),
    criteria: AFFINITY_RUBRIC[dim],
  }));

  const state: EntryType = { source: passageView(a), candidate: passageView(b) };
  const result = await askJev(state, questions);

  let scores: AffinityScores;
  let source: ScoreSource;

  if (result) {
    scores = { composite: 0 } as AffinityScores;
    for (const dim of AFFINITY_DIMENSIONS) {
      scores[dim] = Math.min(1, Math.max(0, result.answers[dim]?.value ?? 0));
    }
    scores.composite = composite(scores, weights);
    // Taken from the reply, not asserted: a fallback engine that answered must be
    // reported as itself rather than as the hosted model.
    source = result.source;
  } else {
    scores = localAffinityScores(a, b, weights);
    source = 'derived';
  }

  return { value: scores, source };
}

/** Score many candidates against one source, batching every question into one call. */
export async function scoreCandidates(
  source: Passage,
  candidates: Passage[],
  weights: Record<AffinityDimension, number>
): Promise<{ candidate: Passage; scores: AffinityScores; source: ScoreSource; confidence: number }[]> {
  if (candidates.length === 0) return [];

  const questions: JevQuestion[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (const dim of AFFINITY_DIMENSIONS) {
      questions.push({
        kind: 'score',
        id: `c${i}.${dim}`,
        instructions: AFFINITY_QUESTION[dim](source, candidates[i]),
        criteria: AFFINITY_RUBRIC[dim],
      });
    }
  }

  const state: EntryType = {
    source: passageView(source),
    candidates: candidates.map(passageView),
  };

  const result = await askJev(state, questions);

  return candidates.map((candidate, i) => {
    if (result) {
      const scores = { composite: 0 } as AffinityScores;
      let confidenceSum = 0;
      for (const dim of AFFINITY_DIMENSIONS) {
        const answer = result.answers[`c${i}.${dim}`];
        scores[dim] = Math.min(1, Math.max(0, answer?.value ?? 0));
        confidenceSum += answer?.confidence ?? 0;
      }
      scores.composite = composite(scores, weights);
      return {
        candidate,
        scores,
        source: result.source,
        confidence: confidenceSum / AFFINITY_DIMENSIONS.length,
      };
    }

    return {
      candidate,
      scores: localAffinityScores(source, candidate, weights),
      source: 'derived' as const,
      confidence: 0,
    };
  });
}

function composite(scores: Omit<AffinityScores, 'composite'>, weights: Record<AffinityDimension, number>): number {
  return AFFINITY_DIMENSIONS.reduce((sum, dim) => sum + scores[dim] * weights[dim], 0);
}

/** Local scoring that mirrors the Jev rubrics closely enough to stay useful. */
export function localAffinityScores(
  a: Passage,
  b: Passage,
  weights: Record<AffinityDimension, number>
): AffinityScores {
  const themeJaccard = jaccard(new Set(a.themes.map((t) => t.theme)), new Set(b.themes.map((t) => t.theme)));
  const termJaccard = jaccard(significantTerms(a.translation), significantTerms(b.translation));
  const nameJaccard = jaccard(properNouns(a.translation), properNouns(b.translation));
  const cognates = cognateOverlap(a, b);

  const sameText = a.textId === b.textId;
  const historicalLink = sameText ? 0.6 : historicalBaseline(a.textId, b.textId);

  const scores: AffinityScores = {
    thematic: scale(themeJaccard, 0, 0.6),
    // Cognate evidence and shared vocabulary are separate signals; take the
    // stronger of the two rather than blending them into one noisy number.
    linguistic: Math.max(scale(termJaccard, 0, 0.35), scale(cognates, 0, 0.35)),
    historical: historicalLink,
    narrative: scale(nameJaccard, 0, 0.4),
    theological: scale(themeJaccard, 0, 0.5),
    composite: 0,
  };
  scores.composite = composite(scores, weights);
  return scores;
}

function scale(value: number, zeroAt: number, fullAt: number): number {
  if (value <= zeroAt) return 0;
  if (value >= fullAt) return FULL_OVERLAP;
  return (value - zeroAt) / (fullAt - zeroAt);
}

/**
 * Character-level overlap between two original texts.
 *
 * Only meaningful across languages: within one language, two unrelated verses
 * already share most of their alphabet, so the measure would report near-total
 * overlap and swamp every other signal. Across languages, shared letters are
 * actual evidence of a shared root.
 */
function cognateOverlap(a: Passage, b: Passage): number {
  if (!a.originalText || !b.originalText) return NO_OVERLAP;
  if (a.metadata.language === b.metadata.language) return NO_OVERLAP;
  return jaccard(letters(a.originalText), letters(b.originalText));
}

function letters(text: string): Set<string> {
  return new Set(text.replace(/[^\p{L}]/gu, '').split(''));
}

/** Baseline historical proximity between corpora, before any model judgment. */
export function historicalBaseline(a: TextId, b: TextId): number {
  if (a === b) return 0.6;
  const table: Record<TextId, Partial<Record<TextId, number>>> = {
    quran: { torah: 0.5, ot: 0.5, talmud: 0.35, nt: 0.3 },
    torah: { ot: 0.9, quran: 0.5, talmud: 0.5, nt: 0.3 },
    ot: { torah: 0.9, nt: 0.4, quran: 0.5, talmud: 0.5 },
    nt: { ot: 0.4, quran: 0.3, torah: 0.3, talmud: 0.35 },
    talmud: { torah: 0.5, ot: 0.5, quran: 0.35, nt: 0.35 },
  };
  return table[a]?.[b] ?? 0.1;
}

// ============================================================================
// Passage-level judgments
// ============================================================================

const DENSITY_RUBRIC = [
  'Purely structural or formulaic, carrying almost no content',
  'A single simple statement',
  'Several concepts, light theological weight',
  'Rich ethical or theological content with real depth',
  'Dense and layered, significant theological weight',
  'Foundational: unusually concentrated meaning for a single passage',
];

/** Semantic richness of a passage, 0-1. Drives indexing priority. */
export async function scoreSemanticDensity(passage: Passage): Promise<number> {
  const result = await askJev({ passage: passageView(passage) }, [
    { kind: 'score', id: 'density', instructions: 'How semantically dense and conceptually rich is this passage?', criteria: DENSITY_RUBRIC },
  ]);
  return result?.answers.density?.value ?? 0.5;
}

const THEME_STRENGTH_RUBRIC = [
  'The theme is absent',
  'The theme is only gestured at',
  'The theme is present but incidental',
  'The theme is clearly addressed',
  'The theme is central to the passage',
  'The passage is definitive for this theme',
];

/**
 * Score the passage against every theme in the taxonomy.
 * One request; the model ranks the options and we read the probabilities.
 */
export async function classifyThemes(passage: Passage, maxThemes = 5): Promise<{ theme: string; score: number; confidence: number; evidence: string[] }[]> {
  const jev = getJevJudge();

  if (!jev.available) {
    return localThemeScores(passage, maxThemes);
  }

  const result = await askJev({ passage: passageView(passage) }, [
    {
      kind: 'choice',
      id: 'themes',
      instructions: {
        question: 'Which themes from the taxonomy apply to this passage?',
        chooseAllThatApply: true,
        note: 'Select every theme the passage genuinely addresses, most relevant first.',
      },
      criteria: Object.fromEntries(THEME_TAXONOMY.map((t) => [t, `The passage addresses ${t.replace(/_/g, ' ')}`])),
    },
  ]);

  const answer = result?.answers.themes;
  if (!answer?.probabilities) return localThemeScores(passage, maxThemes);

  const ranked = Object.entries(answer.probabilities)
    .filter(([, p]) => p >= 0.25)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxThemes);

  if (ranked.length === 0) return localThemeScores(passage, maxThemes);

  // Turn the ranking into graded strengths so downstream scoring has magnitude, not just order.
  const strength = await askJev({ passage: passageView(passage) }, [
    ...ranked.map(([theme], i) => ({
      kind: 'score' as const,
      id: `s${i}`,
      instructions: { question: `How strongly does this passage embody the theme "${theme.replace(/_/g, ' ')}"?`, passage: passageView(passage) },
      criteria: THEME_STRENGTH_RUBRIC,
    })),
  ]);

  return ranked.map(([theme, probability], i) => ({
    theme,
    score: strength?.answers[`s${i}`]?.value ?? probability,
    confidence: Math.min(answer.confidence || 0, probability + 0.2),
    evidence: themeEvidence(passage.translation, theme),
  }));
}

/** Keyword-based theme detection, used when Jev is unavailable. */
export function localThemeScores(passage: Passage, maxThemes = 5): { theme: string; score: number; confidence: number; evidence: string[] }[] {
  const haystack = `${passage.originalText} ${passage.translation}`.toLowerCase();
  const terms = significantTerms(haystack);

  const scored = THEME_TAXONOMY.map((theme) => {
    const keywords = themeKeywords(theme);
    const hits = keywords.filter((k) => haystack.includes(k));
    const lexical = keywords.length === 0 ? 0 : hits.length / keywords.length;
    const themeTermHit = terms.has(theme) ? 0.2 : 0;
    const raw = Math.min(1, 0.6 * lexical + themeTermHit);
    return { theme, raw, hits };
  })
    .filter((t) => t.raw > 0)
    .sort((a, b) => b.raw - a.raw)
    .slice(0, maxThemes);

  return scored.map(({ theme, raw, hits }) => ({
    theme,
    score: raw,
    confidence: Math.min(0.6, raw),
    evidence: hits.slice(0, 3),
  }));
}

const THEME_KEYWORDS: Record<string, string[]> = {
  mercy: ['mercy', 'mercies', 'merciful', 'compassion', 'kindness', 'rahmah'],
  compassion: ['compassion', 'tenderness', 'sympathy', 'heart'],
  justice: ['justice', 'just', 'judgment', 'judge', 'equity', 'righteous'],
  wrath: ['wrath', 'anger', 'fury', 'rage'],
  forgiveness: ['forgive', 'forgiveness', 'forgiven', 'pardon', 'remit'],
  love: ['love', 'loved', 'beloved', 'charity'],
  power: ['power', 'might', 'strength', 'almighty', 'dominion'],
  knowledge: ['knowledge', 'know', 'wisdom', 'understanding', 'science'],
  wisdom: ['wisdom', 'wise', 'understanding', 'discernment'],
  sovereignty: ['kingdom', 'reign', 'sovereign', 'throne', 'rule'],
  holiness: ['holy', 'holiness', 'sanctified', 'sacred', 'purity'],
  faithfulness: ['faithful', 'loyal', 'steadfast', 'trustworthy'],
  covenant: ['covenant', 'covenantal', 'oath', 'bond', 'promise'],
  law: ['law', 'statute', 'ordinance', 'decree', 'commandment'],
  commandment: ['commandment', 'command', 'precept', 'charge'],
  obedience: ['obey', 'obedient', 'obedience', 'submit', 'hearken'],
  sin: ['sin', 'sins', 'sinful', 'transgress', 'iniquity', 'evil'],
  repentance: ['repent', 'repentance', 'return', 'confess'],
  atonement: ['atonement', 'reconcile', 'reconciliation', 'expiate', 'sacrifice for'],
  sacrifice: ['sacrifice', 'sacrificial', 'offering', 'burnt'],
  purity: ['pure', 'purity', 'clean', 'unclean', 'holiness'],
  righteousness: ['righteous', 'righteousness', 'just', 'upright'],
  salvation: ['salvation', 'save', 'saved', 'redeem', 'deliver'],
  redemption: ['redemption', 'redeemer', 'ransom', 'ransomed'],
  resurrection: ['resurrection', 'resurrect', 'raised', 'risen'],
  judgment: ['judgment', 'judge', 'day of the lord', 'final judgment'],
  heaven: ['heaven', 'heavens', 'heavenly', 'paradise', 'kingdom of heaven'],
  hell: ['hell', 'gehenna', 'damnation', 'everlasting fire'],
  afterlife: ['afterlife', 'eternal', 'eternity', 'everlasting'],
  messiah: ['messiah', 'christ', 'anointed'],
  kingdom: ['kingdom', 'reign', 'dominion'],
  eternal_life: ['eternal life', 'everlasting life', 'life eternal'],
  prayer: ['pray', 'prayer', 'supplication', 'call upon'],
  worship: ['worship', 'bow', 'prostrate', 'praise'],
  fasting: ['fast', 'fasting', 'abstain'],
  pilgrimage: ['pilgrimage', 'pilgrim', 'sacred journey'],
  charity: ['charity', 'give', 'gift', 'generosity', 'benevolence'],
  almsgiving: ['alms', 'almsgiving', 'poor', 'needy'],
  ritual: ['ritual', 'ordinance', 'ceremony', 'appointed'],
  ceremony: ['ceremony', 'feast', 'assembly'],
  sabbath: ['sabbath', 'saturday', 'seventh day', 'rest day'],
  festival: ['festival', 'feast', 'pilgrimage'],
  humility: ['humble', 'humility', 'meek', 'lowly'],
  patience: ['patience', 'patient', 'endure', 'persevere'],
  gratitude: ['gratitude', 'thankful', 'thanks', 'praise'],
  trust: ['trust', 'rely', 'put your hope'],
  honesty: ['honest', 'truth', 'truthful', 'false witness'],
  kindness: ['kindness', 'kind', 'goodness'],
  generosity: ['generous', 'generosity', 'openhanded'],
  creation: ['create', 'created', 'creation', 'made'],
  adam: ['adam'],
  noah: ['noah', 'nuh'],
  abraham: ['abraham', 'ibrahim'],
  moses: ['moses', 'moshe', 'harun', 'aaron'],
  david: ['david', 'dawud'],
  solomon: ['solomon', 'sulayman'],
  jesus: ['jesus', 'isa', 'messiah'],
  muhammad: ['muhammad', 'rasul'],
  prophets: ['prophet', 'prophets', 'messenger'],
  angels: ['angel', 'angels', 'malaika', 'gabriel'],
  satan: ['satan', 'devil', 'iblis', 'shaytan'],
  community: ['community', 'nation', 'people', 'community of'],
  family: ['family', 'son', 'daughter', 'father', 'mother', 'children'],
  marriage: ['marry', 'marriage', 'wife', 'husband', 'bride'],
  parenthood: ['children', 'offspring', 'heirs', 'seed'],
  neighbor: ['neighbor', 'neighbour', 'your neighbor'],
  stranger: ['stranger', 'sojourner', 'alien', 'guest'],
  poor: ['poor', 'needy', 'destitute', 'humble'],
  orphan: ['orphan', 'fatherless', 'widow'],
  widow: ['widow', 'orphans', 'fatherless'],
  governance: ['judge', 'judges', 'ruler', 'authority', 'king', 'government'],
  earth: ['earth', 'ground', 'land'],
  light: ['light', 'illumination', 'shine', 'brightness'],
  darkness: ['darkness', 'dark', 'night'],
  water: ['water', 'sea', 'river', 'rain'],
  fire: ['fire', 'flame', 'burn'],
  wind: ['wind', 'storm', 'breeze'],
  stars: ['star', 'stars', 'heavenly host'],
  animals: ['animal', 'beast', 'cattle', 'sheep', 'bird'],
  plants: ['plant', 'tree', 'seed', 'harvest', 'vine'],
};

function themeKeywords(theme: string): string[] {
  return THEME_KEYWORDS[theme] ?? [theme.replace(/_/g, ' ')];
}

/**
 * Whether a text contains a keyword as a whole word or phrase.
 *
 * Plain substring matching is wrong here: "reincarnation" contains "nation",
 * which would tag it as a passage about community, and "mercy" contains "merc".
 * Requiring a word boundary keeps the keyword tables meaning what they say.
 */
export function containsKeyword(haystack: string, keyword: string): boolean {
  if (!keyword) return false;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \\b does not behave for keywords that start or end in punctuation.
  const left = /^[a-z0-9]/i.test(keyword) ? '\\b' : '';
  const right = /[a-z0-9]$/i.test(keyword) ? '\\b' : '';
  return new RegExp(`${left}${escaped}${right}`, 'i').test(haystack);
}

function themeEvidence(translation: string, theme: string): string[] {
  const sentences = translation.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20);
  const keywords = themeKeywords(theme);
  return sentences.filter((s) => keywords.some((k) => containsKeyword(s, k))).slice(0, 3);
}

// ============================================================================
// Cross-references
// ============================================================================

const CROSS_REF_TYPES: CrossRefType[] = ['quote', 'allusion', 'thematic', 'linguistic', 'narrative', 'theological'];

const CROSS_REF_TYPE_CRITERIA = {
  quote: 'The target quotes or nearly quotes the source',
  allusion: 'The target indirectly echoes or alludes to the source',
  thematic: 'The two share a theme without borrowing from each other',
  linguistic: 'The two share terminology, roots, or cognate forms',
  narrative: 'The two recount the same story, figures, or event',
  theological: 'The two express the same doctrine in different words',
  none: 'There is no meaningful relationship of any kind',
} satisfies Record<CrossRefType | 'none', string>;

/**
 * Find connections between one passage and a candidate set.
 * One request: a noul gate per candidate, then a choice for the surviving ones.
 */
export async function detectCrossReferences(source: Passage, candidates: Passage[], maxRefs = 10): Promise<CrossRef[]> {
  if (candidates.length === 0) return [];

  const jev = getJevJudge();

  if (!jev.available) {
    return localCrossReferences(source, candidates, maxRefs);
  }

  const state: EntryType = { source: passageView(source), candidates: candidates.map(passageView) };

  const gate = await askJev(state, [
    ...candidates.map((c, i) => ({
      kind: 'noul' as const,
      id: `c${i}`,
      instructions: {
        question:
          'Is candidate a meaningful connection to the source — a quotation, an allusion, a shared theme, a shared linguistic root, or a shared narrative?',
        source: passageView(source),
        candidate: passageView(c),
      },
      criteria: {
        true: 'A reader would recognise the link without being told to look for it',
        false: 'The two are unrelated, or share only generic religious vocabulary',
      },
    })),
  ]);

  if (!gate) return localCrossReferences(source, candidates, maxRefs);

  const surviving = candidates
    .map((candidate, i) => ({ candidate, probability: gate.answers[`c${i}`]?.value ?? 0 }))
    .filter((c) => c.probability >= 0.4)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, maxRefs);

  if (surviving.length === 0) return [];

  const typed = await askJev(state, [
    ...surviving.map((s, i) => ({
      kind: 'choice' as const,
      id: `t${i}`,
      instructions: {
        question: 'What kind of connection links the source to the candidate?',
        source: passageView(source),
        candidate: passageView(s.candidate),
      },
      criteria: CROSS_REF_TYPE_CRITERIA,
    })),
    ...surviving.map((s, i) => ({
      kind: 'score' as const,
      id: `s${i}`,
      instructions: {
        question: 'How strong is the connection between the source and the candidate?',
        source: passageView(source),
        candidate: passageView(s.candidate),
      },
      criteria: [
        'Negligible',
        'Weak, plausibly coincidental',
        'Moderate and clear but not strong',
        'Strong and significant',
        'Very strong, a major parallel',
        'Definitive, a foundational connection',
      ],
    })),
  ]);

  if (!typed) return localCrossReferences(source, candidates, maxRefs);

  return surviving
    .map((s, i) => ({
      chosen: typed.answers[`t${i}`]?.choice,
      ref: {
        targetPassageId: s.candidate.id,
        targetText: s.candidate.textId,
        type: normalizeCrossRefType(typed.answers[`t${i}`]?.choice),
        strength: typed.answers[`s${i}`]?.value ?? s.probability,
        direction: 'bidirectional' as const,
        notes: `Probability ${(s.probability * 100).toFixed(0)}%, strength confidence ${((typed.answers[`s${i}`]?.confidence ?? 0) * 100).toFixed(0)}%`,
        detectedBy: 'jev' as const,
      },
    }))
    .filter((entry) => entry.chosen !== 'none')
    .map((entry) => entry.ref)
    .sort((a, b) => b.strength - a.strength);
}

function normalizeCrossRefType(choice: string | undefined): CrossRefType {
  return CROSS_REF_TYPES.includes(choice as CrossRefType) ? (choice as CrossRefType) : 'thematic';
}

export function localCrossReferences(source: Passage, candidates: Passage[], maxRefs: number): CrossRef[] {
  return candidates
    .map((candidate) => {
      const themes = sharedThemes(source, candidate);
      const terms = sharedTerms(source, candidate);
      const names = jaccard(properNouns(source.translation), properNouns(candidate.translation));

      // A handful of shared function-ish words is not a connection. Two sacred
      // texts about the same subject naturally share some vocabulary, so the
      // counts are scaled rather than summed straight into a strength.
      const themeSignal = Math.min(1, themes.length / 3);
      const termSignal = Math.min(1, terms.length / 12);
      const nameSignal = Math.min(1, names / 0.25);
      const strength = Math.min(0.95, 0.4 * themeSignal + 0.3 * termSignal + 0.3 * nameSignal);

      // Ordering of significance matters: a shared figure is a stronger signal
      // that a shared theme is, which is a stronger signal than shared words.
      let type: CrossRefType = 'thematic';
      if (names > 0.2) type = 'narrative';
      else if (source.textId !== candidate.textId && terms.length >= 6) type = 'allusion';
      else if (terms.length >= 8) type = 'linguistic';

      const reasons: string[] = [];
      if (themes.length) reasons.push(`shared themes: ${themes.join(', ')}`);
      if (names > 0.2) reasons.push('shared figures and names');
      if (terms.length >= 4) reasons.push(`${terms.length} shared terms`);

      return {
        targetPassageId: candidate.id,
        targetText: candidate.textId,
        type,
        strength,
        direction: 'bidirectional' as const,
        notes: reasons.length ? reasons.join('; ') : 'weak overlap',
        detectedBy: 'derived' as const,
      };
    })
    .filter((ref) => ref.strength >= 0.2)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, maxRefs);
}

// ============================================================================
// Pairwise alignment (for side-by-side comparison)
// ============================================================================

const ALIGNMENT_TYPES = ['direct_quote', 'strong_allusion', 'thematic_parallel', 'linguistic_cognate', 'narrative_parallel', 'theological_echo'] as const;

export const ALIGNMENT_TYPE_CRITERIA = {
  direct_quote: 'The candidate reproduces the source nearly word for word',
  strong_allusion: 'The candidate clearly points back at the source without quoting it',
  thematic_parallel: 'Both develop the same theme, in similar ways',
  linguistic_cognate: 'The two share terms, roots, or cognates in their original languages',
  narrative_parallel: 'Both recount the same story, figures, or event',
  theological_echo: 'Both assert the same doctrine, in different words',
  none: 'Nothing links these two passages',
} satisfies Record<(typeof ALIGNMENT_TYPES)[number] | 'none', string>;

export interface MatchedSegment {
  textA: string;
  textB: string;
  startA: number;
  endA: number;
  startB: number;
  endB: number;
}

export interface AlignmentResult {
  type: (typeof ALIGNMENT_TYPES)[number] | 'none';
  strength: number;
  matchedSegments: MatchedSegment[];
  notes: string;
  source: ScoreSource;
}

const ALIGNMENT_STRENGTH_RUBRIC = [
  'No alignment at all',
  'A faint trace of a shared idea',
  'Weak alignment',
  'Moderate alignment',
  'Strong alignment',
  'Exceptional alignment, unmistakable to a reader',
];

/**
 * Pairs per Jev request.
 *
 * Every pair contributes a `type` and a `strength` question, so eight passages —
 * 28 pairs — is 56 questions. This bound sits above that on purpose: a full
 * comparison is one round trip, which is the whole point. It exists only so that
 * raising MAX_COMPARISON_PASSAGES later degrades into several requests instead of
 * one request the model will refuse.
 */
const PAIRS_PER_REQUEST = 32;

/**
 * Align many pairs, in one request.
 *
 * The old code called the model once per pair, so comparing five passages issued
 * ten HTTP requests to ask ten independent questions. Every one of those questions
 * only needs the passages, so they all go out together: the state carries each
 * passage once, and each question names the pair it is about. Returns results in
 * the same order as `pairs`, so the caller keeps its own orientation.
 *
 * A pair whose answers are missing, or any pair from a request that failed, falls
 * back to the local ladder rather than dropping out of the comparison.
 */
export async function computeAlignments(pairs: Array<[Passage, Passage]>): Promise<AlignmentResult[]> {
  if (pairs.length === 0) return [];

  const jev = getJevJudge();
  if (!jev.available) return pairs.map(([a, b]) => localAlignment(a, b));

  // One entry per distinct passage, so the state carries each exactly once even
  // when a passage appears in many pairs.
  const docs = [...new Map(pairs.flat().map((p) => [p.id, p])).values()].map(passageView);
  const computed: Array<AlignmentResult | null> = new Array(pairs.length).fill(null);

  for (let start = 0; start < pairs.length; start += PAIRS_PER_REQUEST) {
    const chunk = pairs.slice(start, start + PAIRS_PER_REQUEST);

    const questions: JevQuestion[] = chunk.flatMap(([a, b], i) => {
      const pair = { source: passageView(a), candidate: passageView(b) };
      return [
        {
          kind: 'choice' as const,
          id: `p${i}.type`,
          instructions: { question: 'What kind of alignment links the source to the candidate?', ...pair },
          criteria: ALIGNMENT_TYPE_CRITERIA,
        },
        {
          kind: 'score' as const,
          id: `p${i}.strength`,
          instructions: { question: 'How strong is the alignment between the source and the candidate?', ...pair },
          criteria: ALIGNMENT_STRENGTH_RUBRIC,
        },
      ];
    });

    const result = await askJev({ passages: docs }, questions);
    if (!result) continue;

    chunk.forEach(([a, b], i) => {
      const chosen = result.answers[`p${i}.type`]?.choice;

      // A pair the model did not answer is not a pair it judged "none". `none` is
      // a real answer — it is one of the alignment criteria — but an absent answer
      // must fall through to the local ladder rather than be reported as a verdict.
      const answered = chosen === 'none' || (chosen !== undefined && (ALIGNMENT_TYPES as readonly string[]).includes(chosen));
      if (!answered) return;

      const segments = sharedPhrases(a.translation, b.translation);
      computed[start + i] = {
        type: chosen as AlignmentResult['type'],
        strength: clamp01(result.answers[`p${i}.strength`]?.value ?? 0),
        matchedSegments: segments,
        notes: alignmentNote(segments),
        source: result.source,
      };
    });
  }

  return pairs.map(([a, b], i) => computed[i] ?? localAlignment(a, b));
}

/** Evidence summary, the same whether the pair was typed by Jev or locally. */
function alignmentNote(segments: MatchedSegment[]): string {
  return segments.length
    ? `${segments.length} shared phrase${segments.length === 1 ? '' : 's'}`
    : 'no shared phrasing detected';
}

/** One pair. Thin wrapper over the batched path, for callers that hold a single pair. */
export async function computeAlignment(a: Passage, b: Passage): Promise<AlignmentResult> {
  return (await computeAlignments([[a, b]]))[0];
}

export function localAlignment(a: Passage, b: Passage): AlignmentResult {
  const segments = sharedPhrases(a.translation, b.translation);
  const themes = sharedThemes(a, b);
  const names = jaccard(properNouns(a.translation), properNouns(b.translation));
  const originalShared = cognateOverlap(a, b);

  let type: AlignmentResult['type'] = 'none';
  let strength = 0;

  if (segments.some((s) => s.textA.length > 30)) {
    type = 'direct_quote';
    strength = 0.85;
  } else if (names > 0.2) {
    type = 'narrative_parallel';
    strength = 0.6;
  } else if (originalShared > 0.4) {
    type = 'linguistic_cognate';
    strength = 0.55;
  } else if (themes.length >= 2) {
    type = 'thematic_parallel';
    strength = 0.5;
  } else if (themes.length === 1) {
    type = 'theological_echo';
    strength = 0.3;
  } else if (segments.length > 0) {
    type = 'strong_allusion';
    strength = 0.35;
  }

  return {
    type,
    strength,
    matchedSegments: segments,
    notes: alignmentNote(segments),
    source: 'derived',
  };
}

/** Longest common phrases between two translations, for highlight segments. */
export function sharedPhrases(textA: string, textB: string, minWords = 3, maxPhrases = 8): MatchedSegment[] {
  const lowerA = textA.toLowerCase();
  const lowerB = textB.toLowerCase();
  const wordsA = lowerA.split(/\s+/);

  const found = new Map<string, MatchedSegment>();

  for (let i = 0; i < wordsA.length - minWords + 1; i += 1) {
    for (let len = Math.min(8, wordsA.length - i); len >= minWords; len -= 1) {
      const phrase = wordsA.slice(i, i + len).join(' ');
      const startA = lowerA.indexOf(phrase);
      if (startA === -1) continue;
      const startB = lowerB.indexOf(phrase);
      if (startB === -1) continue;
      if (!found.has(phrase)) {
        found.set(phrase, { textA: phrase, textB: phrase, startA, endA: startA + phrase.length, startB, endB: startB + phrase.length });
      }
      i += len - 1;
      break;
    }
  }

  return [...found.values()].sort((x, y) => y.textA.length - x.textA.length).slice(0, maxPhrases);
}

// ============================================================================
// Semantic search
// ============================================================================

/**
 * Below this, Jev's verdict that the corpus as a whole does not address the
 * query at all. Sits between the cookbook's ~0.9 "addressed" and ~0.05 "silent"
 * examples, and is deliberately conservative: reporting that these five texts say
 * nothing on a topic is more useful than returning the least-bad keyword matches.
 */
const CORPUS_ADDRESSED = 0.6;
const CORPUS_PARTIAL = 0.3;

/** How many shortlisted passages Jev re-ranks. Bounds one request's cost. */
const RERANK_LIMIT = Number(process.env.SEARCH_RERANK_LIMIT ?? 24);

export type CorpusVerdict = 'addressed' | 'partial' | 'unaddressed' | 'unknown';

export interface RerankedSearch {
  /** Candidate passage keys, best first. */
  order: string[];
  /** Relevance per candidate key, 0-1. */
  relevance: Record<string, number>;
  /** What the corpus as a whole has to say about the query. */
  verdict: CorpusVerdict;
  /** Probability that the query is *not* addressed, 0-1. */
  silence: number;
  source: ScoreSource;
}

/**
 * Re-rank a fast-search shortlist, and say whether it is worth reading at all.
 *
 * BM25 can only rank by shared words, so a query phrased differently from the
 * passage — or about an idea rather than a word — ranks poorly or not at all.
 * This scores every shortlisted passage against the query with a Noul, and adds
 * one corpus-level Noul so a total miss is distinguishable from a weak hit.
 *
 * All questions go out in a single request: the state carries the shortlist once
 * and each question references its own candidate.
 *
 * Returns null when Jev is unavailable, so callers keep their full-text order.
 */
export async function rerankForQuery(query: string, candidates: Passage[]): Promise<RerankedSearch | null> {
  if (candidates.length === 0) return null;

  const shortlist = candidates.slice(0, RERANK_LIMIT);
  const docs = shortlist.map(passageView);

  const questions: JevQuestion[] = [
    ...shortlist.map((candidate, i) => ({
      kind: 'noul' as const,
      id: `r${i}`,
      instructions: {
        question: 'Does this passage speak to what the reader is looking for, even where it uses entirely different words?',
        search: query,
        candidate: docs[i],
      },
      criteria: {
        true: "The passage addresses the reader's interest in its own words",
        false: 'The passage is on an unrelated topic, or merely shares generic religious vocabulary with the query',
      },
    })),
    {
      kind: 'noul' as const,
      id: 'corpus',
      instructions: {
        question: `Taking these passages together, do they address what the reader is looking for: "${query}"?`,
        search: query,
        passages: docs,
      },
      criteria: {
        true: 'At least one passage makes the reader\'s point, or clearly touches on it',
        false: 'The passages are on a different subject, and a reader would be better served elsewhere',
      },
    },
  ];

  const result = await askJev({ search: query, candidates: docs }, questions);
  if (!result) return null;

  const relevance: Record<string, number> = {};
  shortlist.forEach((candidate, i) => {
    relevance[candidate.passageKey] = clamp01(result.answers[`r${i}`]?.value ?? 0);
  });

  // A Noul reports the probability of the *true* outcome, so the corpus question
  // above answers "these passages do address the query". Silence is its complement.
  // No answer at all is not evidence of silence, so it stays undecided.
  const corpus = result.answers.corpus?.value;

  return {
    order: [...shortlist].sort((a, b) => relevance[b.passageKey] - relevance[a.passageKey]).map((p) => p.passageKey),
    relevance,
    verdict: corpus === undefined ? 'unknown' : verdictFromSilence(clamp01(1 - corpus)),
    silence: corpus === undefined ? 0 : clamp01(1 - corpus),
    source: result.source,
  };
}

function verdictFromSilence(silence: number): CorpusVerdict {
  const addressed = 1 - silence;
  if (addressed >= CORPUS_ADDRESSED) return 'addressed';
  if (addressed >= CORPUS_PARTIAL) return 'partial';
  return 'unaddressed';
}

/**
 * Blend Jev's relevance with the full-text score.
 *
 * Re-ranking on Jev alone would bury a passage that literally contains the
 * reader's words behind one that merely means something similar, which reads as
 * a bug to anyone who searched for a term they can see. Full-text keeps a
 * minority vote so an exact match stays reachable.
 */
const JEV_WEIGHT = Number(process.env.SEARCH_JEV_WEIGHT ?? 0.75);

export function blendSearchScore(jevRelevance: number, fullTextScore: number): number {
  const w = Math.min(1, Math.max(0, JEV_WEIGHT));
  return w * jevRelevance + (1 - w) * fullTextScore;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// ============================================================================
// Query expansion
// ============================================================================

export interface QueryExpansion {
  theme: string | null;
  confidence: number;
  source: ScoreSource;
}

/**
 * Name the theme a query reaches for, so literal search can be widened with that
 * theme's vocabulary.
 *
 * Jev picks from a closed set — the taxonomy — rather than inventing synonyms.
 * That keeps the answer consumable as code, which a generated term list would not.
 */
const memoExpand = createBoundedMemo<Promise<QueryExpansion>>(200);

export async function expandQueryTheme(query: string): Promise<QueryExpansion> {
  return memoExpand(normalizeQueryKey(query), () => expandQueryThemeUncached(query));
}

async function expandQueryThemeUncached(query: string): Promise<QueryExpansion> {
  const local = localQueryTheme(query);
  const jev = getJevJudge();
  if (!jev.available) return local;

  const result = await askJev(
    { query },
    [
      {
        kind: 'choice' as const,
        id: 'theme',
        instructions: {
          question: 'Which theme in the taxonomy is this search about?',
          chooseOne: 'Pick the single closest theme, or none when the search is not about a theme',
          query,
        },
        criteria: {
          ...Object.fromEntries(THEME_TAXONOMY.map((t) => [t, `The search is about ${t.replace(/_/g, ' ')}`])),
          none: 'The search names a specific passage, or is not about any theme in the taxonomy',
        },
      },
    ]
  );

  const answer = result?.answers.theme;
  if (!answer?.choice || answer.choice === 'none') return local;

  return { theme: answer.choice, confidence: answer.confidence, source: result?.source ?? 'derived' };
}

/** Local theme guess, from the same keyword tables used to score passage themes. */
export function localQueryTheme(query: string): QueryExpansion {
  const haystack = ` ${query.toLowerCase()} `;
  let best: string | null = null;
  let bestHits = 0;

  for (const theme of THEME_TAXONOMY) {
    const hits = themeKeywords(theme).filter((k) => containsKeyword(haystack, k)).length;
    if (hits > bestHits) {
      best = theme;
      bestHits = hits;
    }
  }

  return {
    theme: bestHits > 0 ? best : null,
    confidence: bestHits > 0 ? Math.min(0.7, 0.3 * bestHits) : 0,
    source: 'derived',
  };
}

/** Search terms for a theme, used to widen a literal query. */
export function themeSearchTerms(theme: string): string[] {
  return themeKeywords(theme).filter((k) => k.length > 3);
}

// ============================================================================
// Search intent
// ============================================================================

export const SEARCH_INTENT_OPTIONS = [
  { id: 'comparison', label: 'Comparison', description: 'The user wants two or more passages set side by side' },
  { id: 'explanation', label: 'Explanation', description: 'The user wants to understand what a passage means' },
  { id: 'thematic_study', label: 'Thematic Study', description: 'The user is tracing a theme across the texts' },
  { id: 'linguistic_analysis', label: 'Linguistic Analysis', description: 'The user is examining words, roots, or original language' },
  { id: 'cross_reference', label: 'Cross Reference', description: 'The user is looking for passages that connect to something' },
  { id: 'reading', label: 'Reading', description: 'The user wants to read a particular passage' },
] as const;

export type SearchIntent = (typeof SEARCH_INTENT_OPTIONS)[number]['id'] | 'unknown';

export interface IntentResult {
  intent: SearchIntent;
  confidence: number;
  probabilities: Record<string, number>;
  source: ScoreSource;
}

const INTENT_KEYWORDS: Array<[SearchIntent, string[]]> = [
  ['comparison', ['compare', 'comparison', 'versus', 'vs', 'side by side', 'difference', 'differ', 'contrast']],
  ['cross_reference', ['cross reference', 'cross-reference', 'quoted', 'quotation', 'related', 'parallel to', 'referenced']],
  ['thematic_study', ['theme', 'thematic', 'throughout', 'across texts', 'concept of', 'idea of']],
  ['linguistic_analysis', ['word', 'etymology', 'root', 'hebrew', 'arabic', 'greek', 'grammar', 'term', 'terminology']],
  ['explanation', ['meaning', 'means', 'explain', 'interpretation', 'understand', 'significance']],
  ['reading', ['read', 'full text', 'chapter', 'verse', 'surah', 'passage']],
];

/** Classify what the user is trying to do. Falls back to keyword matching. */
/**
 * Intent depends on nothing but the query text, and the search page offers the same
 * theme chips and suggestions on every visit, so this is memoised. Without it each
 * repeat of a popular query paid for a request that could only return the same
 * answer.
 */
/** Case and spacing must not create two cache entries for one question. */
function normalizeQueryKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

const memoIntent = createBoundedMemo<Promise<IntentResult>>(200);

export async function classifySearchIntent(query: string): Promise<IntentResult> {
  return memoIntent(normalizeQueryKey(query), () => classifySearchIntentUncached(query));
}

async function classifySearchIntentUncached(query: string): Promise<IntentResult> {
  const jev = getJevJudge();

  if (!jev.available) return localIntent(query);

  const result = await askJev({ query }, [
    {
      kind: 'choice',
      id: 'intent',
      instructions: "What is the user trying to do with this search for sacred texts?",
      criteria: Object.fromEntries(SEARCH_INTENT_OPTIONS.map((o) => [o.id, o.description])),
    },
  ]);

  const answer = result?.answers.intent;
  if (!answer?.choice || answer.choice === 'unknown') return localIntent(query);

  return {
    intent: answer.choice as SearchIntent,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    source: result?.source ?? 'derived',
  };
}

export function localIntent(query: string): IntentResult {
  const q = query.toLowerCase();
  let best: SearchIntent = 'reading';
  let bestHits = 0;

  for (const [intent, keywords] of INTENT_KEYWORDS) {
    const hits = keywords.filter((k) => q.includes(k)).length;
    if (hits > bestHits) {
      best = hits > 0 ? intent : best;
      bestHits = hits;
    }
  }

  const intent = bestHits > 0 ? best : 'unknown';
  return {
    intent,
    confidence: bestHits > 0 ? Math.min(0.75, 0.35 + 0.2 * bestHits) : 0,
    probabilities: { [intent]: intent === 'unknown' ? 0.4 : Math.min(0.75, 0.35 + 0.2 * bestHits) },
    source: 'derived',
  };
}

// ============================================================================
// Corpus metadata
// ============================================================================

export function describeCorpus(): Array<{ textId: TextId; name: string; language: string; direction: 'rtl' | 'ltr' }> {
  const meta: Record<TextId, { name: string; language: string; direction: 'rtl' | 'ltr' }> = {
    quran: { name: 'Quran', language: 'Arabic', direction: 'rtl' },
    torah: { name: 'Torah', language: 'Hebrew', direction: 'rtl' },
    talmud: { name: 'Talmud', language: 'Aramaic', direction: 'rtl' },
    ot: { name: 'Old Testament', language: 'Hebrew', direction: 'rtl' },
    nt: { name: 'New Testament', language: 'Greek', direction: 'ltr' },
  };

  return (Object.keys(meta) as TextId[]).map((textId) => ({ textId, ...meta[textId] }));
}
