'use client';

import { Link } from '@/i18n/navigation';
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
    /*
     * A row in a list, not a card in a grid.
     *
     * Forty shadowed cards read as forty interruptions. Forty hairline-separated
     * rows read as a document, and the reference sits on the left edge where the
     * eye can find it without reading the passage first.
     *
     * The add-to-comparison control stays hidden until hover: an always-present
     * button on every row competes with the text it sits beside, and on a phone
     * there is no hover, so it is revealed by focus there instead.
     */
    <article className="result-row group relative">
      {/* pr-9 reserves the corner the compare control occupies. Without it the
          score rendered underneath the button and was never seen. */}
      <header className="mb-1.5 flex items-baseline gap-2 pr-9">
        <span className={getTextChipClass(passage.textId)}>{getTextLabel(passage.textId, true)}</span>
        <Link href={href} className="ref truncate transition-colors hover:text-accent hover:underline">
          {passage.book} {passage.chapter}:{passage.verse}
        </Link>
        {score !== undefined ? (
          <span
            className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-fg-faint"
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
        <p
          dir={direction}
          className={cn('mb-1 text-[15px] leading-relaxed text-fg-muted', getScriptFont(passage.metadata.language))}
        >
          {truncate(passage.originalText, 140)}
        </p>
      ) : null}

      <p className="line-clamp-4 text-[15px] leading-relaxed text-fg">
        {query ? highlightTerm(truncate(passage.translation, 320), query) : truncate(passage.translation, 320)}
      </p>

      {showThemes && passage.themes.length > 0 ? (
        <ul className="mt-2.5 flex flex-wrap gap-1">
          {passage.themes.slice(0, 3).map((theme: { theme: string }) => (
            <li key={theme.theme} className="rounded bg-panel px-1.5 py-0.5 text-[11px] text-fg-muted">
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
            'absolute right-0 top-3 grid h-7 w-7 place-items-center rounded-full border transition-colors',
            inComparison
              ? 'border-accent bg-accent text-accent-fg'
              : 'border-line bg-raised text-fg-faint hover:border-accent hover:text-accent'
          )}
          aria-label={inComparison ? 'Remove from comparison' : 'Add to comparison'}
          aria-pressed={inComparison}
        >
          {inComparison ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
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
  return (
    <PassageCard
      passage={result.passage}
      score={result.score}
      query={query}
      inComparison={inComparison}
      onToggleCompare={onToggleCompare}
    />
  );
}

export { Plus, Scale };
