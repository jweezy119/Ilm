'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { BookOpen, CornerDownLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { parseCitation } from '@ilm/shared';
import { getTextLabel } from '@/lib/utils';
import type { ResolvedCitation } from '@ilm/shared';

/**
 * Jumps to a passage when the reader types a reference.
 *
 * People arrive at a scripture app with a reference already in their head. Typing
 * "John 3:16" into a full-text search box gets back keyword matches, ranked, for
 * the words "John", "3" and "16" — none of which is the verse that was asked for.
 *
 * So the box recognises a citation and offers the passage itself, with the text
 * shown before the click. Not automatic: a reader who typed a reference by mistake,
 * or a genuine phrase that happens to look like one, should see what is on offer
 * rather than have the page jump under them.
 *
 * When a reference is genuinely ambiguous the choice is offered. "Gen 1:1" is two
 * real passages, because Genesis is in both the Hebrew Torah and the KJV Old
 * Testament, and picking one for the reader would be a guess.
 */
export function CitationJump({ value, onDismiss }: { value: string; onDismiss: () => void }) {
  const t = useTranslations('citation');
  const router = useRouter();
  const [matches, setMatches] = useState<ResolvedCitation[] | null>(null);
  const [checked, setChecked] = useState<string | null>(null);

  // Parsing is local and synchronous; only the existence check needs the server.
  const parsed = parseCitation(value);
  const key = parsed.map((m) => m.passageKey).join('|');

  /*
   * Escape dismisses the suggestion.
   *
   * It appears as the reader types a reference, unprompted, and the only way to
   * remove it was the dismiss button — so a keyboard user who did not want it had
   * to reach for a mouse, and the panel stayed over the results. Keystrokes are
   * not swallowed: the input keeps every character, only Escape is claimed.
   */
  useEffect(() => {
    if (parsed.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target && target.tagName === 'INPUT') {
        onDismiss();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDismiss, parsed.length]);

  useEffect(() => {
    if (parsed.length === 0) {
      setMatches(null);
      setChecked(null);
      return;
    }

    let cancelled = false;
    // Debounced: this runs on every keystroke, and "John 3:1" is a reference
    // three keystrophes before it is a finished one.
    const timer = setTimeout(() => {
      api
        .resolveCitation(value)
        .then((d) => {
          if (cancelled) return;
          setMatches(d.matches);
          setChecked(value);
        })
        .catch(() => {
          if (!cancelled) setMatches([]);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `key` rather than `value`: re-resolving on every keystroke of the same
    // reference is the thing being debounced away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, checked]);

  if (parsed.length === 0 || matches === null || matches.length === 0) return null;
  if (checked !== value) return null;

  const go = (passage: ResolvedCitation) => {
    onDismiss();
    router.push(`/passage/${passage.passageKey.split(':').map(encodeURIComponent).join('/')}`);
  };

  return (
    <div className="mb-3 rounded-xl border border-accent/40 bg-accent-soft/30 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-accent">
        <BookOpen className="h-3.5 w-3.5" />
        {matches.length === 1 ? t('single') : t('several', { count: matches.length })}
      </div>

      <ul className="space-y-1.5">
        {matches.map((passage) => (
          <li key={passage.passageKey}>
            <button
              type="button"
              onClick={() => go(passage)}
              className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-panel/60"
            >
              <span className="mt-0.5 shrink-0 rounded-full bg-panel px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                {getTextLabel(passage.textId)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {passage.book} {passage.chapter}:{passage.verse}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-fg-muted">
                  {passage.translation}
                </span>
              </span>
              <CornerDownLeft className="mt-1 h-3.5 w-3.5 shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>

      {/*
        Dismissible, because "John 3" is not a reference and the box has to get
        out of the way. The dismissal is for the view, not the input: the next
        keystroke re-evaluates.
      */}
      <button type="button" onClick={onDismiss} className="mt-2 text-[11px] text-fg-faint hover:text-fg">
        {t('dismiss')}
      </button>
    </div>
  );
}
