'use client';

import { Link } from '@/i18n/navigation';
import { SaveButton } from '@/components/SaveButton';
import { useTranslations } from 'next-intl';
import { Plus, Check, Scale } from 'lucide-react';
import type { Passage, SearchResult } from '@ilm/shared';
import { getTextChipClass, getTextDirection, getTextLabel, getScriptFont, percent, truncate, cn } from '@/lib/utils';
import { highlightTerm } from '@/lib/highlight';

export function PassageCard({
  passage,
  matchedIn,
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
  /**
   * Which field the term matched in, as the API reports it: 'original',
   * 'translation', 'themes', or several. Used to say so, because a reader who
   * searched Hebrew and is looking at an English translation with no explanation
   * has been given something other than what they asked for.
   */
  matchedIn?: string[];
  /** Jev's relevance, when semantic ranking ran. */
  semanticScore?: number;
  /** Full-text relevance before re-ranking. */
  textScore?: number;
}) {
  const href = `/passage/${passage.passageKey.split('/').map(encodeURIComponent).join('/')}`;
  const t = useTranslations('search');
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
      {/* ps-9 reserves the corner the compare control occupies. Without it the
          score rendered underneath the button and was never seen. */}
      <header className="mb-1.5 flex items-baseline gap-2 ps-9">
        <span className={getTextChipClass(passage.textId)}>{getTextLabel(passage.textId, true)}</span>
        <Link href={href} className="ref truncate transition-colors hover:text-accent hover:underline">
          {passage.book} {passage.chapter}:{passage.verse}
        </Link>
        {/* No percentage when the model decided the order.

            When Jev re-ranks, the list is ordered by its verdict and the score is a
            blend of that verdict with full-text relevance, computed independently.
            The two disagree: a live search for "light" produced a list reading
            74, 74, 73, 73, 74, 73, 74, 73 — the fourth row claimed less than the
            fifth, and the seventh more than the fourth. A ranked list whose stated
            scores contradict its own order is a list that is telling the reader
            two incompatible things at once, and on a product whose only claim is
            that its numbers mean what they say it is the worst possible place to
            be caught.

            So the number is shown only when it is the thing that ordered the list,
            which is the full-text case. Rescaling the model's verdict into a
            percentage to fill the gap would invent a number to look tidy, and that
            is the failure this whole product is against. The header already says
            whether the ranking came from meaning or from literal matching. */}
        {score !== undefined && semanticScore === undefined ? (
          <span
            className="ms-auto shrink-0 font-mono text-[11px] tabular-nums text-fg-faint"
            title={`Full-text relevance ${percent(score)}`}
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

      {/*
        Which field earned the hit. A reader who searched الرحمن and is looking at
        an English translation with no explanation has been given something other
        than what they asked for — and a reader who searched a Hebrew or Arabic word
        and is looking at exactly that text should know the match is real and not
        a keyword overlap in an English paraphrase.
      */}
      {matchedIn?.includes('original') && !matchedIn.includes('translation') ? (
        <p className="mb-1 text-[11px] text-accent">{t('matchedOriginal')}</p>
      ) : null}

      {showThemes && passage.themes.length > 0 ? (
        <ul className="mt-2.5 flex flex-wrap gap-1">
          {passage.themes.slice(0, 3).map((theme: { theme: string }) => (
            <li key={theme.theme} className="rounded bg-panel px-1.5 py-0.5 text-[11px] text-fg-muted">
              {theme.theme}
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        `end-0` rather than `right-0`, so the controls sit on the reading edge in
        both directions instead of on the right of an Arabic page. A save and a
        compare are both one click that changes state, and the save is the one a
        reader reaches for when they are done looking.
      */}
      <div className="absolute end-0 top-2.5 flex items-center gap-1">
        <SaveButton passageKey={passage.passageKey} />
        {onToggleCompare ? (
          <button
            type="button"
            onClick={() => onToggleCompare(passage)}
            className={cn(
              'grid h-7 w-7 place-items-center rounded-full border transition-colors',
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
      </div>
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
      matchedIn={result.matchedFields}
      // Forwarded so the card can tell whether the number it is about to show is
      // the one that ordered the list. Dropping these made every row look like a
      // literal full-text match, which is the case where the number is safe.
      semanticScore={result.semanticScore}
      textScore={result.textScore}
    />
  );
}

export { Plus, Scale };
