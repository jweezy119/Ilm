'use client';

import type { ScoreSource } from '@ilm/shared';

/** Theme sources also allow a curator's own assignment, which predates the local engine. */
export type DisplaySource = ScoreSource | 'manual';
import { cn } from '@/lib/utils';

/**
 * Where a number came from, shown wherever a score is.
 *
 * One component rather than a conditional at each site, because three sources now
 * exist and a `source === 'jev' ? … : 'derived'` test would quietly report a
 * locally-run model as a rule.
 */

/** The word shown on a badge. */
export const SOURCE_WORD: Record<DisplaySource, string> = {
  jev: 'jev',
  local: 'local',
  derived: 'rule',
  manual: 'manual',
};

/** A sentence, for a place where there is room for one. */
export const SOURCE_SENTENCE: Record<DisplaySource, string> = {
  jev: 'Judged by Jev',
  local: 'Judged by a model running on this machine',
  derived: 'Scored by local rules — no model available',
  manual: 'Assigned by a curator',
};

export const SOURCE_TITLE: Record<DisplaySource, string> = {
  jev: 'Judged by the hosted model',
  local: 'Judged by a model running on this machine',
  derived: 'Scored by a deterministic local rule, no model involved',
  manual: 'Assigned by a curator',
};

export function SourceBadge({ source, className }: { source: DisplaySource; className?: string }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[11px]',
        source === 'jev'
          ? 'bg-ilm-100 text-ilm-800 dark:bg-ilm-800 dark:text-ilm-100'
          : source === 'local'
            ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100'
            : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
        className
      )}
      title={SOURCE_TITLE[source]}
    >
      {SOURCE_WORD[source]}
    </span>
  );
}
