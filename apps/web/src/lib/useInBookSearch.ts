'use client';

import { useState } from 'react';
import { api } from './api';
import type { Passage, TextId } from '@ilm/shared';

export interface InBookResult {
  passage: Passage;
  score?: number;
}

/**
 * Search scoped to one book.
 *
 * Scoping happens by filter, not by filtering the results afterwards: the corpus
 * search already accepts a book filter, so asking it for one book is both faster
 * and more correct than retrieving everything and discarding most of it. Discarding
 * would silently cap the result count — twenty hits from the whole corpus, filtered
 * down to the two that happen to be in this book, which reads as "only two matches"
 * when the book may contain forty.
 */
export function useInBookSearch() {
  const [results, setResults] = useState<InBookResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const run = async (textId: TextId, bookId: string, query: string) => {
    setSearching(true);
    try {
      const book = await api.books(textId);
      const match = book.books.find((b) => b.id === bookId);
      if (!match) {
        setResults([]);
        return;
      }
      /*
       * Filtered by `id`, not `name`, and that distinction is the whole reason
       * in-book search works on the Quran at all: a surah's name is "Al-Fatihah"
       * while its slug is "1", so filtering by name returns nothing for the one
       * corpus whose books are not named after their slugs.
       */
      const response = await api.search({
        query,
        limit: 40,
        semantic: false,
        filters: { texts: [textId], books: [match.id] },
      });
      setResults(response.results);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  return { results, run, clear: () => setResults(null), searching };
}
