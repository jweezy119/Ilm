'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Bookmark, Trash2, ExternalLink } from 'lucide-react';
import { Page, PageHeader, Empty } from '@/components/Shell';
import { CopyCitation } from '@/components/CopyCitation';
import { api } from '@/lib/api';
import { useLibraryStore } from '@/store';
import { getTextLabel } from '@/lib/utils';
import type { LibraryEntry } from '@ilm/shared';

/**
 * What this reader kept.
 *
 * The only page in the app that is about the reader rather than the corpus, and
 * the one that decides whether anyone comes back. Everything else in Ilm is
 * stateless: a search leaves nothing behind, a journey leaves nothing behind, and
 * a citation cannot be found again unless it was written down somewhere.
 *
 * Entries are hydrated from the corpus on read rather than copied at save time, so
 * a passage that has since been re-translated or re-ingested shows the current
 * text here. An entry whose passage has gone is shown as missing, with a reason,
 * because a list that silently shortens is indistinguishable from data loss.
 *
 * There is no account. The identity is an anonymous cookie, so this page is
 * specific to this browser and clearing cookies empties it. That is stated here
 * rather than hidden, and it is why the citation export is the more durable
 * artefact: it survives outside the app.
 */
function LibraryView() {
  const t = useTranslations('library');
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useLibraryStore((s) => s.load);
  const keys = useLibraryStore((s) => s.keys);

  const fetchEntries = useCallback(async () => {
    try {
      const { entries: list } = await api.library();
      setEntries(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // The store is the source of truth for the save buttons, so it has to be
    // populated before the list renders, or every button reads as "not saved".
    void Promise.all([load(), fetchEntries()]);
  }, [load, fetchEntries]);

  // Re-read when the save set changes elsewhere, so removing from here and
  // removing from a passage page are the same page afterwards.
  useEffect(() => {
    if (entries) void fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.length]);

  const remove = async (passageKey: string) => {
    await useLibraryStore.getState().toggle(passageKey);
    setEntries((current) => current?.filter((e) => e.passageKey !== passageKey) ?? null);
  };

  return (
    <Page wide>
      <PageHeader title={t('title')} description={t('description')} />

      <p className="mb-8 rounded-lg border border-line bg-panel/40 px-3 py-2 text-xs leading-relaxed text-fg-muted">
        {t('noAccount')}
      </p>

      {error ? <p className="text-sm text-fg-muted">{t('loadFailed')}</p> : null}
      {!entries && !error ? <p className="text-sm text-fg-muted">{t('loading')}</p> : null}

      {entries && entries.length === 0 ? (
        <Empty icon={Bookmark} title={t('empty')}>
          {t('emptyBody')}
        </Empty>
      ) : null}

      <ul className="space-y-4">
        {(entries ?? []).map((entry) => {
          const href = `/passage/${entry.passageKey.split(':').map(encodeURIComponent).join('/')}`;

          if (!entry.passage) {
            return (
              <li key={entry.passageKey} className="rounded-xl border border-dashed border-line p-4">
                <p className="text-sm text-fg-muted">{t('missing', { key: entry.passageKey })}</p>
                <button
                  type="button"
                  onClick={() => void remove(entry.passageKey)}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-fg-faint hover:text-fg"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('remove')}
                </button>
              </li>
            );
          }

          const passage = entry.passage;
          return (
            <li key={entry.passageKey} className="rounded-xl border border-line bg-panel/30 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">
                  {getTextLabel(passage.textId)}
                </span>
                <Link href={href} className="font-medium hover:underline">
                  {passage.book} {passage.chapter}:{passage.verse}
                </Link>
                <span className="ms-auto text-fg-faint">
                  {new Date(entry.savedAt).toLocaleDateString()}
                </span>
              </div>

              {passage.originalText ? (
                <p className="mt-2 text-[15px] leading-relaxed" dir={(passage.metadata.language === 'hebrew' || passage.metadata.language === 'aramaic') ? 'rtl' : 'ltr'}>
                  {passage.originalText}
                </p>
              ) : null}

              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{passage.translation}</p>

              <div className="mt-3 flex flex-wrap items-start gap-3">
                <CopyCitation passage={passage} className="min-w-0 flex-1" />
                <div className="flex items-center gap-1.5">
                  <Link
                    href={href}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-fg-muted hover:bg-panel"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('open')}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void remove(entry.passageKey)}
                    aria-label={t('remove')}
                    title={t('remove')}
                    className="icon-btn"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryView />
    </Suspense>
  );
}
