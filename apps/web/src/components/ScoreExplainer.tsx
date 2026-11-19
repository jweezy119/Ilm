'use client';

import { useId, useRef } from 'react';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ScoreSource } from '@ilm/shared';
import { cn } from '@/lib/utils';

/**
 * What a number is, and where it came from — in the reader's language.
 *
 * A `title` attribute works on a mouse and is invisible on a phone. This is one
 * component with two presentations: a dialog docked to the bottom edge on a
 * phone, a small centred card on desktop. It explains a score in static words;
 * it never writes anything about the passage itself.
 */
export function ScoreExplainer({
  source,
  kind = 'source',
  className,
}: {
  source?: ScoreSource;
  kind?: 'source' | 'literal';
  className?: string;
}) {
  const t = useTranslations('scoreInfo');
  const tc = useTranslations('common');
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={cn(
          'inline-grid h-5 w-5 shrink-0 place-items-center rounded-full text-fg-faint transition-colors hover:text-accent',
          className
        )}
        aria-label={t('open')}
        title={t('open')}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <dialog
        ref={dialog}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
        className="fixed inset-x-0 bottom-0 m-0 w-full rounded-t-2xl border-t border-line bg-panel p-5 text-fg shadow-2xl sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(90vw,28rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
        aria-labelledby={titleId}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-sm font-medium">{t('title')}</h2>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="icon-btn text-fg-muted hover:text-fg"
            aria-label={tc('close')}
          >
            ×
          </button>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">
          {kind === 'literal' ? t('literal') : t(source ?? 'derived')}
        </p>
      </dialog>
    </>
  );
}
