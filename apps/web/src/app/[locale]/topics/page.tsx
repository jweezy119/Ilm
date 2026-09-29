'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Compass } from 'lucide-react';
import { Page, PageHeader } from '@/components/Shell';
import { api } from '@/lib/api';
import { getTextLabel } from '@/lib/utils';
import type { Topic } from '@ilm/shared';

/**
 * The quick links.
 *
 * `/explore` lists all 79 themes, which is a machine's view of the corpus: it
 * leads with `wisdom` and `righteousness` and includes four themes too thin to
 * read. This is a person's view — twelve subjects someone arrives looking for,
 * each labelled in the reader's language, each carrying the measured size of
 * what is behind it.
 *
 * The counts are on the card rather than hidden because the point of this page
 * is that a link is worth clicking. `1,146 passages · 108 books · 5 texts` is
 * also the fastest way to see that the traditions do not agree evenly on a
 * subject, which is the thing the app is for.
 */
export default function TopicsPage() {
  const t = useTranslations('topics');
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .topics()
      .then((data) => {
        if (!cancelled) setTopics(data.topics);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Page wide>
      <PageHeader title={t('title')} description={t('description')} />

      {error ? <p className="text-sm text-fg-muted">{error}</p> : null}
      {!topics && !error ? <p className="text-sm text-fg-muted">{t('loading')}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(topics ?? []).map((topic) => (
          <a
            key={topic.slug}
            href={`/topics/${topic.slug}`}
            className="group flex flex-col rounded-xl border border-line bg-panel/40 p-4 transition-colors hover:border-accent/50 hover:bg-panel"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-medium leading-snug">{t(`items.${topic.slug}.label`)}</h2>
              <ArrowRight className="h-4 w-4 shrink-0 text-fg-faint transition-transform group-hover:translate-x-0.5" />
            </div>

            <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">{t(`items.${topic.slug}.blurb`)}</p>

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-faint">
              <span className="tabular-nums">{t('passages', { count: topic.passages })}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{t('books', { count: topic.books })}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{t('texts', { count: topic.corpora.length })}</span>
            </div>

            {/* Which corpora actually contribute. Two traditions agreeing beats
                one tradition repeating itself, and this is the cheapest honest
                signal of which is happening. */}
            <div className="mt-2 flex flex-wrap gap-1">
              {topic.corpora.map((textId) => (
                <span key={textId} className="rounded-full bg-panel px-1.5 py-0.5 text-[10px] text-fg-faint">
                  {getTextLabel(textId, true)}
                </span>
              ))}
            </div>

            {/* Facet count, so a reader knows whether opening it narrows or
                widens what they are about to see. */}
            <div className="mt-2 flex items-center gap-1 text-[11px] text-fg-faint">
              <Compass className="h-3 w-3" />
              {t('facets', { count: topic.facets.length })}
            </div>
          </a>
        ))}
      </div>
    </Page>
  );
}
