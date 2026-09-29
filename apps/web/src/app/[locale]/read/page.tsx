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

  // Changing text invalidates the book, so a book id from another corpus would be
  // requested against this one and 404. Clearing it is the honest response.
  useEffect(() => {
    if (bookId && books.length > 0 && !books.some((b) => b.id === bookId)) setParams({ book: null });
  }, [books, bookId, setParams]);

  const goToChapter = useCallback(
    (delta: number) => {
      setParams({ chapter: Math.max(1, chapter + delta) });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [chapter, setParams]
  );

  const onSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (!bookId || !query.trim()) return;
    setSearching(true);
    run(textId, bookId, query.trim());
    setSearching(false);
  };

  if (!bookId) {
    return (
      <Page>
        <BookPicker textId={textId} books={books} loading={booksLoading} onPick={(id) => setParams({ book: id })} />
      </Page>
    );
  }

  return (
    <Page>
      <BookPicker
        textId={textId}
        bookId={bookId}
        books={books}
        loading={booksLoading}
        onPick={(id) => setParams({ book: id, chapter: 1 })}
        onText={(id) => router.replace(`/read?text=${id}`)}
      />
      <ReadingPane
        textId={textId}
        bookId={bookId}
        chapter={chapter}
        translation={translation}
        showOriginal={showOriginal}
        onToggleOriginal={() => setShowOriginal((v) => !v)}
        onTranslation={(id) => setParams({ translation: id })}
        onChapter={(n) => setParams({ chapter: n })}
        onPrev={() => goToChapter(-1)}
        onNext={() => goToChapter(1)}
      />

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

      {loading ? (
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="skeleton h-7 w-20 rounded-full" />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {books.map((book) => (
            <button
              key={book.id}
              type="button"
              onClick={() => onPick(book.id)}
              aria-pressed={book.id === bookId}
              title={`${book.verseCount.toLocaleString()} verses in ${book.chapterCount} chapters`}
              className={cn('toggle-pill', book.id === bookId ? 'toggle-pill-on' : 'toggle-pill-off')}
            >
              {book.name}
              {book.nameOriginal ? <span className="ml-1.5 text-fg-faint" dir="auto">{book.nameOriginal}</span> : null}
            </button>
          ))}
        </div>
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
