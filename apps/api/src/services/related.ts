/**
 * Everything on the site that relates to one passage, in one ranked list.
 *
 * The three relation kinds live in three places and answer a third of the
 * question each. A passage page has a citations section (verbatim matches only),
 * a cross-reference list (Jev's relations only), and a journey (shared themes
 * only). None of them answers "what else here is about this verse", and a reader
 * has to know which section holds what they want.
 *
 * This merges them. The value is not the list — the data already existed — it is
 * that each row now says *how* it relates, which is the thing the app's central
 * claim rests on. A verbatim run of eleven words and a shared theme are not the
 * same kind of finding, and putting them in one ranked column without a label
 * would be exactly the conflation the rest of the product avoids.
 *
 * Kind precedence, which is also the display order:
 *
 *   1. verbatim  — a run of six or more identical words across corpora. Arithmetic
 *                  over a fixed set of texts, so it is checkable by the reader and
 *                  the strongest claim available.
 *   2. relation  — Jev's judgement: an allusion, a shared theme, a quotation. A
 *                  model's opinion, labelled as one.
 *   3. theme     — the same theme tag on both passages. A keyword classifier's
 *                  opinion, and the weakest of the three.
 *
 * Capped per kind, because without a cap the strongest signal simply fills the
 * panel: a passage in a well-cited book returns twelve citations and the reader
 * learns nothing about the other two kinds. A cap also stops the list from
 * telling one story three times.
 */

import { prisma } from './passage';
import type { TextId } from '@ilm/shared';

/** Per kind. Total is roughly one screen. */
const CAPS = { verbatim: 6, relation: 4, theme: 6 } as const;

/** Model relation types, which are judgements rather than arithmetic. */
const MODEL_TYPES = [
  'quote',
  'allusion',
  'thematic',
  'linguistic',
  'narrative',
  'theological',
  'historical',
] as const;

const PASSAGE_SELECT = {
  // `id` is needed to recognise a self-edge when a pair is read from both
  // directions. It is selected and used, never returned.
  id: true,
  passageKey: true,
  textId: true,
  bookSlug: true,
  chapterNum: true,
  verseNum: true,
  primaryTranslation: true,
  language: true,
  originalText: true,
} as const;

export type RelatedKind = 'verbatim' | 'relation' | 'theme';

export interface RelatedPassage {
  passageKey: string;
  textId: TextId;
  book: string;
  chapter: number;
  verse: number;
  preview: string;
  originalText: string;
  language: string;
  kind: RelatedKind;
  /** The specific relation, when the kind admits more than one. */
  relation: string;
  /** 0-1. Never compare across kinds: a verbatim 0.6 and a thematic 0.6 are not the same number. */
  strength: number;
  /** Where this judgement came from, which is not always the same as the kind. */
  source: string;
  /** For a verbatim match, the words both passages contain. */
  sharedText?: string;
  /** For a theme match, the theme both carry. */
  sharedTheme?: string;
}

export interface RelatedPassages {
  passageKey: string;
  /** True when the passage has no related passages at all, which is most of them. */
  empty: boolean;
  byKind: Record<RelatedKind, RelatedPassage[]>;
}

interface Segment {
  textA: string;
  textB: string;
  length: number;
}

export async function getRelatedPassages(
  passageId: string,
  options: { limit?: number } = {}
): Promise<RelatedPassages> {
  const self = await prisma.passage.findUnique({ where: { id: passageId }, select: PASSAGE_SELECT });
  if (!self) return { passageKey: '', empty: true, byKind: { verbatim: [], relation: [], theme: [] } };

  const empty: RelatedPassages = {
    passageKey: self.passageKey,
    empty: true,
    byKind: { verbatim: [], relation: [], theme: [] },
  };

  const selfThemes = await prisma.passageTheme.findMany({
    where: { passageId },
    select: { themeId: true },
  });
  const themeIds = selfThemes.map((t) => t.themeId);

  /*
   * One query for both edge families.
   *
   * `parallel` and `duplicate` are excluded: a corpus repeating itself, and the
   * same verse present in two collections. Both are real matches and neither is a
   * relation between traditions, and there are 44,420 of the former.
   */
  const edges = await prisma.crossReference.findMany({
    where: {
      OR: [{ sourcePassageId: passageId }, { targetPassageId: passageId }],
      NOT: { type: { in: ['parallel', 'duplicate'] } },
    },
    orderBy: { strength: 'desc' },
    // Enough to fill the two caps after the verbatim rows are taken out.
    take: 40,
    include: { sourcePassage: { select: PASSAGE_SELECT }, targetPassage: { select: PASSAGE_SELECT } },
  });

  const verbatim: RelatedPassage[] = [];
  const relation: RelatedPassage[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    const selfIsSource = edge.sourcePassageId === passageId;
    const other = selfIsSource ? edge.targetPassage : edge.sourcePassage;
    if (other.id === self.id) continue;
    // A pair can be a verbatim match *and* carry a model relation. The verbatim
    // claim is the stronger one, so it wins and the pair appears once.
    if (seen.has(other.passageKey)) continue;

    const base = {
      passageKey: other.passageKey,
      textId: other.textId as TextId,
      book: other.bookSlug,
      chapter: other.chapterNum,
      verse: other.verseNum,
      preview: other.primaryTranslation.slice(0, 240),
      originalText: other.originalText ?? '',
      language: other.language,
      strength: edge.strength,
      source: edge.detectedBy ?? 'jev',
    };

    if (edge.type === 'quotation' && edge.detectedBy === 'ngram') {
      const segments = (edge.matchedSegments as unknown as Segment[] | null) ?? [];
      if (segments.length === 0) continue;
      const selfIsTextA = selfIsSource;
      seen.add(other.passageKey);
      verbatim.push({
        ...base,
        kind: 'verbatim',
        relation: 'quotation',
        sharedText: selfIsTextA ? segments[0].textA : segments[0].textB,
      });
      continue;
    }

    if ((MODEL_TYPES as readonly string[]).includes(edge.type)) {
      seen.add(other.passageKey);
      relation.push({ ...base, kind: 'relation', relation: edge.type });
    }
  }

  /*
   * Shared themes, from passages in *other* corpora.
   *
   * A same-corpus neighbour sharing a theme is usually the adjacent verse, which
   * is not a relation between texts and reads as padding.
   */
  const theme: RelatedPassage[] = [];
  if (themeIds.length > 0) {
    const themeRows = await prisma.passageTheme.findMany({
      where: {
        themeId: { in: themeIds },
        passage: { id: { not: passageId }, textId: { not: self.textId } },
      },
      orderBy: { score: 'desc' },
      // Enough to choose a diverse handful per theme rather than eight verses of
      // one chapter, which is what the top-N-by-score returns.
      take: themeIds.length * 40,
      include: { passage: { select: PASSAGE_SELECT } },
    });

    const bestPerBook = new Map<string, { row: (typeof themeRows)[number]; shared: string }>();
    for (const row of themeRows) {
      const key = `${row.passage.textId}:${row.passage.bookSlug}`;
      const current = bestPerBook.get(key);
      if (!current || row.score > current.row.score) {
        bestPerBook.set(key, { row, shared: row.themeId });
      }
    }

    // Other corpora first, strongest first within that.
    for (const { row, shared } of [...bestPerBook.values()]
      .sort((a, b) => b.row.score - a.row.score)
      .slice(0, CAPS.theme * 3)) {
        if (theme.length >= CAPS.theme) break;
        if (seen.has(row.passage.passageKey)) continue;
        seen.add(row.passage.passageKey);
        theme.push({
          passageKey: row.passage.passageKey,
          textId: row.passage.textId as TextId,
          book: row.passage.bookSlug,
          chapter: row.passage.chapterNum,
          verse: row.passage.verseNum,
          preview: row.passage.primaryTranslation.slice(0, 240),
          originalText: row.passage.originalText ?? '',
          language: row.passage.language,
          kind: 'theme',
          relation: 'shared_theme',
          strength: row.score,
          // Every theme in this app is currently the local keyword classifier, and
          // saying so on the row is the difference between a tag and a judgement.
          source: row.source ?? 'derived',
          sharedTheme: shared,
        });
      }
  }

  const limit = options.limit;
  const capped = {
    verbatim: limit ? verbatim.slice(0, limit) : verbatim.slice(0, CAPS.verbatim),
    relation: limit ? relation.slice(0, limit) : relation.slice(0, CAPS.relation),
    theme,
  };

  return {
    passageKey: self.passageKey,
    empty: capped.verbatim.length + capped.relation.length + capped.theme.length === 0,
    byKind: capped,
  };
}
