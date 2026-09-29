'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Check, Quote } from 'lucide-react';
import type { Passage } from '@ilm/shared';
import { getTextLabel } from '@/lib/utils';

/**
 * Copy a passage as a citation, ready to paste.
 *
 * This is the artefact that leaves the app, and it is the whole thesis in
 * pasteable form: the text, the reference, where the corpus is, the permalink, and
 * the score with the source of that score. No interpretation, because nobody here
 * wrote one.
 *
 * Two formats, because the two audiences want different things. `plain` is for
 * pasting into a notes file or a message. `cited` is for a bibliography: a
 * reference line and a permalink, with the score attributed, so a reader can see
 * that the ranking is a weighted judgement from a named source rather than a fact
 * about the text.
 *
 * The permalink is in every format. A citation without one is a claim with nothing
 * behind it, and this is the one thing the app can offer that a book cannot.
 */

export type CitationFormat = 'plain' | 'cited';

function bookName(passage: Passage): string {
  return passage.book;
}

function referenceOf(passage: Passage): string {
  return `${bookName(passage)} ${passage.chapter}:${passage.verse}`;
}

function corpusLabel(passage: Passage): string {
  return getTextLabel(passage.textId);
}

/**
 * A match's score and where it came from, which are properties of the *ranking*
 * and not of the passage — the same verse scores differently against two
 * different queries. Passed in rather than read off the passage, because
 * `Passage` has no score field and should not: a score baked into a verse would
 * be a claim about the text.
 */
export interface MatchProvenance {
  score?: number;
  source?: string;
}

export function buildCitation(
  passage: Passage,
  format: CitationFormat,
  siteUrl: string,
  provenance: MatchProvenance = {}
): string {
  const url = `${siteUrl.replace(/\/$/, '')}/passage/${passage.passageKey
    .split(':')
    .map(encodeURIComponent)
    .join('/')}`;

  if (format === 'plain') {
    const lines = [`${corpusLabel(passage)}, ${referenceOf(passage)}`, '', passage.translation];
    if (passage.originalText) {
      lines.push('', `[${passage.originalText}]`);
    }
    lines.push('', url);
    return lines.join('\n');
  }

  // `cited`. The score is only included when there is one, and it is always
  // attributed: "60% (weighted score, Jev)" is a claim about how the app ranked
  // something, and printing a bare percentage beside a verse invites a reader to
  // take it for a property of the verse.
  const score =
    typeof provenance.score === 'number'
      ? ` — ${Math.round(provenance.score * 100)}% (weighted score, ${provenance.source ?? 'derived'})`
      : '';

  const lines = [
    `${corpusLabel(passage)}. ${bookName(passage)} ${passage.chapter}:${passage.verse}${score}.`,
    passage.translation,
  ];
  if (passage.originalText) {
    lines.push(`[${passage.originalText}]`);
  }
  lines.push(url);
  return lines.join('\n');
}

export function CopyCitation({
  passage,
  score,
  source,
  className,
  compact = false,
}: {
  passage: Passage;
  score?: number;
  source?: string;
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations('library');
  const [format, setFormat] = useState<CitationFormat>('plain');
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const copy = async () => {
    setFailed(false);
    const text = buildCitation(passage, format, siteUrl, { score, source });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access is refused in some browsers and in any non-secure
      // context. Saying so is better than a button that appears to do nothing.
      setFailed(true);
    }
  };

  return (
    <div className={className}>
      <div className="flex items-center gap-1.5">
        {!compact ? (
          <div className="inline-flex overflow-hidden rounded-lg border border-line" role="group" aria-label={t('format')}>
            {(['plain', 'cited'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                aria-pressed={format === f}
                className={`px-2 py-1 text-[11px] font-medium transition-colors ${
                  format === f ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:text-fg'
                }`}
              >
                {t(`format_${f}`)}
              </button>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-panel"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('copied') : t('copyCitation')}
        </button>
      </div>

      {failed ? <p className="mt-1.5 text-[11px] text-fg-faint">{t('copyFailed')}</p> : null}

      {/* A preview, so the reader can see the shape of what they are about to
          paste rather than discovering it in a document. */}
      {!compact ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel/40 p-2.5 text-[11px] leading-relaxed text-fg-muted">
          {buildCitation(passage, format, siteUrl, { score, source })}
        </pre>
      ) : null}

      {!compact ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-fg-faint">
          <Quote className="mt-0.5 h-3 w-3 shrink-0" />
          {t('noInterpretation')}
        </p>
      ) : null}
    </div>
  );
}
