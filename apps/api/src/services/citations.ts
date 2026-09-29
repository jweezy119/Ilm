/**
 * Citations: passages that share verbatim words with this one, across corpora.
 *
 * The cross-reference list on a passage page mixes four kinds of claim — a
 * quotation, an allusion, a shared theme, a shared word — and shows eight of them
 * in one undifferentiated list sorted by strength. The result is a page whose
 * most confident-looking entries are often the least interesting: a book
 * agreeing with itself, or the Pentateuch appearing in two collections.
 *
 * This is the part of that data worth showing on its own. `detect-quotations`
 * has already stored every cross-corpus run of six or more shared words, with
 * the matched string and its offsets, so this is a read, not a detection.
 *
 * **It does not say who quotes whom.** The stored `direction` is 'bidirectional'
 * on purpose: verse order is per-corpus, so there is no shared ordering that
 * would tell a later passage from an earlier one, and no global sequence on which
 * to base a claim about lineage. Guessing would be the single most misleading
 * thing this endpoint could do — a reader who caught one bad "the Talmud quotes
 * Genesis" would have cause to distrust the other 3,688. So a citation here
 * means "these two passages share these words", and which came first is left to
 * the reader.
 *
 * `parallel` (same corpus, repetition) and `duplicate` (the same verse in two
 * collections, which the Pentateuch is in both `torah` and `ot`) are excluded
 * here and from the default cross-reference list. They are not errors — 44,000 of
 * them are real matches — but they are not lineage, and mixing them with
 * cross-corpus citations in one ranked list is what made the old list useless.
 */

import { prisma } from './passage';
import type { TextId } from '@ilm/shared';

/** Longest list returned before the UI would be unreadable anyway. */
const MAX_CITATIONS = 60;

/** Types that mean "another corpus says these words too". */
const CITATION_TYPE = 'quotation';

interface Segment {
  textA: string;
  textB: string;
  startA: number;
  startB: number;
  length: number;
}

export interface CitationMember {
  passageId: string;
  passageKey: string;
  textId: TextId;
  book: string;
  chapter: number;
  verse: number;
  /** This passage's own words, which is what the reader came from. */
  ownText: string;
  /** The other passage's words, so the shared run can be seen in context. */
  otherText: string;
  /** The shared words themselves, the first of possibly several runs. */
  sharedText: string;
  /** Every shared run, for a passage quoted in more than one place. */
  sharedRuns: string[];
  /** Words in the longest contiguous run. */
  longestRun: number;
  words: number;
  strength: number;
  detectedBy: string;
  notes: string;
  /**
   * Whether this passage is `textA` in the stored segment. The detector writes
   * segments in pair-key order, which is not a claim about direction, so this is
   * used only to align the two strings for display — never to say who quotes whom.
   */
  selfIsTextA: boolean;
}

export interface CitationGroup {
  textId: TextId;
  count: number;
  members: CitationMember[];
}

export interface PassageCitations {
  passageKey: string;
  textId: TextId;
  total: number;
  groups: CitationGroup[];
}

/** Passage rows needed for the citation list. Kept narrow: this runs per page load. */
const PASSAGE_SELECT = {
  id: true,
  passageKey: true,
  textId: true,
  bookSlug: true,
  chapterNum: true,
  verseNum: true,
  primaryTranslation: true,
} as const;

export async function getCitationsForPassage(
  passageId: string,
  options: { limit?: number } = {}
): Promise<PassageCitations> {
  const limit = Math.min(MAX_CITATIONS, Math.max(1, options.limit ?? MAX_CITATIONS));

  const self = await prisma.passage.findUnique({ where: { id: passageId }, select: PASSAGE_SELECT });
  if (!self) {
    return { passageKey: '', textId: 'quran', total: 0, groups: [] };
  }

  /*
   * Both directions, because the stored edge is a pair and neither side was
   * chosen as the citer. Filtering on `type = 'quotation'` inside the query
   * rather than after it: `take` is applied first, so filtering afterwards would
   * return eight rows of which none were citations, which is the failure this
   * whole module exists to fix.
   */
  const rows = await prisma.crossReference.findMany({
    where: {
      type: CITATION_TYPE,
      OR: [{ sourcePassageId: passageId }, { targetPassageId: passageId }],
    },
    orderBy: { strength: 'desc' },
    take: limit,
    include: { sourcePassage: { select: PASSAGE_SELECT }, targetPassage: { select: PASSAGE_SELECT } },
  });

  const members: CitationMember[] = [];

  for (const row of rows) {
    const selfIsSource = row.sourcePassageId === passageId;
    const other = selfIsSource ? row.targetPassage : row.sourcePassage;
    if (other.id === self.id) continue;

    const segments = (row.matchedSegments as unknown as Segment[] | null) ?? [];
    const longest = segments.reduce((max, s) => Math.max(max, s.length ?? 0), 0);

    // `textA` is whichever passage sorted first in the pair key, so which side
    // this passage occupies has to be worked out before the strings mean
    // anything.
    const selfIsTextA = selfIsSource;

    members.push({
      passageId: other.id,
      passageKey: other.passageKey,
      textId: other.textId as TextId,
      book: other.bookSlug,
      chapter: other.chapterNum,
      verse: other.verseNum,
      ownText: self.primaryTranslation,
      otherText: other.primaryTranslation,
      sharedText: segments[0] ? (selfIsTextA ? segments[0].textA : segments[0].textB) : '',
      sharedRuns: segments.map((s) => (selfIsTextA ? s.textA : s.textB)).filter(Boolean),
      longestRun: longest,
      words: segments.reduce((sum, s) => sum + (s.length ?? 0), 0),
      strength: row.strength,
      detectedBy: row.detectedBy,
      notes: row.notes ?? '',
      selfIsTextA,
    });
  }

  // Grouped by corpus, because "the Talmud says this too" is the useful shape of
  // the answer and a flat list of twelve loses it.
  const byCorpus = new Map<TextId, CitationMember[]>();
  for (const member of members) {
    const list = byCorpus.get(member.textId) ?? [];
    list.push(member);
    byCorpus.set(member.textId, list);
  }

  const groups: CitationGroup[] = [...byCorpus.entries()]
    .map(([textId, list]) => ({ textId, count: list.length, members: list }))
    // Most-cited corpus first, then strongest single match as the tiebreak.
    .sort((a, b) => b.count - a.count || (b.members[0]?.strength ?? 0) - (a.members[0]?.strength ?? 0));

  return {
    passageKey: self.passageKey,
    textId: self.textId as TextId,
    total: members.length,
    groups,
  };
}
