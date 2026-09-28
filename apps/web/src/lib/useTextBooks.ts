'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import type { BookMetadata, TextId } from '@ilm/shared';

/**
 * The books of a text, fetched once per corpus.
 *
 * Cached because the rail is on screen for as long as anyone is reading, and
 * re-fetching a list of 114 surahs on every chapter turn is 114 rows of navigation
 * thrown away for nothing. The cache is module-level rather than per-component so
 * switching books and coming back does not refetch.
 */
const cache = new Map<string, BookMetadata[]>();

export function useTextBooks(textId: TextId) {
  const [fetched, setFetched] = useState<{ textId: TextId; books: BookMetadata[] } | null>(
    cache.has('__init__') ? null : null
  );

  useEffect(() => {
    if (cache.has(textId)) return;
    let cancelled = false;
    void api
      .books(textId)
      .then((result) => {
        if (cancelled) return;
        cache.set(textId, result.books);
        setFetched({ textId, books: result.books });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [textId]);

  /*
   * Both states derived from the cache and the last fetch rather than held in
   * state of their own. Setting a `loading` flag inside the effect is what the lint
   * rule objects to — it re-renders before the effect that caused it has finished —
   * and here it was also unnecessary: whether the list is loading is a question
   * about the cache, which is the only thing that has changed.
   */
  const books = fetched?.textId === textId ? fetched.books : (cache.get(textId) ?? []);
  const loading = !cache.has(textId);
  return { books, loading };
}
