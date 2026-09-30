/**
 * Compare how one theme is carried across the traditions.
 *
 * The feature is retrieval, not summary. For a theme, the passages each corpus
 * holds on it, side by side, with their references and their original text. No
 * prose, no "this tradition teaches", no summary of what the passages mean. The
 * comparison is the texts next to each other; the reader does the rest, which is
 * the whole proposition of this product and the only version of it that survives
 * being wrong about a tradition.
 *
 * What makes it different from a search across five corpora is the framing: one
 * subject, one row per tradition, so a difference is visible by looking rather than
 * inferred from ranked results.
 *
 * The threshold is the load-bearing part, and it is returned rather than hidden.
 *
 * A theme score is a classifier's opinion, not a fact about the corpus. At the bar
 * below it, every column is strong; above it, columns appear that the evidence does
 * not support, and a comparison page presents a weak column as though it were a
 * considered selection. Measured across all 79 themes and seven corpora, at 0.20
 * some 61 of 79 themes fill at least five columns and only 7 fall below three.
 *
 * The honesty constraint that shapes the whole response: a corpus with no passage
 * above the bar is reported as *not labelled*, never as silent. "No passage in the
 * Talmud is tagged for this theme strongly enough to show" is a claim about a
 * classifier. "The Talmud does not discuss justice" is a claim about a tradition,
 * and nothing here supports it. The two are different sentences and only the first
 * is true.
 */

import { prisma } from '../lib/db';
import { TEXT_METADATA, THEME_TAXONOMY, type TextId } from '@ilm/shared';

export const DEFAULT_COMPARE_BAR = 0.2;

/** How many passages per column. */
const PER_COLUMN = 4;

/**
 * Below this many passages a column is not shown at all.
 *
 * Two or three passages is not a comparison, it is an anecdote, and showing one
 * beside six would imply the six and the two are equally represented.
 */
const MIN_PER_COLUMN = 5;

/** Columns in taxonomy order, so a page reads consistently between themes. */
const COLUMN_ORDER: TextId[] = [
  'torah',
  'ot',
  'talmud',
  'nt',
  'quran',
  'bukhari',
  'muslim',
];

export interface CompareColumn {
  textId: TextId;
  name: string;
  direction: 'rtl' | 'ltr';
  /** Passages above the bar in this corpus, before the per-column cap. */
  total: number;
  /** Passages above the bar. Empty when the corpus fell below it. */
  passages: Array<{
    passageKey: string;
    book: string;
    chapter: number;
    verse: number;
    text: string;
    originalText: string;
    language: string;
    /** This passage's score for the theme, which is the column's own evidence. */
    score: number;
    /** Whether a model judged it or the local classifier did. */
    source: string;
  }>;
}

export interface ThemeComparison {
  theme: string;
  label: string;
  /** The bar used, so the page can state it rather than implying a fixed one. */
  bar: number;
  /** Passages above the bar per corpus, before the per-column cap. */
  total: number;
  columns: CompareColumn[];
  /**
   * Corpora with nothing above the bar, and why they are absent.
   *
   * Named explicitly because a missing column on a comparison page reads as a
   * silence, and it is not one.
   */
  absent: Array<{ textId: TextId; name: string }>;
  /** How many corpora were searched at all. */
  corporaSearched: number;
  /**
   * The distinct scores this bar actually admits, ascending.
   *
   * Theme scores take twenty distinct values and cluster hard — 24,332 labels sit
   * at exactly 0.20 and 31,125 at 0.15, with little in between. So the bar is a set
   * of steps, not a dial: moving it from 0.21 to 0.24 changes nothing at all, and
   * a reader dragging a slider would conclude it was broken.
   *
   * Returning the levels lets the page say "passages scoring 0.24 or above" instead
   * of showing a decimal that implies a precision the data does not have.
   */
  scoreLevels: number[];
}

/** Valid themes, from the taxonomy the rest of the app uses. */
export function isKnownTheme(theme: string): boolean {
  return (THEME_TAXONOMY as readonly string[]).includes(theme);
}

export async function compareTheme(
  theme: string,
  options: { bar?: number; texts?: TextId[]; perColumn?: number } = {}
): Promise<ThemeComparison> {
  const bar = options.bar ?? DEFAULT_COMPARE_BAR;
  const perColumn = options.perColumn ?? PER_COLUMN;
  const wanted = options.texts?.length ? options.texts : COLUMN_ORDER;
  const searched = COLUMN_ORDER.filter((id) => wanted.includes(id));

  const rows = await prisma.passageTheme.findMany({
    where: { themeId: theme, score: { gte: bar } },
    select: {
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
          originalText: true,
          language: true,
          verseOrder: true,
        },
      },
    },
  });

  // Grouped in memory rather than by a window function per corpus.
  //
  // The per-corpus top-N is what `row_number() over (partition by text_id)` is for,
  // but that returns a row number Prisma does not model, so it would be a raw
  // query with a hand-written row mapping — and the shape it maps onto is the
  // same as this group-by. The set is a few hundred rows for any theme.
  const grouped = new Map<TextId, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.passage.textId as TextId) ?? [];
    list.push(row);
    grouped.set(row.passage.textId as TextId, list);
  }

  const columns: CompareColumn[] = [];
  const absent: Array<{ textId: TextId; name: string }> = [];

  for (const textId of searched) {
    const list = grouped.get(textId) ?? [];
    const meta = TEXT_METADATA[textId];

    if (list.length < MIN_PER_COLUMN) {
      absent.push({ textId, name: meta.name });
      continue;
    }

    // Strongest first, then canonical order within the corpus, so two passages with
    // the same score come out in the order the text presents them rather than
    // whatever order the database returned.
    const ordered = [...list].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.passage.verseOrder ?? 0) - (b.passage.verseOrder ?? 0);
    });

    columns.push({
      textId,
      name: meta.name,
      direction: meta.direction,
      total: ordered.length,
      passages: ordered.slice(0, perColumn).map((row) => ({
        passageKey: row.passage.passageKey,
        book: row.passage.bookSlug,
        chapter: row.passage.chapterNum,
        verse: row.passage.verseNum,
        text: row.passage.primaryTranslation,
        originalText: row.passage.originalText,
        language: row.passage.language,
        score: row.score,
        source: row.source,
      })),
    });
  }

  return {
    theme,
    label: theme.replace(/_/g, ' '),
    bar,
    total: rows.length,
    columns,
    absent,
    corporaSearched: searched.length,
    scoreLevels: [...new Set(rows.map((r) => Math.round(r.score * 100) / 100))].sort((a, b) => a - b),
  };
}