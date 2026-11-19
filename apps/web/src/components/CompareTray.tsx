'use client';

import { useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeftRight, Trash2, X } from 'lucide-react';
import { useComparisonStore } from '@/store';
import { cn } from '@/lib/utils';

/** The drag payload, so only our own passages can be dropped on the tray. */
export const PASSAGE_DRAG_TYPE = 'application/x-ilm-passage';

/**
 * The comparison tray, always reachable.
 *
 * It used to live at the bottom of the rail, which on a phone meant opening a
 * drawer to find what you had already picked. A thumb-reachable bar appears as
 * soon as one passage is selected — on desktop it docks as a narrow pill — and
 * the button that adds a passage can also be dragged onto it. The click and
 * keyboard paths stay exactly as they were; dragging is only an accelerant.
 */
export function CompareTray() {
  const t = useTranslations('compareTray');
  const pathname = usePathname();
  const keys = useComparisonStore((s) => s.passageKeys);
  const addKey = useComparisonStore((s) => s.addKey);
  const remove = useComparisonStore((s) => s.remove);
  const clear = useComparisonStore((s) => s.clear);
  const [dropActive, setDropActive] = useState(false);

  // The compare page already shows the full set; a bar over it would duplicate
  // the chips and cover the alignments.
  if (pathname === '/compare' || keys.length === 0) return null;

  return (
    <div
      role="region"
      aria-label={t('label')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] backdrop-blur',
        'pb-[env(safe-area-inset-bottom)]',
        'md:inset-x-auto md:bottom-4 md:left-1/2 md:-translate-x-1/2 md:rounded-2xl md:border md:pb-0',
        dropActive && 'border-accent bg-accent-soft'
      )}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(PASSAGE_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={(event) => {
        const key = event.dataTransfer.getData(PASSAGE_DRAG_TYPE);
        setDropActive(false);
        if (!key) return;
        event.preventDefault();
        addKey(key);
      }}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2 md:px-4">
        <span className="hidden shrink-0 text-xs font-medium text-fg-muted sm:inline">
          {t('selected', { count: keys.length })}
        </span>

        <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {keys.slice(0, 2).map((key) => (
            <li key={key} className="min-w-0">
              <span className="flex items-center gap-1 rounded-full border border-line bg-raised py-0.5 ps-2 pe-1 text-[11px]">
                <span className="max-w-[9rem] truncate font-mono text-fg-muted" title={key}>
                  {key}
                </span>
                <button
                  type="button"
                  onClick={() => remove(key)}
                  aria-label={t('remove', { key })}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-fg-faint hover:bg-line-soft hover:text-fg"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </li>
          ))}
          {keys.length > 2 ? (
            <li className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-[11px] tabular-nums text-fg-muted">
              +{keys.length - 2}
            </li>
          ) : null}
        </ul>

        {dropActive ? (
          <span className="shrink-0 text-xs font-medium text-accent">{t('dropHere')}</span>
        ) : null}

        <button
          type="button"
          onClick={clear}
          className="icon-btn shrink-0 text-fg-faint hover:text-fg"
          aria-label={t('clear')}
          title={t('clear')}
        >
          <Trash2 className="h-4 w-4" />
        </button>

        <Link
          href="/compare"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          <ArrowLeftRight className="h-4 w-4" />
          <span>{t('open')}</span>
          <span className="rounded-full bg-accent-fg/20 px-1.5 text-[10px] font-semibold tabular-nums">
            {keys.length}
          </span>
        </Link>
      </div>
    </div>
  );
}
