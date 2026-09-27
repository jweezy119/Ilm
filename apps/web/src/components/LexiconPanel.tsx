'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Loader2, X } from 'lucide-react';
import type { LexiconLookup } from '@ilm/shared';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Scripts a lexicon in this library covers. The Sefaria dictionaries are Hebrew
 * and Aramaic; there is no Arabic or Greek source wired up, so those passages say
 * so rather than offering a lookup that cannot answer.
 */
export const LEXICON_LANGUAGES = new Set(['hebrew', 'aramaic']);

/**
 * The original text, with each word tappable.
 *
 * Only offered where a dictionary can answer: the Sefaria lexicons are Hebrew and
 * Aramaic, so a Quranic Arabic word or a Greek one is left as plain text rather
 * than given a button that always comes back empty.
 */
export function LookupableText({ text, className, dir }: { text: string; className?: string; dir?: 'rtl' | 'ltr' }) {
  const [word, setWord] = useState<string | null>(null);

  const words = text.split(/(\s+)/);

  return (
    <>
      <p dir={dir} className={className}>
        {words.map((chunk, i) =>
          // Whitespace between words, kept as-is so the text still wraps and
          // justifies the way the script expects.
          chunk.trim() === '' ? (
            <span key={i}>{chunk}</span>
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => setWord(chunk)}
              className="rounded px-0.5 text-left underline decoration-dotted underline-offset-4 hover:bg-ink-100 focus:bg-ink-100 dark:hover:bg-ink-800 dark:focus:bg-ink-800"
              title={`Look up ${chunk}`}
            >
              {chunk}
            </button>
          )
        )}
      </p>

      {word ? <LexiconPanel word={word} onClose={() => setWord(null)} /> : null}
    </>
  );
}

function LexiconPanel({ word, onClose }: { word: string; onClose: () => void }) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; message?: string; data?: LexiconLookup }>({
    status: 'loading',
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    api
      .lexicon(word)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((caught) => {
        if (!cancelled) {
          setState({ status: 'error', message: caught instanceof ApiError ? caught.message : 'Lookup failed.' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [word]);

  return (
    <aside className="mt-4 rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
      <header className="mb-3 flex items-start gap-2">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            <span dir="rtl" className="font-[family-name:var(--font-hebrew)] text-lg">
              {word}
            </span>
          </h2>
          <p className="text-[11px] text-ink-500">Published dictionary entries, not a generated gloss.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close dictionary" className="grid h-6 w-6 place-items-center rounded hover:bg-ink-100 dark:hover:bg-ink-800">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {state.status === 'loading' ? (
        <p className="flex items-center gap-2 py-4 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Looking in the lexicons…
        </p>
      ) : null}

      {state.status === 'error' ? <p className="text-sm text-red-700 dark:text-red-300">{state.message}</p> : null}

      {state.status === 'ready' && state.data ? (
        state.data.entries.length === 0 ? (
          <p className="text-sm text-ink-500">
            No dictionary in this library carries that word. It may be a particle, an inflected form, or a proper name.
          </p>
        ) : (
          <>
            <ul className="space-y-3">
              {state.data.entries.map((entry, i) => (
                <li key={`${entry.lexicon}-${entry.headword}-${i}`} className="border-t border-ink-200 pt-3 first:border-0 first:pt-0 dark:border-ink-800">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-700 dark:bg-ink-800 dark:text-ink-300">
                      {entry.lexicon}
                    </span>
                    <span dir="rtl" className="font-[family-name:var(--font-hebrew)] text-sm">
                      {entry.headword}
                    </span>
                    {entry.transliteration ? <span className="text-xs italic text-ink-500">{entry.transliteration}</span> : null}
                    {entry.morphology ? <span className="font-mono text-[11px] text-ink-500">{entry.morphology}</span> : null}
                    {entry.strongNumber ? (
                      <span className="rounded bg-ilm-100 px-1.5 py-0.5 font-mono text-[11px] text-ilm-800 dark:bg-ilm-800 dark:text-ilm-100">
                        Strong&rsquo;s {entry.strongNumber}
                      </span>
                    ) : null}
                  </div>

                  <ul className="space-y-1">
                    {entry.senses.map((sense, j) => (
                      <li key={j} className="text-sm text-ink-700 dark:text-ink-300">
                        {sense.definition}
                      </li>
                    ))}
                  </ul>

                  {entry.source ? <p className="mt-1 text-[11px] text-ink-500">Source: {entry.source}</p> : null}
                </li>
              ))}
            </ul>
            <p className={cn('mt-3 text-[11px] text-ink-500', state.data.cached && 'opacity-70')}>
              {state.data.cached ? 'From cache.' : 'Fetched from Sefaria.'} Different dictionaries disagree; that is the
              point of showing more than one.
            </p>
          </>
        )
      ) : null}
    </aside>
  );
}
