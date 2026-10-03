'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { JourneySummary } from '@ilm/shared';
import { cn } from '@/lib/utils';

/**
 * Put a passage into one of the reader's journeys.
 *
 * A disclosure rather than a dialog, for the same reason the glossary and lexicon
 * panels are: the passage stays readable behind it, which is the point of a
 * decision about what to keep reading. Escape closes it, and focus comes back to
 * the button that opened it.
 */
export function AddToJourney({ passageKey, className }: { passageKey: string; className?: string }) {
  const t = useTranslations('journeys');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [journeys, setJourneys] = useState<JourneySummary[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [newName, setNewName] = useState('');
  // So Escape can put focus back on the button that opened the panel.
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Loaded when opened, not on mount: a reader who never builds a journey should
  // not pay for the list on every passage they open.
  useEffect(() => {
    if (!open || journeys) return;
    api
      .journeys()
      .then((d) => setJourneys(d.journeys))
      .catch(() => setJourneys([]));
  }, [open, journeys]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const add = useCallback(
    async (journey: JourneySummary) => {
      setBusyKey(journey.id);
      setError(null);
      try {
        await api.addJourneyNode(journey.id, passageKey);
        setAnnouncement(t('addedTo', { name: journey.name }));
        setOpen(false);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('addFailed'));
      } finally {
        setBusyKey(null);
      }
    },
    [passageKey, t]
  );

  const createAndAdd = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = newName.trim();
      if (!trimmed) return;
      setError(null);
      try {
        const { journey } = await api.createJourney(trimmed);
        await api.addJourneyNode(journey.id, passageKey);
        setNewName('');
        setAnnouncement(t('addedTo', { name: journey.name }));
        setOpen(false);
        router.push(`/journeys/${journey.id}`);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('createFailed'));
      }
    },
    [newName, passageKey, router, t]
  );

  return (
    <div className={cn('relative inline-block', className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="add-to-journey-panel"
        className="btn btn-secondary"
      >
        <Plus className="h-4 w-4" aria-hidden />
        {t('addToJourney')}
      </button>

      {open ? (
        <div
          id="add-to-journey-panel"
          className="absolute start-0 top-full z-30 mt-1 w-72 rounded-xl border border-line bg-surface p-3 shadow-lg"
        >
          <h2 className="text-sm font-medium">{t('addHeading')}</h2>

          {journeys === null ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-fg-muted" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {t('loading')}
            </p>
          ) : journeys.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">{t('noneYet')}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {journeys.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    onClick={() => add(j)}
                    disabled={busyKey !== null}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-panel disabled:opacity-60"
                  >
                    {busyKey === j.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Check className="h-3.5 w-3.5 opacity-0" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate">{j.name}</span>
                    <span className="shrink-0 text-xs text-fg-faint tabular-nums">{j.nodeCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={createAndAdd} className="mt-3 border-t border-line pt-3">
            <label htmlFor="new-journey-name" className="mb-1 block text-xs font-medium text-fg-muted">
              {t('orNew')}
            </label>
            <div className="flex gap-1.5">
              <input
                id="new-journey-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
                placeholder={t('newPlaceholder')}
                className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm"
              />
              <button type="submit" disabled={!newName.trim()} className="btn btn-primary px-2 py-1.5 text-xs">
                {t('create')}
              </button>
            </div>
          </form>

          {error ? <p className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p> : null}
        </div>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
