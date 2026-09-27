'use client';

import { useEffect, useMemo, useState } from 'react';
import { Languages, Check } from 'lucide-react';
import type { Passage } from '@ilm/shared';
import { cn } from '@/lib/utils';

/**
 * Choosing between published translations of one passage.
 *
 * The reading translation is a local preference, not a property of the passage: the
 * same passage appears in search results, in the comparison grid and on its own
 * page, and a reader who wants the World English Bible wants it everywhere. It is
 * held in localStorage rather than sent to the server because nothing about the
 * underlying data changes.
 */
const STORAGE_KEY = 'ilm-translation-preference';

export interface TranslationOption {
  name: string;
  text: string;
  isPrimary: boolean;
}

export function useTranslationChoice(passage: Passage | null) {
  const [preferred, setPreferred] = useState<string | null>(null);

  useEffect(() => {
    try {
      setPreferred(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      // Storage unavailable. The default reading still works.
    }
  }, []);

  // Null-tolerant so the owning page can call this unconditionally, which a hook
  // requires: the passage arrives asynchronously.
  const options = useMemo<TranslationOption[]>(() => {
    if (!passage) return [];
    return [
      { name: passage.primaryTranslationName ?? 'Primary', text: passage.translation, isPrimary: true },
      ...passage.alternativeTranslations.map((alt) => ({ name: alt.translator, text: alt.text, isPrimary: false })),
    ];
  }, [passage]);

  // A preference chosen on another passage only applies if this one offers it,
  // otherwise the reader would be shown a translation that does not exist here.
  const active = options.find((option) => option.name === preferred) ?? options[0];

  const choose = (name: string) => {
    setPreferred(name);
    try {
      window.localStorage.setItem(STORAGE_KEY, name);
    } catch {
      // The choice still applies to this page view.
    }
  };

  return { options, active, choose };
}

export function TranslationSwitcher({
  options,
  activeName,
  onChoose,
  className,
}: {
  options: TranslationOption[];
  activeName: string;
  onChoose: (name: string) => void;
  className?: string;
}) {
  if (options.length < 2) {
    return <p className={cn('text-[11px] text-ink-500', className)}>Only one translation of this passage is held.</p>;
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Languages className="mr-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
        {options.map((option) => {
          const isActive = option.name === activeName;
          return (
            <button
              key={option.name}
              type="button"
              onClick={() => onChoose(option.name)}
              aria-pressed={isActive}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px]',
                isActive
                  ? 'border-ink-800 bg-ink-800 text-white dark:border-ink-200 dark:bg-ink-200 dark:text-ink-900'
                  : 'border-ink-300 hover:border-ink-500 dark:border-ink-700'
              )}
            >
              {isActive ? <Check className="mr-1 inline h-3 w-3" /> : null}
              {option.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
