/**
 * Themed journey from a single passage.
 *
 * The passage page lists cross-references: passages detected as quoting,
 * alluding to, or paralleling this one. That list is bounded at eight and flat,
 * so it answers "what links to this verse" and nothing else. It cannot answer
 * "what is this verse about, and where else do the texts say that", which is the
 * question a reader following a thread actually has.
 *
 * This answers that one. It takes the themes the passage carries and, for each,
 * collects the other passages carrying the same theme — so a group is a context,
 * and the members of a group are routinely from different corpora. Reading the
 * groups in order is a walk outward from one verse through its subject.
 *
 * Two deliberate constraints:
 *
 * - No prose. A group is labelled with a theme id, which is a row in the themes
 *   table, and every member carries its own score and source. The same rule as
 *   the rest of the app: no generated commentary, only the texts and the numbers.
 * - The source is always the passage itself. A journey that quietly substituted
 *   a better-scoring verse for the one you were reading would be a different
 *   product.
 */

import { prisma } from './passage';
import type { Passage, TextId } from '@ilm/shared';

/** Corpus order, which is also roughly chronological within each tradition. */
const CORPUS_ORDER: TextId[] = ['torah', 'ot', 'nt', 'quran', 'talmud'];

/** Themes carried by the source passage are considered strongest-first. */
const MAX_GROUPS = 6;

/**
 * Passages per group.
 *
 * Large enough that a group spans more than one book, small enough that the page
 * is still a page. Cross-references are capped at 8 for the same reason.
 */
const PER_GROUP = 8;

/** Exported so the route can default `?limit=` to the same number the service uses. */
export const DEFAULT_PER_GROUP = PER_GROUP;

/** How many themes of the source to look at. */
const MAX_THEMES = 5;

export interface JourneyMember {
  passageKey: string;
  textId: TextId;
  book: string;
  chapter: number;
  verse: number;
  preview: string;
  /** The member's own confidence on this theme, 0-1. Not the source's. */
  score: number;
  /** Position within the member's corpus, for ordering inside a group. */
  chronologicalOrder: number;
  /** How the passage was tagged with this theme. */
  source: string;
}

export interface JourneyGroup {
  theme: string;
  category: string | null;
  /** How strongly the passage being read carries this theme. Orders the groups. */
  sourceScore: number;
  members: JourneyMember[];
  /** Distinct corpora represented, which is what makes a group worth reading. */
  corpora: TextId[];
  books: string[];
  /**
   * True when the group spans more than one corpus. A group that does not is the
   * same book agreeing with itself, which is a weaker thing to have found and is
   * labelled as such rather than passed off as a connection.
   */
  crossText: boolean;
}

export interface PassageJourney {
  passageKey: string;
  textId: TextId;
  book: string;
  chapter: number;
  verse: number;
  groups: JourneyGroup[];
}

function corpusRank(textId: TextId): number {
  const index = CORPUS_ORDER.indexOf(textId);
  return index === -1 ? CORPUS_ORDER.length : index;
}

/**
 * Pick members so a group shows breadth before depth.
 *
 * Taking the top N by score returns whichever single book happens to score
 * highest, often eight verses from the same chapter, and the group then looks
 * like corroboration when it is one passage repeated. Taking the best from each
 * distinct book first, then filling by score, keeps the group a cross-text
 * sample — which is the thing that makes it a journey rather than a list.
 */
function selectMembers(
  members: JourneyMember[],
  limit: number,
  sourceTextId: TextId
): JourneyMember[] {
  const bestPerBook = new Map<string, JourneyMember>();
  for (const member of members) {
    const key = `${member.textId}:${member.book}`;
    const current = bestPerBook.get(key);
    if (!current || member.score > current.score) bestPerBook.set(key, member);
  }

  // A book the reader is already in is the least interesting thing to add, so it
  // goes last rather than being dropped — the source corpus is still part of the
  // journey, just not the first thing shown.
  const unique = [...bestPerBook.values()].sort((a, b) => {
    const sameText = (m: JourneyMember) => (m.textId === sourceTextId ? 1 : 0);
    return sameText(a) - sameText(b) || b.score - a.score;
  });

  const chosen = unique.slice(0, limit);
  if (chosen.length < limit) {
    const taken = new Set(chosen.map((m) => m.passageKey));
    const filler = members
      .filter((m) => !taken.has(m.passageKey))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit - chosen.length);
    chosen.push(...filler);
  }

  return chosen.sort(
    (a, b) => corpusRank(a.textId) - corpusRank(b.textId) || a.chronologicalOrder - b.chronologicalOrder
  );
}

export async function getPassageJourney(
  passage: Passage,
  options: { limit?: number; texts?: TextId[] } = {}
): Promise<PassageJourney> {
  const perGroup = options.limit ?? PER_GROUP;
  const targetTexts = (options.texts?.length ? options.texts : CORPUS_ORDER) as TextId[];

  const sourceThemes = [...(passage.themes ?? [])]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_THEMES);

  const header = {
    passageKey: passage.passageKey,
    textId: passage.textId as TextId,
    book: passage.book,
    chapter: passage.chapter,
    verse: passage.verse,
  };

  if (sourceThemes.length === 0) return { ...header, groups: [] };

  const themeIds = sourceThemes.map((t) => t.theme);

  // One query for every theme, rather than one per theme. A journey with five
  // groups is the same shape as a search: it should not be five round trips.
  const rows = await prisma.passageTheme.findMany({
    where: {
      themeId: { in: themeIds },
      passage: { textId: { in: targetTexts }, passageKey: { not: passage.passageKey } },
    },
    // Selected, not included.
    //
    // `include: { passage: true }` pulls every column of every matched passage,
    // which now means the original-language text and the embedding vector — a
    // 1,024-float array per row. At a few hundred rows that dominated the query
    // and put a journey at over two seconds. Only the preview is needed, and only
    // 240 characters of it.
    select: {
      themeId: true,
      score: true,
      source: true,
      passage: {
        select: {
          passageKey: true,
          textId: true,
          bookSlug: true,
          chapterNum: true,
          verseNum: true,
          primaryTranslation: true,
          verseOrder: true,
        },
      },
    },
    orderBy: { score: 'desc' },
    // Enough to choose a diverse handful per theme without holding the corpus.
    take: themeIds.length * 120,
  });

  const categories = await prisma.theme.findMany({
    where: { name: { in: themeIds } },
    select: { name: true, category: true },
  });
  const categoryByTheme = new Map(categories.map((t) => [t.name, t.category ?? null]));

  const byTheme = new Map<string, JourneyMember[]>();
  for (const row of rows) {
    if (!byTheme.has(row.themeId)) byTheme.set(row.themeId, []);
    byTheme.get(row.themeId)!.push({
      passageKey: row.passage.passageKey,
      textId: row.passage.textId as TextId,
      book: row.passage.bookSlug,
      chapter: row.passage.chapterNum,
      verse: row.passage.verseNum,
      preview: row.passage.primaryTranslation.slice(0, 240),
      score: row.score,
      chronologicalOrder: row.passage.verseOrder,
      source: row.source,
    });
  }

  const groups: JourneyGroup[] = [];

  for (const theme of sourceThemes) {
    const candidates = byTheme.get(theme.theme);
    if (!candidates || candidates.length === 0) continue;

    const members = selectMembers(candidates, perGroup, passage.textId as TextId);
    if (members.length === 0) continue;

    const corpora = [...new Set(members.map((m) => m.textId))];

    groups.push({
      theme: theme.theme,
      category: categoryByTheme.get(theme.theme) ?? null,
      sourceScore: theme.score,
      members,
      corpora,
      books: [...new Set(members.map((m) => `${m.textId}:${m.book}`))],
      crossText: corpora.length > 1,
    });
  }

  // Strongest theme on the source passage first, and the group that reaches
  // furthest across corpora breaks a tie. The reader came from this verse, so the
  // order should follow how much the verse itself is about each thing.
  groups.sort((a, b) => b.sourceScore - a.sourceScore || b.corpora.length - a.corpora.length);

  return { ...header, groups };
}
