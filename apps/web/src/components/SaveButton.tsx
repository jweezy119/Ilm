'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useLibraryStore } from '@/store';
import { cn } from '@/lib/utils';

/**
 * Save a passage to the reader's library.
 *
 * `optimistic` is the default because the common case is a reader clicking once
 * and moving on: a button that takes a round trip to acknowledge feels broken,
 * and a save that fails is rare and recoverable. The recommendation rows on a
 * passage page pass `optimistic={false}` for the opposite reason — they sit in a
 * list of eight things, and flipping one while the reader is choosing another
 * makes the list reorder under them.
 */
export function SaveButton({
  passageKey,
  className,
  variant = 'icon',
  optimistic = true,
}: {
  passageKey: string;
  className?: string;
  variant?: 'icon' | 'full';
  optimistic?: boolean;
}) {
  const t = useTranslations('library');
  const keys = useLibraryStore((s) => s.keys);
  const loaded = useLibraryStore((s) => s.loaded);
  const saving = useLibraryStore((s) => s.saving);
  const load = useLibraryStore((s) => s.load);
  const toggle = useLibraryStore((s) => s.toggle);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const saved = keys.includes(passageKey);
  const busy = saving === passageKey;

  const onClick = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    if (!optimistic) setPending(true);
    await toggle(passageKey);
    if (!optimistic) setPending(false);
  };

  const label = saved ? t('remove') : t('save');
  const showBusy = busy || pending;

  if (variant === 'full') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={showBusy}
        aria-pressed={saved}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
          saved
            ? 'border-accent/50 bg-accent-soft text-accent'
            : 'border-line text-fg-muted hover:bg-panel',
          showBusy && 'opacity-60',
          className
        )}
      >
        {saved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={showBusy}
      aria-pressed={saved}
      aria-label={label}
      title={label}
      className={cn(
        'icon-btn shrink-0',
        saved ? 'text-accent' : 'text-fg-faint',
        showBusy && 'opacity-60',
        className
      )}
    >
      {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
    </button>
  );
}
