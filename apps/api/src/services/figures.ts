/**
 * A figure named across traditions.
 *
 * The relation between Isa in the Quran and Jesus in the Gospels is not one this
 * product gets to assert. The Quran asserts it: at 3:45 and 4:171 it names Isa as
 * "the Messiah, Jesus the son of Mary". So the basis is two passages in the corpus
 * and the page links them, and what this returns is a name — where the figure is
 * called something, in which form, and how much of each corpus carries the name.
 *
 * What it deliberately does not do is infer identity from a name match. A mention is
 * a mention because a passage contains one of the forms and nothing else. The
 * difference is not pedantry: searching the Hebrew for the Talmudic form returns 121
 * Old Testament passages, and every one of them is Joshua son of Jozadak, the high
 * priest who returned from Babylon, spelled identically. A relation built on the
 * name alone would have linked Jesus of Nazareth to a Levitical priest of the Persian
 * period and looked entirely reasonable while doing it.
 *
 * The counts are reported with their unit, because the corpora are not measured the
 * same way and printing the numbers side by side without it invents a comparison.
 * The Quran corpus holds one passage per surah and the New Testament one per verse,
 * so "26" and "963" count different things and the page must not imply otherwise.
 */

import { prisma } from '../lib/db';
import { TEXT_METADATA, type TextId } from '@ilm/shared';

/** How many passages to show per corpus. */
const SAMPLE = 4;

export interface FigureCorpus {
  textId: TextId;
  name: string;
  direction: 'rtl' | 'ltr';
  /**
   * How this corpus is divided, because the counts are not comparable without it.
   * 'surah' for the Quran, 'verse' for the rest.
   */
  unit: string;
  mentions: number;
  /** The surface forms this corpus uses, which is most of what is interesting. */
  forms: string[];
  stance: string;
  sample: Array<{ passageKey: string; book: string; chapter: number; verse: number; text: string }>;
}

export interface FigureDetail {
  slug: string;
  name: string;
  basis: {
    identification?: string;
    passageKeys?: string[];
    excluded?: { corpora: string[]; reasons?: Record<string, string> };
  };
  corpora: FigureCorpus[];
  /** Corpora deliberately not shown, with the reason for each. */
  absent: Array<{ textId: string; name: string; reason: string }>;
  totalMentions: number;
}

/** The unit a corpus is counted in. The Quran is ingested one passage per surah. */
function unitFor(textId: TextId): string {
  return textId === 'quran' ? 'surah' : 'verse';
}

export async function getFigure(slug: string, limit = SAMPLE): Promise<FigureDetail | null> {
  const figure = await prisma.figure.findUnique({ where: { slug } });
  if (!figure) return null;

  const mentions = await prisma.figureMention.findMany({
    where: { figureId: figure.id },
    select: {
      form: true,
      stance: true,
      passage: {
        select: {
          passageKey: true,
          textId: true,
          bookSlug: true,
          chapterNum: true,
          verseNum: true,
          primaryTranslation: true,
        },
      },
    },
  });

  const byCorpus = new Map<TextId, typeof mentions>();
  for (const m of mentions) {
    const key = m.passage.textId as TextId;
    const list = byCorpus.get(key) ?? [];
    list.push(m);
    byCorpus.set(key, list);
  }

  // Corpus order is the reading order of the product: scripture, then traditions
  // commenting on it, so the columns do not reshuffle between figures.
  const order: TextId[] = ['torah', 'ot', 'talmud', 'nt', 'quran', 'bukhari', 'muslim'];
  const corpora: FigureCorpus[] = [];

  for (const textId of order) {
    const list = byCorpus.get(textId);
    if (!list || list.length === 0) continue;
    const meta = TEXT_METADATA[textId];

    corpora.push({
      textId,
      name: meta.name,
      direction: meta.direction,
      unit: unitFor(textId),
      mentions: list.length,
      forms: [...new Set(list.map((m) => m.form))],
      stance: list[0].stance,
      sample: list.slice(0, limit).map((m) => ({
        passageKey: m.passage.passageKey,
        book: m.passage.bookSlug,
        chapter: m.passage.chapterNum,
        verse: m.passage.verseNum,
        text: m.passage.primaryTranslation,
      })),
    });
  }

  // Everything we hold that has no mention, with the recorded reason. Never a bare
  // gap: an absent column on this page would read as a silence in the tradition.
  const excluded = figure.basis as { excluded?: { corpora?: string[]; reasons?: Record<string, string> } };
  const reasons = excluded.excluded?.reasons ?? {};
  const present = new Set(corpora.map((c) => c.textId));
  const absent = (excluded.excluded?.corpora ?? [])
    .filter((id) => !present.has(id as TextId))
    .map((id) => ({
      textId: id,
      name: TEXT_METADATA[id as TextId]?.name ?? id,
      reason: reasons[id] ?? 'No mention recorded in this corpus.',
    }));

  return {
    slug: figure.slug,
    name: figure.name,
    basis: figure.basis as FigureDetail['basis'],
    corpora,
    absent,
    totalMentions: mentions.length,
  };
}

/**
 * The figures a passage names.
 *
 * So the passage page can offer the relation from where a reader meets the figure,
 * rather than only from a figure index they have to know exists.
 */
export async function getFiguresForPassage(passageId: string): Promise<
  Array<{ slug: string; name: string; form: string; stance: string }>
> {
  const rows = await prisma.figureMention.findMany({
    where: { passageId },
    select: { form: true, stance: true, figure: { select: { slug: true, name: true } } },
  });
  return rows.map((r) => ({
    slug: r.figure.slug,
    name: r.figure.name,
    form: r.form,
    stance: r.stance,
  }));
}
