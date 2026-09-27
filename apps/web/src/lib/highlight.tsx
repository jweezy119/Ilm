'use client';

import type { HighlightSegment } from '@/lib/highlighter';

/** Render segments, marking the ones that participate in a stored alignment. */
export function renderHighlightedText(text: string, highlights: HighlightSegment[]): React.ReactNode {
  if (highlights.length === 0) return <>{text}</>;

  return (
    <span>
      {highlights.map((segment, i) =>
        segment.highlighted ? (
          <mark
            key={i}
            className="bg-amber-200 dark:bg-amber-900/60 text-inherit px-0.5 rounded"
            data-alignment-id={segment.alignmentId}
            data-type={segment.type}
            title={segment.type ? `Aligned: ${segment.type.replace(/_/g, ' ')}` : undefined}
          >
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </span>
  );
}

/** Highlight every occurrence of a search term, case-insensitively. */
export function highlightTerm(text: string, term: string): React.ReactNode {
  if (!term.trim()) return <>{text}</>;

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-900/60 text-inherit px-0.5 rounded">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
