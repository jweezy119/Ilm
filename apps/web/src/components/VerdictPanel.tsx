'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { AlertTriangle, Layers, Search } from 'lucide-react';
import { cn, getTextLabel } from '@/lib/utils';
import type { CorpusVerdict, ScoreSource, TextId } from '@ilm/shared';

/**
 * The corpus verdict, rendered as a result rather than as an absence.
 *
 * This is the one thing a competitor cannot show. Every other scripture product
 * ranks something first, because ranking nothing is a lost session — so "these
 * texts do not address this" is structurally against their incentives and almost
 * nobody offers it. Ilm does, and until now it appeared as a dashed `Empty` box,
 * which presented our only unwinnable advantage as a failure state.
 *
 * So it is a first-class outcome with a receipt. A reader who gets told no should
 * be able to check the no: how many passages were searched, in which texts, and
 * whether a model judged it or it fell out of the ranking. Without those three
 * facts "these texts do not address this" is just an assertion, and an assertion
 * this blunt needs more support than a search result does.
 *
 * `partial` uses the same component. It is the same information at a different
 * severity — the texts touch the subject without addressing it — and it travels
 * with the results rather than sitting in a banner that scrolls away.
 */
export function VerdictPanel({
  verdict,
  source,
  searchedPassages,
  texts,
  expandedTheme,
  suggestions,
  narrowed,
  hasResults = true,
  onWiden,
  onPick,
  className,
}: {
  verdict: Extract<CorpusVerdict, 'unaddressed' | 'partial'>;
  /**
   * Whether a model judged this. Carries the full three-value source rather than a
   * narrowed pair, because the panel has to be able to say "no model was
   * available" — which is the weaker case and the one worth being explicit about.
   */
  source: ScoreSource;
  /** How many passages the search actually looked at, for the receipt. */
  searchedPassages?: number;
  texts: TextId[];
  expandedTheme?: string | null;
  suggestions?: string[];
  /** True when the reader has filtered the search down to fewer than all texts. */
  narrowed?: boolean;
  /**
   * Whether leads are rendered beneath this panel.
   *
   * It changes the copy, not the layout. A corpus that does not address a question
   * still contains its closest words, so most unaddressed verdicts arrive with
   * results under them — and the panel has to be able to say so. When there are
   * none, promising passages below would be a second small lie in a component whose
   * entire purpose is not lying.
   */
  hasResults?: boolean;
  onWiden?: () => void;
  /**
   * Required, and called directly rather than optionally.
   *
   * It was `onPick?:` and the chips called `onPick?.(s)`, which meant a call site
   * that forgot to pass it would render four "Try instead" buttons that did nothing
   * — a dead control, discovered by the check in dead-controls.test.ts. Both call
   * sites do pass it, so this was never actually broken, but the optional signature
   * is what allows the next one to be.
   */
  onPick: (term: string) => void;
  className?: string;
}) {
  const t = useTranslations('search');
  const unaddressed = verdict === 'unaddressed';
  const [showReceipt, setShowReceipt] = useState(false);
  const total = texts.length === 1 ? getTextLabel(texts[0]) : `${texts.length} texts`;

  return (
    <section
      // A verdict is an outcome, so it gets a border and a heading rather than the
      // dashed placeholder box an empty result set gets. The left rule is the one
      // piece of decoration: it marks the box as an answer.
      className={cn(
        'rounded-xl border p-4',
        unaddressed
          ? 'border-amber-300 bg-amber-50/70 dark:border-amber-800/70 dark:bg-amber-950/20'
          : 'border-line bg-raised',
        className
      )}
      aria-labelledby="verdict-heading"
    >
      {/*
          One line, and the line is the claim.

          This was a panel: heading, a paragraph of body copy, a three-line receipt,
          an expansion theme note, a row of suggestion chips and two links. It was
          longer than most of the verses it was describing, and it stood above the
          results it was qualifying, so the qualification and the thing being
          qualified competed for the same space.

          The claim is one sentence and stays one sentence. Everything under it —
          how much was searched, whether a model judged it, and the disclaimer that
          this is a claim about the corpus rather than about the question — is still
          there, one click away, and the affordance says so. Nothing was dropped; it
          stopped being mandatory.
      */}
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          className={cn('mt-0.5 h-4 w-4 shrink-0', unaddressed ? 'text-amber-600 dark:text-amber-400' : 'text-fg-faint')}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 id="verdict-heading" className={cn('text-sm font-medium', unaddressed && 'text-amber-900 dark:text-amber-200')}>
            {unaddressed ? t('unaddressedTitle') : t('partialTitle')}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">
            {unaddressed ? (hasResults ? t('unaddressedBody') : t('unaddressedBodyNone')) : t('partialBody')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowReceipt((v) => !v)}
          aria-expanded={showReceipt}
          aria-controls="verdict-receipt"
          className="shrink-0 self-center text-[12px] text-fg-faint underline-offset-2 transition-colors hover:text-accent hover:underline"
        >
          {showReceipt ? t('hideWhy') : t('why')}
        </button>
      </div>

      <div id="verdict-receipt" hidden={!showReceipt}>

      {/*
          The receipt. Three facts, and the verdict is only worth as much as they
          are: how much was searched, how it was decided, and what the verdict is
          not. The last one matters most — "these texts do not treat your question"
          is a claim about the corpus, and a reader is right to ask whether it is
          quietly a claim about the question instead.

          Plain paragraphs, not a definition list. The dt/dd pairing carried no
          label, so each line was announced twice — once by the sr-only term and
          once by its description — and a screen-reader user heard the receipt
          three times over. */}
      <div className="mt-2 space-y-1 text-[12px] leading-relaxed text-fg-faint dark:border-white/10">
        {/* The count arrives from a second request and may not have landed yet.
            Rather than omit the whole line and lose the scope, the line degrades to
            the texts, which this component always knows. */}
        {searchedPassages ? t('scope', { count: searchedPassages.toLocaleString(), texts: total }) : t('scopeTexts', { texts: total })}
        <p>{source === 'jev' ? t('verdictFromModel') : t('verdictDerived')}</p>
        <p>{t('notJudged')}</p>
      </div>

      {expandedTheme ? (
        <p className="mt-2 text-[12px] text-fg-faint">
          {t('expandedTheme', { theme: expandedTheme })}
        </p>
      ) : null}
      </div>

      {/*
          The next step. A verdict that only says no sends the reader away, and we
          would be trading a real answer for a lost session — the exact trade our
          competitors make, and the reason this feature is rare. Every branch here
          offers somewhere to go: a related term from the corpus's own vocabulary,
          the full text set if the reader narrowed it, or the topic index.
          Suggestions come from the API's own vocabulary, so they are things these
          texts actually discuss rather than guesses. */}
      {suggestions && suggestions.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-fg-faint">{t('tryInstead')}</span>
          {suggestions.slice(0, 4).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="rounded-full border border-line px-2 py-0.5 text-[12px] text-fg-muted transition-colors hover:border-accent hover:text-accent"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {narrowed && onWiden ? (
          <button
            type="button"
            onClick={onWiden}
            className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted transition-colors hover:text-accent"
          >
            <Layers className="h-3.5 w-3.5" aria-hidden />
            {t('widenFilters')}
          </button>
        ) : null}
        <Link
          href="/topics"
          className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted transition-colors hover:text-accent"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          {t('browseTopics')}
        </Link>
      </div>
    </section>
  );
}
