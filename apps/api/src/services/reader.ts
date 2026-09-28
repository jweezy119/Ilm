/**
 * Reading a book, rather than searching it.
 *
 * Search answers questions. Reading is the other half of the job, and it was
 * missing: there was a way to see one passage and a way to find passages, and no
 * way to open a book and read it through with its chapter structure, its verse
 * numbers, and a translation of your choosing.
 *
 * One chapter per request, deliberately. The largest book in the corpus is a
 * thousand-odd verses and Psalms is three thousand; a whole book in one response
 * is a few hundred kilobytes of text the reader cannot see yet, and it makes the
 * common case — turning a page — as slow as the rare one. The chapter list comes
 * back with it so navigation does not need a second call.
 *
 * Translations are English for every text in the corpus, which is what a reader
 * arriving at an Aramaic or Hebrew scripture actually wants, and the originals are
 * returned alongside when there is one, so a verse can be read in the language it
 * was written in without leaving the page. The same principles in AGENTS.md apply:
 * boundary-matched words, no guessing at a rendering, and the original named as the
 * source rather than presented as an interpretation.
 */
import { prisma } from '../lib/db';
import { getBooks, getPassagesByChapter } from './passage';
import type { Passage, TextId } from '@ilm/shared';

export interface ReaderTranslation {
  id: string;
  name: string;
  translator: string | null;
  year: number | null;
  isPrimary: boolean;
}

export interface ReaderVerse {
  passageKey: string;
  chapter: number;
  verse: number;
  /** The English translation, which is what this endpoint is for. */
  text: string;
  /** The verse as written in the source language, when the corpus has one. */
  originalText: string;
  language: string;
  translationId: string;
  translationName: string;
  themes: string[];
}

export interface ReaderChapterSummary {
  chapter: number;
  verseCount: number;
}

export interface BookReading {
  textId: TextId;
  bookId: string;
  bookName: string;
  bookNameOriginal: string | null;
  chapterCount: number;
  verseCount: number;
  /** Neighbours in the corpus's own order, so a reader can turn the page. */
  previous: { bookId: string; name: string } | null;
  next: { bookId: string; name: string } | null;
  chapters: ReaderChapterSummary[];
  translations: ReaderTranslation[];
  translationId: string;
  chapter: number;
  verses: ReaderVerse[];
}

/** English translations available for a text, primary first. */
export async function getReaderTranslations(textId: TextId): Promise<ReaderTranslation[]> {
  const rows = await prisma.translation.findMany({
    where: { textId, language: 'english' },
    select: { id: true, name: true, translator: true, year: true, isPrimary: true },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
  });
  return rows;
}

/**
 * One chapter of a book, in a chosen English translation.
 *
 * `translationId` is honoured when that translation covers the book and quietly
 * falls back to the primary when it does not. Falling back beats erroring: a
 * reader who picks Koren and opens the Psalms has asked for English, and refusing
 * because one psalm is missing would be pedantry. Which translation was actually
 * used comes back in the response, so the switcher can say so rather than the
 * reader assuming.
 */
export async function getBookReading(
  textId: TextId,
  bookId: string,
  options: { chapter?: number; translationId?: string } = {}
): Promise<BookReading | null> {
  const book = await prisma.book.findUnique({
    where: { textId_bookId: { textId, bookId } },
    select: {
      bookId: true, name: true, nameOriginal: true, chapterCount: true, verseCount: true, order: true,
    },
  });
  if (!book) return null;

  const translations = await getReaderTranslations(textId);
  if (translations.length === 0) return null;

  const requested = options.translationId
    ? translations.find((t) => t.id === options.translationId)
    : undefined;
  const chosen = requested ?? translations[0];

  const chapter = clampChapter(options.chapter ?? 1, book.chapterCount);

  /*
   * Through the existing loader, not a bespoke query.
   *
   * `getPassagesByChapter` already assembles a passage the way the whole app
   * expects — primary English text, the other translations, the source language,
   * scored themes — so a second implementation would be a second definition of
   * what a passage is, and the two would drift the first time a field was added.
   */
  /*
   * Looked up by bookId, not by name.
   *
   * For four of the five corpora the two happen to be the same string, so the
   * distinction only shows up on the Quran — where a surah's name is "Al-Fatihah"
   * and its slug is "1" — and there it silently returned an empty chapter, which
   * looks exactly like a book with no English translation. Keying on bookId works
   * for all five and cannot go stale when a name is corrected.
   */
  const passages = await getPassagesByChapter(textId, book.bookId, chapter);

  const chapterCounts = await prisma.passage.groupBy({
    by: ['chapterNum'],
    where: { textId, bookSlug: book.bookId },
    _count: { _all: true },
    orderBy: { chapterNum: 'asc' },
  });
  const chapters: ReaderChapterSummary[] = chapterCounts.map((c) => ({
    chapter: c.chapterNum,
    verseCount: c._count._all,
  }));

  /*
   * The chosen translation, per verse, falling back to the primary.
   *
   * Per verse rather than per book: a reader who picks Koren and opens the Psalms
   * has asked for English, and losing the whole chapter because one psalm is
   * missing from that edition would be pedantry. Which translation each verse
   * actually used comes back with it, so the switcher can say so instead of the
   * reader assuming.
   */
  const verses: ReaderVerse[] = passages.map((passage: Passage) => {
    const alternative = passage.alternativeTranslations.find((t) => t.id === chosen.id);
    const useAlternative = Boolean(alternative) && !chosen.isPrimary;
    return {
      passageKey: passage.passageKey,
      chapter: passage.chapter,
      verse: passage.verse,
      text: useAlternative ? alternative!.text : passage.translation,
      originalText: passage.originalText,
      language: passage.metadata.language,
      translationId: useAlternative ? alternative!.id : chosen.id,
      translationName: useAlternative ? alternative!.translator : (passage.primaryTranslationName ?? chosen.translator ?? chosen.name),
      themes: passage.themes.map((t) => t.theme),
    };
  });

  // Neighbours by corpus order. `order` is per text and contiguous, so this is the
  // only way to know whether the Psalms follow Samuel, and it is what a reader
  // means by "the book after this one".
  const sibling = await prisma.book.findFirst({
    where: { textId, order: { lt: book.order } },
    orderBy: { order: 'desc' },
    select: { bookId: true, name: true },
  });
  const onward = await prisma.book.findFirst({
    where: { textId, order: { gt: book.order } },
    orderBy: { order: 'asc' },
    select: { bookId: true, name: true },
  });

  return {
    textId,
    bookId,
    bookName: book.name,
    bookNameOriginal: book.nameOriginal,
    chapterCount: book.chapterCount || chapters.length,
    verseCount: book.verseCount,
    previous: sibling ? { bookId: sibling.bookId, name: sibling.name } : null,
    next: onward ? { bookId: onward.bookId, name: onward.name } : null,
    chapters,
    translations,
    translationId: chosen.id,
    chapter,
    verses,
  };
}

/**
 * Books a text has, with enough detail to choose one.
 *
 * Wraps the existing book list rather than adding a second source of truth, so a
 * newly ingested book appears here without a code change.
 */
export async function getReaderBooks(textId: TextId) {
  return getBooks(textId);
}

/** Re-exported so the route can answer a chapter request without a second import. */
export { getPassagesByChapter };

/**
 * Search within one book.
 *
 * The corpus search already filters by book slug, so this is a thin, validating
 * wrapper: its job is to reject a book that does not exist in this text rather than
 * return nothing, because "no results" and "no such book" are different answers
 * and a reader who typed the wrong name deserves to be told.
 */
export async function resolveBookSlug(textId: TextId, bookId: string): Promise<string | null> {
  const book = await prisma.book.findUnique({
    where: { textId_bookId: { textId, bookId } },
    select: { name: true },
  });
  return book?.name ?? null;
}

function clampChapter(chapter: number, chapterCount: number): number {
  const max = chapterCount > 0 ? chapterCount : 1;
  if (!Number.isFinite(chapter)) return 1;
  return Math.min(max, Math.max(1, Math.floor(chapter)));
}
