'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bookmark, Copy, Download, Loader2, Plus, Share2, Trash2, X } from 'lucide-react';
import { Page, PageHeader, Empty } from '@/components/Shell';
import { api, ApiError } from '@/lib/api';
import { useJourneysStore } from '@/store';
import { decodeJourneyShare } from '@/lib/journey-export';
import { passageReference } from '@/lib/passage-ref';
import type { JourneySummary } from '@ilm/shared';
import { getTextLabel } from '@/lib/utils';

export default function JourneysPage() {
  return (
    <Page>
      <Suspense fallback={<Loading />}>
        <Journeys />
      </Suspense>
    </Page>
  );
}

function Loading() {
  const t = useTranslations('journeys');
  return (
    <p className="flex items-center gap-2 py-8 text-sm text-fg-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('loading')}
    </p>
  );
}

function Journeys() {
  const t = useTranslations('journeys');
  const router = useRouter();
  const params = useSearchParams();

  const journeys = useJourneysStore((s) => s.journeys);
  const loaded = useJourneysStore((s) => s.loaded);
  const loadStore = useJourneysStore((s) => s.load);
  const createJourney = useJourneysStore((s) => s.create);
  const removeJourney = useJourneysStore((s) => s.removeJourney);

  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dismissedImport, setDismissedImport] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const importToken = params.get('import');
  const sharedImport = useMemo(
    () => (dismissedImport ? null : decodeJourneyShare(importToken)),
    [importToken, dismissedImport]
  );

  useEffect(() => {
    void loadStore(true);
  }, [loadStore]);

  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(''), 5000);
    return () => clearTimeout(timer);
  }, [announcement]);

  const uniqueName = useCallback(
    (base: string) => {
      const existingNames = new Set(journeys.map((j) => j.name.toLowerCase()));
      if (!existingNames.has(base.toLowerCase())) return base.slice(0, 80);
      for (let i = 2; i < 20; i += 1) {
        const candidate = `${base.slice(0, 74)} (${i})`;
        if (!existingNames.has(candidate.toLowerCase())) return candidate;
      }
      return `${base.slice(0, 70)} ${Date.now() % 10000}`;
    },
    [journeys]
  );

  const create = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setError(null);
      try {
        const journey = await createJourney(trimmed, description.trim() || undefined);
        setName('');
        setDescription('');
        setAnnouncement(t('created', { name: journey.name }));
        router.push(`/journeys/${journey.id}`);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('createFailed'));
      } finally {
        setBusy(false);
      }
    },
    [name, description, busy, createJourney, router, t]
  );

  const handleImportShared = useCallback(async () => {
    if (!sharedImport || importing) return;
    setImporting(true);
    setError(null);
    try {
      const finalName = uniqueName(sharedImport.name);
      const journey = await createJourney(
        finalName,
        sharedImport.description,
        sharedImport.keys,
        sharedImport.notes
      );
      setAnnouncement(t('imported', { name: journey.name, count: journey.nodeCount }));
      router.push(`/journeys/${journey.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('importFailed'));
    } finally {
      setImporting(false);
    }
  }, [sharedImport, importing, uniqueName, createJourney, router, t]);

  const duplicate = useCallback(
    async (journey: JourneySummary) => {
      setDuplicatingId(journey.id);
      setError(null);
      try {
        const { graph } = await api.journeyGraph(journey.id);
        const ordered = [...graph.nodes].sort((a, b) => a.position - b.position);
        const notes: Record<string, string | null> = {};
        for (const n of ordered) if (n.note) notes[n.passageKey] = n.note;
        const copyName = uniqueName(`${journey.name.slice(0, 72)} (${t('copySuffix')})`);
        const created = await createJourney(
          copyName,
          journey.description ?? undefined,
          ordered.map((n) => n.passageKey),
          notes
        );
        setAnnouncement(t('duplicated', { name: created.name }));
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('createFailed'));
      } finally {
        setDuplicatingId(null);
      }
    },
    [uniqueName, createJourney, t]
  );

  const remove = useCallback(
    async (journey: JourneySummary) => {
      setError(null);
      try {
        await removeJourney(journey.id);
        setAnnouncement(t('deleted', { name: journey.name }));
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('deleteFailed'));
      }
    },
    [removeJourney, t]
  );

  const empty = params.get('empty') === '1';

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      {sharedImport ? (
        <section
          aria-label={t('importHeading')}
          className="mb-6 rounded-2xl border border-accent/40 bg-accent-soft/30 p-4 sm:p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
                <Share2 className="h-3.5 w-3.5" aria-hidden />
                {t('importHeading')}
              </p>
              <h2 className="mt-1 text-base font-semibold">{sharedImport.name}</h2>
              {sharedImport.description ? (
                <p className="mt-0.5 text-sm text-fg-muted">{sharedImport.description}</p>
              ) : null}
              <p className="mt-2 text-xs text-fg-muted">
                {t('summary', { count: sharedImport.keys.length })} ·{' '}
                {sharedImport.keys
                  .slice(0, 5)
                  .map((k) => passageReference(k))
                  .join(', ')}
                {sharedImport.keys.length > 5 ? ` +${sharedImport.keys.length - 5}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissedImport(true)}
              aria-label={t('close')}
              className="icon-btn shrink-0"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={importing}
              onClick={() => void handleImportShared()}
              className="btn btn-primary px-3.5 py-2 text-xs"
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="h-4 w-4" aria-hidden />
              )}
              {t('importAction')}
            </button>
            <button
              type="button"
              onClick={() => setDismissedImport(true)}
              className="btn btn-secondary px-3 py-2 text-xs"
            >
              {t('cancel')}
            </button>
          </div>
        </section>
      ) : null}

      <p
        role="status"
        aria-live="polite"
        className={announcement ? 'mb-4 rounded-lg border border-line bg-panel p-3 text-sm text-fg-muted' : 'sr-only'}
      >
        {announcement}
      </p>

      <form onSubmit={create} className="mb-8 rounded-2xl border border-line bg-panel/40 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="journey-name" className="mb-1 block text-xs font-medium text-fg-muted">
              {t('newLabel')}
            </label>
            <input
              id="journey-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('newPlaceholder')}
              maxLength={80}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
            />
          </div>
          <div>
            <label htmlFor="journey-desc" className="mb-1 block text-xs font-medium text-fg-muted">
              {t('descriptionLabel')}
            </label>
            <input
              id="journey-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              maxLength={280}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button type="submit" disabled={!name.trim() || busy} className="btn btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            {t('create')}
          </button>
        </div>
      </form>

      {error ? (
        <p className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      ) : null}

      {!loaded ? (
        <Loading />
      ) : journeys.length === 0 ? (
        <Empty icon={Bookmark} title={t('emptyTitle')}>
          {t('emptyBody')}
        </Empty>
      ) : (
        <ul className="space-y-2">
          {journeys.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-4">
              <Link href={`/journeys/${j.id}`} className="min-w-0 flex-1 group">
                <span className="block font-medium group-hover:text-accent">{j.name}</span>
                {j.description ? <span className="mt-0.5 block text-sm text-fg-muted">{j.description}</span> : null}
                <span className="mt-1 block text-xs text-fg-faint">
                  {t('summary', { count: j.nodeCount })}
                  {j.corpora.length ? ` · ${j.corpora.map((c) => getTextLabel(c)).join(', ')}` : ''}
                </span>
              </Link>
              <button
                type="button"
                disabled={duplicatingId !== null}
                onClick={() => void duplicate(j)}
                aria-label={t('duplicateNamed', { name: j.name })}
                title={t('duplicate')}
                className="icon-btn"
              >
                {duplicatingId === j.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden />
                )}
              </button>
              <button
                type="button"
                onClick={() => void remove(j)}
                aria-label={t('deleteNamed', { name: j.name })}
                title={t('deleteNamed', { name: j.name })}
                className="icon-btn"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {empty ? <p className="sr-only">{t('emptyHint')}</p> : null}
    </>
  );
}
