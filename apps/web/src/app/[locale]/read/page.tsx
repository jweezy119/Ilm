'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Languages,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { getTextLabel, getLanguageDirection, getScriptFont, TEXT_IDS, cn } from '@/lib/utils';
import { useTextBooks } from '@/lib/useTextBooks';
import { useInBookSearch } from '@/lib/useInBookSearch';
import { Page } from '@/components/Shell';
import type { BookMetadata, TextId } from '@ilm/shared';

/**
 * Reading a book, and searching inside it.
 *
 * Two jobs that the app could do separately and did not do at all: opening a book
 * and reading it through, and asking a question of one book rather than all five
 * corpora. They live on one page because a reader who is working through a chapter
 * and a reader who is hunting a phrase inside it are doing the same thing, and
 * making them switch pages to change their mind is a tax for no benefit.
 *
 * One chapter at a time. A whole book in one response is a few hundred kilobytes
 * the reader cannot see yet, and it makes turning a page as slow as opening the
 * Psalms.
 */
function ReadInner() {
  const router = useRouter();
  const params = useSearchParams();

  const textId = (params.get('text') ?? 'quran') as TextId;
  const bookId = params.get('book');
  const chapter = Number(params.get('chapter') ?? '1') || 1;
  const translation = params.get('translation') ?? undefined;

  const [query, setQuery] = useState('');
  const [showOriginal, setShowOriginal] = useState(true);
  const [searching, setSearching] = useState(false);
  const { books, loading: booksLoading } = useTextBooks(textId);
  const { results, run, clear, searching: inBookSearching } = useInBookSearch();

  const setParams = useCallback(
    (next: { book?: string | null; chapter?: number; translation?: string | null }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.book !== undefined) {
        if (next.book) sp.set('book', next.book);
        else sp.delete('book');
      }
      if (next.chapter !== undefined) sp.set('chapter', String(next.chapter));
      if (next.translation !== undefined) {
        if (next.translation) sp.set('translation', next.translation);
        else sp.delete('translation');
      }
      router.replace(`/read?${sp.toString()}`, { scroll: false });
    },
    [params, router]
  );

  /*
   * A book is always in hand, so the page is never empty.
   *
   * This used to be the first book or nothing at all: arriving at /read rendered
   * the book list and no scripture, with no message saying what to do, so the route
   * read as broken rather than as a picker. The Quran is 114 books, so what you got
   * was a wall of surah names ending abruptly at An-Nas.
   *
   * Falls back to the corpus's first book rather than writing it into the URL, so
   * the address still says what the reader actually chose, and an explicit choice
   * always wins.
   */
  const effectiveBookId = bookId ?? (books.length > 0 ? books[0].id : undefined);

  // Changing text invalidates the book, so a book id from another corpus would be
  // requested against this one and 404. Clearing it is the honest response.
  useEffect(() => {
    if (bookId && books.length > 0 && !books.some((b) => b.id === bookId)) setParams({ book: null });
  }, [books, bookId, setParams]);

  // The picker sits above the text, so on a book change the new chapter is below
  // the fold. router.replace passes scroll: false, which is right for a text swap
  // and wrong for a book swap: you click Al-Baqarah, the list of surah names stays
  // exactly where it was, and nothing appears to have happened.
  const scrollToText = useCallback(() => {
    requestAnimationFrame(() => {
      document.getElementById('reading-pane')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }, []);

  const pickBook = useCallback(
    (id: string) => {
      setParams({ book: id, chapter: 1 });
      scrollToText();
    },
    [setParams, scrollToText]
  );

  const goToChapter = useCallback(
    (delta: number) => {
      setParams({ chapter: Math.max(1, chapter + delta) });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [chapter, setParams]
  );

  /*
   * Switching corpus drops the book, and the chapter with it.
   *
   * This handler was inline at the one call site that had a book, so on arrival —
   * before any book was chosen — the corpus pills were rendered with no handler
   * wired to them and did nothing at all. The controls looked live because they were
   * buttons with the right styling, which is worse than their absence.
   */
  const onText = useCallback(
    (next: string) => {
      router.replace(`/read?text=${next}`, { scroll: false });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [router]
  );

  const onSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (!effectiveBookId || !query.trim()) return;
    setSearching(true);
    run(textId, effectiveBookId, query.trim());
    setSearching(false);
  };

  if (!effectiveBookId) {
    return (
      <Page>
        <BookPicker
          textId={textId}
          books={books}
          loading={booksLoading}
          onPick={pickBook}
          onText={onText}
        />
      </Page>
    );
  }

  return (
    <Page>
      <BookPicker
        textId={textId}
        bookId={effectiveBookId}
        books={books}
        loading={booksLoading}
        onPick={pickBook}
        onText={onText}
      />
      <div id="reading-pane">
      <ReadingPane
        textId={textId}
        bookId={effectiveBookId}
        chapter={chapter}
        translation={translation}
        showOriginal={showOriginal}
        onToggleOriginal={() => setShowOriginal((v) => !v)}
        onTranslation={(id) => setParams({ translation: id })}
        onChapter={(n) => setParams({ chapter: n })}
        onPrev={() => goToChapter(-1)}
        onNext={() => goToChapter(1)}
      />
      </div>

      {/* Search within this book, and only this book. */}
      <section className="mt-10 border-t border-line pt-6">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
          <Search className="h-4 w-4 text-fg-muted" /> Search inside this book
        </h2>
        <p className="mb-3 text-xs text-fg-muted">
          Scoped to this book only. The rest of the corpus stays out of it, so a
          result is an answer about the text you are reading rather than the nearest
          match anywhere.
        </p>
        <form onSubmit={onSearch} className="composer max-w-xl">
          <Search className="h-[18px] w-[18px] shrink-0 text-fg-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="A word or phrase in this book…"
            aria-label={`Search within this book`}
            className="composer-input"
          />
          {query ? (
            <button type="button" onClick={() => { setQuery(''); clear(); }} className="icon-btn h-7 w-7" aria-label="Clear">
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="submit"
            disabled={!query.trim() || inBookSearching}
            aria-label="Search in book"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {inBookSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          </button>
        </form>

        {searching && !results ? <p className="mt-4 text-sm text-fg-muted">Searching…</p> : null}

        {results ? (
          results.length === 0 ? (
            <p className="mt-4 text-sm text-fg-muted">Nothing in this book matches “{query.trim()}”.</p>
          ) : (
            <ul className="mt-5 max-w-2xl">
              {results.map((result) => {
                return (
                  <li key={result.passage.passageKey} className="result-row">
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="ref">
                        {result.passage.chapter}:{result.passage.verse}
                      </span>
                      <span className="text-xs text-fg-faint">
                        {result.passage.primaryTranslationName ?? 'English'}
                      </span>
                      {/* Safe to show here, unlike the corpus search: useInBookSearch
                          sends `semantic: false`, so the list is ordered by this
                          score and the number is the reason for its position.
                          Reading inside one book is a lookup, not a judgement. */}
                      {result.score !== undefined ? (
                        <span className="ms-auto font-mono text-[11px] text-fg-faint">
                          {Math.round(result.score * 100)}%
                        </span>
                      ) : null}
                    </div>
                    <p dir="ltr" className="text-[15px] leading-relaxed">
                      {highlight(result.passage.translation, query.trim())}
                    </p>
                    <Link
                      href={`/passage/${result.passage.passageKey.split('/').map(encodeURIComponent).join('/')}`}
                      className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      Open passage
                    </Link>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </section>
    </Page>
  );
}

/** The book rail and header: pick a corpus, pick a book. */
function BookPicker({
  textId,
  bookId,
  books,
  loading,
  onPick,
  onText,
}: {
  textId: TextId;
  bookId?: string;
  books: BookMetadata[];
  loading: boolean;
  onPick: (bookId: string) => void;
  onText?: (textId: string) => void;
}) {
  /*
   * A filter, only where the list is long enough to need one.
   *
   * The strip scrolls, which fixes the wall, but scrolling 114 surahs sideways on a
   * phone is its own wall: the finger goes across the screen many times and there is
   * nothing to aim at. The Quran is the only corpus where this matters — the others
   * are 5 to 39 books — so the field appears only there rather than adding a control
   * to a five-book picker, which is the friction this whole change set has been
   * about removing.
   *
   * Matches on the transliterated name and the Arabic, so typing either finds it.
   */
  const [filter, setFilter] = useState('');
  const needsFilter = books.length > 40;
  const needle = filter.trim().toLowerCase();
  const visible = !needle
    ? books
    : books.filter(
        (b) =>
          b.name.toLowerCase().includes(needle) ||
          (b.nameOriginal ?? '').toLowerCase().includes(needle) ||
          b.id.toLowerCase().includes(needle)
      );

  return (
    <section className="mb-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-fg-faint">Read</span>
        {TEXT_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onText?.(id)}
            aria-pressed={id === textId}
            className={cn('toggle-pill', id === textId ? 'toggle-pill-on' : 'toggle-pill-off')}
          >
            {getTextLabel(id, true)}
          </button>
        ))}
      </div>

      {/*
          One row, scrolled sideways.

          This wrapped, so the Quran rendered 114 surah names as a wall of full-width
          lines that pushed the scripture itself off the bottom of the page. A book
          switcher is a strip, not a list, and this is the one control in the app
          where the number of options was the problem: the other five corpora are 5
          to 39 books and wrapped harmlessly, which is probably why it went unnoticed
          until the Quran made it impossible to miss.

          overflow-x-auto rather than a carousel, so a trackpad and a keyboard's
          arrow keys both work and nothing hides behind a control. The selected book
          is scrolled into view, so opening a deep chapter does not leave the strip
          showing the first few books.
      */}
      {loading ? (
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="skeleton h-7 w-20 rounded-full" />
          ))}
        </div>
      ) : (
        <>
        {needsFilter ? (
          <div className="mb-2 flex items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a surah"
              aria-label="Find a book"
              className="w-full max-w-[220px] rounded-lg border border-line bg-bg px-2.5 py-1 text-sm outline-none focus:border-accent"
            />
            {needle ? (
              <button type="button" onClick={() => setFilter('')} className="text-[12px] text-fg-faint hover:text-accent">
                Clear
              </button>
            ) : null}
            {needle && visible.length === 0 ? (
              <span className="text-[12px] text-fg-faint">No book matches</span>
            ) : null}
          </div>
        ) : null}

        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="flex w-max gap-1.5">
            {visible.map((book) => (
              <button
                key={book.id}
                type="button"
                onClick={() => onPick(book.id)}
                aria-pressed={book.id === bookId}
                ref={book.id === bookId ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'center' }) : undefined}
                title={`${book.verseCount.toLocaleString()} verses in ${book.chapterCount} chapters`}
                className={cn('toggle-pill shrink-0', book.id === bookId ? 'toggle-pill-on' : 'toggle-pill-off')}
              >
                {book.name}
                {book.nameOriginal ? <span className="ml-1.5 text-fg-faint" dir="auto">{book.nameOriginal}</span> : null}
              </button>
            ))}
          </div>
        </div>
        </>
      )}
    </section>
  );
}

/** The chapter itself. */
function ReadingPane({
  textId,
  bookId,
  chapter,
  translation,
  showOriginal,
  onToggleOriginal,
  onTranslation,
  onChapter,
  onPrev,
  onNext,
}: {
  textId: TextId;
  bookId: string;
  chapter: number;
  translation?: string;
  showOriginal: boolean;
  onToggleOriginal: () => void;
  onTranslation: (id: string) => void;
  onChapter: (chapter: number) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof import('@/lib/api').api.readBook>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    void import('@/lib/api')
      .then(({ api }) => api.readBook(textId, bookId, { chapter, translation }))
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load this chapter.');
      });
    return () => {
      cancelled = true;
    };
  }, [textId, bookId, chapter, translation]);

  const hasOriginal = useMemo(() => data?.verses.some((v) => v.originalText && v.originalText !== v.text) ?? false, [data]);

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!data) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-52" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-5 w-full" />
        ))}
      </div>
    );
  }

  return (
    <article>
      <header className="mb-6 border-b border-line pb-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-medium tracking-tight">{data.bookName}</h1>
          {data.bookNameOriginal ? (
            <span className="text-lg text-fg-muted" dir="auto">
              {data.bookNameOriginal}
            </span>
          ) : null}
          <span className="text-sm text-fg-muted">
            Chapter {data.chapter}
            {data.chapterCount > 1 ? ` of ${data.chapterCount}` : ''}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {data.translations.length > 1 ? (
            <label className="flex items-center gap-1.5 text-xs text-fg-muted">
              <Languages className="h-3.5 w-3.5" />
              <select
                value={data.translationId}
                onChange={(e) => onTranslation(e.target.value)}
                aria-label="Translation"
                className="rounded-md border border-line bg-raised px-2 py-1 text-xs text-fg outline-none focus:border-accent"
              >
                {data.translations.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : data.translations[0] ? (
            <span className="text-xs text-fg-faint">
              {data.translations[0].name}
              {data.translations[0].year ? ` · ${data.translations[0].year}` : ''}
            </span>
          ) : null}

          {hasOriginal ? (
            <button
              type="button"
              onClick={onToggleOriginal}
              aria-pressed={showOriginal}
              className={cn('toggle-pill', showOriginal ? 'toggle-pill-on' : 'toggle-pill-off')}
            >
              Original text
            </button>
          ) : null}

          <span className="ms-auto flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={data.chapter <= 1}
              className="icon-btn"
              aria-label="Previous chapter"
              title="Previous chapter"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={data.chapter >= data.chapterCount}
              className="icon-btn"
              aria-label="Next chapter"
              title="Next chapter"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </span>
        </div>
      </header>

      {/* Chapter jump, when a book has enough of them to be worth listing. */}
      {data.chapterCount > 3 ? (
        <div className="mb-6 flex flex-wrap gap-1">
          {data.chapters.map((c) => (
            <button
              key={c.chapter}
              type="button"
              onClick={() => onChapter(c.chapter)}
              aria-current={c.chapter === data.chapter ? 'true' : undefined}
              className={cn(
                'h-7 min-w-7 rounded-md px-1.5 text-xs tabular-nums transition-colors',
                c.chapter === data.chapter
                  ? 'bg-accent text-accent-fg'
                  : 'text-fg-muted hover:bg-panel hover:text-fg'
              )}
            >
              {c.chapter}
            </button>
          ))}
        </div>
      ) : null}

      <div className="max-w-2xl">
        {data.verses.map((verse) => {
          // The original reads in its own script's direction, not its corpus's.
          const direction = getLanguageDirection(verse.language);
          return (
            <div key={verse.passageKey} id={`v-${verse.verse}`} className="border-b border-line-soft py-3 last:border-b-0">
              {showOriginal && verse.originalText && verse.originalText !== verse.text ? (
                <p
                  dir={direction}
                  className={cn('mb-1.5 text-[15px] leading-loose text-fg-muted', getScriptFont(verse.language))}
                >
                  {verse.originalText}
                </p>
              ) : null}
              {/*
                Always left to right. The corpus direction describes the original
                language, not this line: applying RTL to an English translation of a
                Quranic verse reversed its punctuation and right-aligned it, which
                reads as a rendering fault rather than as a translation.
              */}
              <p dir="ltr" className="text-[15px] leading-relaxed">
                <sup className="mr-2 select-none font-mono text-[11px] text-fg-faint tabular-nums">{verse.verse}</sup>
                {verse.text}
              </p>
              {verse.themes.length > 0 ? (
                <p className="mt-1.5 flex flex-wrap gap-1">
                  {verse.themes.map((theme) => (
                    <Link
                      key={theme}
                      href={`/explore?theme=${encodeURIComponent(theme)}`}
                      className="rounded bg-panel px-1.5 py-0.5 text-[11px] text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent"
                    >
                      {theme}
                    </Link>
                  ))}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <nav className="mt-8 flex items-center justify-between border-t border-line pt-4" aria-label="Book navigation">
        {data.previous ? (
          <Link
            href={`/read?text=${textId}&book=${encodeURIComponent(data.previous.bookId)}`}
            className="inline-flex items-center gap-2 text-sm text-fg-muted transition-colors hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" />
            {data.previous.name}
          </Link>
        ) : (
          <span />
        )}
        {data.next ? (
          <Link
            href={`/read?text=${textId}&book=${encodeURIComponent(data.next.bookId)}`}
            className="inline-flex items-center gap-2 text-sm text-fg-muted transition-colors hover:text-fg"
          >
            {data.next.name}
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}

/** Minimal highlight, so a found phrase is visible without pulling in the passage highlighter. */
function highlight(text: string, term: string) {
  const needle = term.trim();
  if (!needle) return text;
  const pattern = new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded bg-amber-100 px-0.5 text-amber-950 dark:bg-amber-500/25 dark:text-amber-200">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export default function ReadPage() {
  return (
    <Suspense
      fallback={
        <Page>
          <div className="skeleton h-8 w-56" />
        </Page>
      }
    >
      <ReadInner />
    </Suspense>
  );
}
