'use client';

import Link from 'next/link';
import { Plus, Check, Scale } from 'lucide-react';
import type { Passage, SearchResult } from '@ilm/shared';
import { getTextChipClass, getTextDirection, getTextLabel, getScriptFont, percent, truncate, cn } from '@/lib/utils';
import { highlightTerm } from '@/lib/highlight';

export function PassageCard({
  passage,
  score,
  query,
  inComparison,
  onToggleCompare,
  showThemes = true,
  semanticScore,
  textScore,
}: {
  passage: Passage;
  score?: number;
  query?: string;
  inComparison: boolean;
  onToggleCompare?: (passage: Passage) => void;
  showThemes?: boolean;
  /** Jev's relevance, when semantic ranking ran. */
  semanticScore?: number;
  /** Full-text relevance before re-ranking. */
  textScore?: number;
}) {
  const href = `/passage/${passage.passageKey.split('/').map(encodeURIComponent).join('/')}`;
  const direction = getTextDirection(passage.textId);

  return (
    <article className="group relative flex flex-col rounded-xl border border-ink-200 bg-white p-4 transition-colors hover:border-ink-400 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-ink-600">
      <header className="mb-2 flex items-center gap-2">
        <span className={getTextChipClass(passage.textId)}>{getTextLabel(passage.textId, true)}</span>
        <Link href={href} className="truncate text-sm font-medium hover:underline">
          {passage.book} {passage.chapter}:{passage.verse}
        </Link>
        {score !== undefined ? (
          <span
            className="ml-auto shrink-0 font-mono text-[11px] text-ink-500 dark:text-ink-400"
            title={
              semanticScore !== undefined && textScore !== undefined
                ? `Semantic relevance ${percent(semanticScore)} · full-text ${percent(textScore)}`
                : undefined
            }
          >
            {percent(score)}
          </span>
        ) : null}
      </header>

      {passage.originalText ? (
        <p dir={direction} className={cn('mb-2 text-ink-800 dark:text-ink-200', getScriptFont(passage.metadata.language))}>
          {truncate(passage.originalText, 140)}
        </p>
      ) : null}

      <p className="line-clamp-4 text-sm text-ink-700 dark:text-ink-300">
        {query ? highlightTerm(truncate(passage.translation, 320), query) : truncate(passage.translation, 320)}
      </p>

      {showThemes && passage.themes.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1">
          {passage.themes.slice(0, 3).map((theme) => (
            <li key={theme.theme} className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-700 dark:bg-ink-800 dark:text-ink-300">
              {theme.theme}
            </li>
          ))}
        </ul>
      ) : null}

      {onToggleCompare ? (
        <button
          type="button"
          onClick={() => onToggleCompare(passage)}
          className={cn(
            'absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md border transition-colors',
            inComparison
              ? 'border-emerald-600 bg-emerald-700 text-white'
              : 'border-ink-300 bg-white text-ink-500 opacity-0 hover:border-ink-500 hover:text-ink-800 group-hover:opacity-100 focus-visible:opacity-100 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-400'
          )}
          aria-label={inComparison ? 'Remove from comparison' : 'Add to comparison'}
          aria-pressed={inComparison}
        >
          {inComparison ? <Check className="h-3.5 w-3.5" /> : <Scale className="h-3.5 w-3.5" />}
        </button>
      ) : null}
    </article>
  );
}

export function SearchResultCard({
  result,
  query,
  inComparison,
  onToggleCompare,
}: {
  result: SearchResult;
  query: string;
  inComparison: boolean;
  onToggleCompare: (passage: Passage) => void;
}) {
  return <PassageCard passage={result.passage} score={result.score} query={query} inComparison={inComparison} onToggleCompare={onToggleCompare} />;
}

export { Plus };
