'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bookmark, Loader2, Plus, Trash2 } from 'lucide-react';
import { Page, PageHeader, Empty } from '@/components/Shell';
import { api, ApiError } from '@/lib/api';
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
  const [journeys, setJourneys] = useState<JourneySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const load = useCallback(() => {
    api
      .journeys()
      .then((d) => setJourneys(d.journeys))
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : t('loadFailed')));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setError(null);
      try {
        const { journey } = await api.createJourney(trimmed);
        setName('');
        setAnnouncement(t('created', { name: journey.name }));
        router.push(`/journeys/${journey.id}`);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('createFailed'));
      } finally {
        setBusy(false);
      }
    },
    [name, busy, router, t]
  );

  const remove = useCallback(
    async (journey: JourneySummary) => {
      // No confirm() dialog: this app has no dialog anywhere, and a native
      // confirm cannot be styled, translated or given a sensible focus order.
      // Deleting is reversible only by rebuilding, so it is spelled out instead.
      setError(null);
      try {
        await api.deleteJourney(journey.id);
        setAnnouncement(t('deleted', { name: journey.name }));
        load();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('deleteFailed'));
      }
    },
    [load, t]
  );

  const empty = params.get('empty') === '1';

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      <form onSubmit={create} className="mb-8 flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
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
        <button type="submit" disabled={!name.trim() || busy} className="btn btn-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          {t('create')}
        </button>
      </form>

      {error ? (
        <p className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      ) : null}

      {journeys === null ? (
        <Loading />
      ) : journeys.length === 0 ? (
        <Empty icon={Bookmark} title={t('emptyTitle')}>
          {t('emptyBody')}
        </Empty>
      ) : (
        <ul className="space-y-2">
          {journeys.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-4">
              <Link href={`/journeys/${j.id}`} className="min-w-0 flex-1 group">
                <span className="block font-medium group-hover:text-accent">{j.name}</span>
                {j.description ? <span className="mt-0.5 block text-sm text-fg-muted">{j.description}</span> : null}
                <span className="mt-1 block text-xs text-fg-faint">
                  {t('summary', { count: j.nodeCount })}
                  {j.corpora.length
                    ? ` · ${j.corpora.map((c) => getTextLabel(c)).join(', ')}`
                    : ''}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => remove(j)}
                aria-label={t('deleteNamed', { name: j.name })}
                className="icon-btn"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {empty ? <p className="sr-only">{t('emptyHint')}</p> : null}
    </>
  );
}