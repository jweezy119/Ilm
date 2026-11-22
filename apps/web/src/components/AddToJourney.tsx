'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Check, ExternalLink, Loader2, Plus, Route } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useJourneysStore } from '@/store';
import type { JourneySummary } from '@ilm/shared';
import { cn } from '@/lib/utils';

/**
 * Put one passage (or a batch of passages) into one of the reader's journeys.
 *
 * Uses the shared `useJourneysStore` so membership checkmarks stay live across
 * Search, Reader, Library, Passage pages, and the Comparison Tray without
 * re-fetching per card. Creating a new journey keeps the reader on their
 * current page and offers an inline link to open the journey whenever ready.
 */
export function AddToJourney({
  passageKey,
  passageKeys,
  compact = false,
  label,
  defaultNewName = '',
  align = 'end',
  className,
}: {
  /** Single passage mode. */
  passageKey?: string;
  /** Batch mode (e.g. Save Library, Save Compare Tray, Save Theme Group). */
  passageKeys?: string[];
  /** Compact circular icon button matching SaveButton, for dense lists and verse rows. */
  compact?: boolean;
  /** Optional custom button label for batch actions. */
  label?: string;
  /** Optional suggested name pre-filled in the "Or start a new one" field. */
  defaultNewName?: string;
  /** Popover horizontal alignment relative to trigger. */
  align?: 'start' | 'end';
  className?: string;
}) {
  const t = useTranslations('journeys');
  const panelId = useId();
  const inputId = useId();

  const keys = useMemo(
    () => (passageKeys?.length ? passageKeys : passageKey ? [passageKey] : []),
    [passageKey, passageKeys]
  );
  const isBatch = Boolean(passageKeys && passageKeys.length > 1);
  const singleKey = !isBatch ? keys[0] : undefined;

  const journeys = useJourneysStore((s) => s.journeys);
  const loaded = useJourneysStore((s) => s.loaded);
  const loading = useJourneysStore((s) => s.loading);
  const activeJourneyId = useJourneysStore((s) => s.activeJourneyId);
  const loadJourneys = useJourneysStore((s) => s.load);
  const togglePassage = useJourneysStore((s) => s.togglePassage);
  const addBatch = useJourneysStore((s) => s.addBatch);
  const createJourney = useJourneysStore((s) => s.create);

  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [lastUpdated, setLastUpdated] = useState<{ id: string; name: string; count: number } | null>(null);
  const [newName, setNewName] = useState(defaultNewName);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const inAnyJourney = useMemo(() => {
    if (!singleKey) return false;
    return journeys.some((j) => (j.nodeKeys ?? []).includes(singleKey));
  }, [journeys, singleKey]);

  // Sort active / most-recently-used journey first for 1-click access.
  const orderedJourneys = useMemo(() => {
    if (!activeJourneyId) return journeys;
    return [...journeys].sort((a, b) => {
      if (a.id === activeJourneyId) return -1;
      if (b.id === activeJourneyId) return 1;
      return 0;
    });
  }, [journeys, activeJourneyId]);

  useEffect(() => {
    if (open && !loaded && !loading) {
      void loadJourneys();
    }
  }, [open, loaded, loading, loadJourneys]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const handleToggleOrAdd = useCallback(
    async (journey: JourneySummary) => {
      if (keys.length === 0) return;
      setBusyKey(journey.id);
      setError(null);
      try {
        if (singleKey) {
          const added = await togglePassage(journey.id, singleKey);
          setAnnouncement(added ? t('addedTo', { name: journey.name }) : t('removedFrom', { name: journey.name }));
          setLastUpdated(added ? { id: journey.id, name: journey.name, count: 1 } : null);
        } else {
          const res = await addBatch(journey.id, keys);
          setAnnouncement(t('addedBatchTo', { count: res.added.length, name: journey.name }));
          setLastUpdated({ id: journey.id, name: journey.name, count: res.added.length });
        }
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('addFailed'));
      } finally {
        setBusyKey(null);
      }
    },
    [keys, singleKey, togglePassage, addBatch, t]
  );

  const createAndAdd = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = newName.trim();
      if (!trimmed || creating || keys.length === 0) return;
      setCreating(true);
      setError(null);
      try {
        const journey = await createJourney(trimmed, undefined, keys);
        setNewName('');
        setAnnouncement(
          keys.length === 1
            ? t('addedTo', { name: journey.name })
            : t('addedBatchTo', { count: journey.nodeCount, name: journey.name })
        );
        setLastUpdated({ id: journey.id, name: journey.name, count: journey.nodeCount });
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('createFailed'));
      } finally {
        setCreating(false);
      }
    },
    [newName, creating, keys, createJourney, t]
  );

  if (keys.length === 0) return null;

  const triggerTitle = inAnyJourney ? t('inJourney') : label ?? t('addToJourney');

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      {compact ? (
        <button
          ref={buttonRef}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={triggerTitle}
          title={triggerTitle}
          className={cn(
            'grid h-7 w-7 place-items-center rounded-full border transition-colors',
            inAnyJourney
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line bg-raised text-fg-faint hover:border-accent hover:text-accent'
          )}
        >
          {inAnyJourney ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Route className="h-3.5 w-3.5" aria-hidden />}
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className={cn('btn btn-secondary', inAnyJourney && 'border-accent/50 text-accent')}
        >
          {inAnyJourney ? <Check className="h-4 w-4" aria-hidden /> : <Route className="h-4 w-4" aria-hidden />}
          {label ?? (inAnyJourney ? t('inJourney') : t('addToJourney'))}
        </button>
      )}

      {open ? (
        <div
          id={panelId}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'absolute top-full z-40 mt-1 w-72 rounded-xl border border-line bg-surface p-3 shadow-lg',
            align === 'end' ? 'end-0' : 'start-0'
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">
              {isBatch ? t('addBatchHeading', { count: keys.length }) : t('addHeading')}
            </h2>
            {lastUpdated ? (
              <Link
                href={`/journeys/${lastUpdated.id}`}
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                {t('openJourney')}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
            ) : null}
          </div>

          {!loaded && loading ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-fg-muted" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {t('loading')}
            </p>
          ) : orderedJourneys.length === 0 ? (
            <p className="mt-2 text-xs text-fg-muted">{t('noneYet')}</p>
          ) : (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {orderedJourneys.map((j) => {
                const alreadyIn = singleKey ? (j.nodeKeys ?? []).includes(singleKey) : false;
                const isActive = j.id === activeJourneyId;
                return (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={() => handleToggleOrAdd(j)}
                      disabled={busyKey !== null || creating}
                      aria-pressed={singleKey ? alreadyIn : undefined}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm transition-colors hover:bg-panel disabled:opacity-60',
                        alreadyIn && 'bg-accent-soft/50 text-accent'
                      )}
                    >
                      {busyKey === j.id ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                      ) : alreadyIn ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                      ) : (
                        <Plus className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1 truncate">{j.name}</span>
                      {isActive ? (
                        <span className="shrink-0 rounded bg-panel px-1 py-0.5 text-[10px] text-fg-muted">
                          {t('activeTag')}
                        </span>
                      ) : null}
                      <span className="shrink-0 text-xs text-fg-faint tabular-nums">{j.nodeCount}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <form onSubmit={createAndAdd} className="mt-3 border-t border-line pt-3">
            <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-fg-muted">
              {t('orNew')}
            </label>
            <div className="flex gap-1.5">
              <input
                id={inputId}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
                placeholder={t('newPlaceholder')}
                className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm text-fg"
              />
              <button
                type="submit"
                disabled={!newName.trim() || creating}
                className="btn btn-primary px-2.5 py-1.5 text-xs"
              >
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : t('create')}
              </button>
            </div>
          </form>

          {lastUpdated ? (
            <p className="mt-2 rounded-lg bg-accent-soft/40 px-2 py-1 text-xs text-accent">
              {t('addedTo', { name: lastUpdated.name })}
            </p>
          ) : null}
          {error ? <p className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p> : null}
        </div>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
