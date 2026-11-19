'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Share an artefact that leaves Ilm, on the platform the reader is on.
 *
 * On a phone the Web Share API opens the OS share sheet, so a comparison or a
 * citation goes straight into a message without a copy/paste detour. On desktop,
 * where `navigator.share` is usually absent or awkward, the same button falls
 * back to the clipboard and says so. A cancelled share sheet is not a failure.
 *
 * `copyText` lets the caller share a richer artefact than the link alone — a
 * citation, for instance, is a formatted passage, not just its permalink.
 */
export function ShareButton({
  url,
  text,
  title,
  copyText,
  className,
}: {
  url?: string;
  text?: string;
  title?: string;
  copyText?: string;
  className?: string;
}) {
  const t = useTranslations('share');
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function share() {
    const link = url ?? (typeof window === 'undefined' ? '' : window.location.href);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: title ?? 'Ilm', text: text ?? '', url: link });
        return;
      } catch (caught) {
        // Cancelling the sheet is an ordinary outcome, not an error to surface.
        if ((caught as Error)?.name === 'AbortError') return;
        // Anything else falls through to the clipboard below.
      }
    }
    try {
      await navigator.clipboard.writeText(copyText ?? link);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setFailed(true);
    }
  }

  return (
    <span className={cn('inline-flex flex-col', className)}>
      <button
        type="button"
        onClick={() => void share()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-panel"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Share2 className="h-3.5 w-3.5" />}
        {copied ? t('copied') : t('open')}
      </button>
      {failed ? <span className="mt-1 text-[11px] text-fg-faint">{t('failed')}</span> : null}
    </span>
  );
}
