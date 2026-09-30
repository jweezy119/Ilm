'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ArrowLeft, Scale, Search } from 'lucide-react';
import { Page, PageHeader, Empty } from '@/components/Shell';
import { SourceBadge, type DisplaySource } from '@/components/SourceBadge';
import { api } from '@/lib/api';
import { TEXT_IDS, getTextLabel } from '@/lib/utils';
import type { ThemeJourneyStep, Topic } from '@ilm/shared';

/** The API adds `passageKey`, which the shared schema does not declare. */
type Step = ThemeJourneyStep & { passageKey: string };

/**
 * One topic: its facets, then its strongest passages grouped by corpus.
 *
 * The passage groups come from the existing theme-journey endpoint, so this is a
 * presentation of data the app already has rather than a second ranking system
 * that could disagree with the first. The order within each corpus is that
 * corpus's own sequence, which is the only order a Quran verse and a Genesis
 * verse can share.
 *
 * Facets are the useful part. They are real searches, so they carry real scores
 * and real source labels, and clicking one leaves this page for the search page
 * rather than pretending to be a filter over it.
 */

function passageHref(step: Step): string {
  return `/passage/${step.passageKey.split(':').map(encodeURIComponent).join('/')}`;
}

function TopicView() {
  const t = useTranslations('topics');
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';

  const [topic, setTopic] = useState<Topic | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const all = await api.topics();
      const found = all.topics.find((x) => x.slug === slug);
      if (cancelled) return;
      if (!found) {
        setMissing(true);
        return;
      }
      setTopic(found);

      const journey = await api.journey(found.theme, 60);
      if (!cancelled) setSteps(journey.journey);
    };

    load().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Bucketed by corpus, in the order the corpora are conventionally given.
  const byText = (steps ?? []).reduce<Record<string, Step[]>>((acc, step) => {
    (acc[step.textId] ??= []).push(step);
    return acc;
  }, {});
  for (const list of Object.values(byText)) {
    list.sort((a, b) => a.chronologicalOrder - b.chronologicalOrder);
  }

  if (missing) {
    return (
      <Page>
        <Empty icon={Search} title={t('unknown')}>
          {t('unknownBody')}
        </Empty>
      </Page>
    );
  }

  return (
    <Page wide>
      <Link href="/topics" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" />
        {t('allTopics')}
      </Link>

      <PageHeader
        title={topic ? t(`items.${topic.slug}.label`) : t('loading')}
        description={topic ? t(`items.${topic.slug}.blurb`) : undefined}
        action={
          topic ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-faint">
              <span className="tabular-nums">{t('passages', { count: topic.passages })}</span>
              <span className="tabular-nums">{t('books', { count: topic.books })}</span>
              <span className="tabular-nums">{t('texts', { count: topic.corpora.length })}</span>
            </div>
          ) : undefined
        }
      />

      {error ? <p className="text-sm text-fg-muted">{error}</p> : null}

      {/*
          The comparison, offered from the topic page because this is where a reader
          is already thinking about one subject across texts. The passages on a topic
          page are all one tradition, which is the thing the comparison exists to put
          beside something else.
      */}
      {topic ? (
        <Link
          href={`/compare-theme/${encodeURIComponent(topic.theme)}`}
          className="mb-8 inline-flex items-center gap-2 rounded-lg border border-line bg-panel/50 px-3 py-2 text-[13px] transition-colors hover:border-accent/50 hover:bg-panel"
        >
          <Scale className="h-4 w-4 text-fg-faint" />
          {t('compareAcross', { topic: t(`items.${topic.slug}.label`) })}
        </Link>
      ) : null}

      {/* Facets. Each is a search, so each says what it will search for rather
          than presenting itself as a section of this page. */}
      {topic ? (
        <div className="mb-10">
          <h2 className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-fg-faint">
            {t('askWithin', { topic: t(`items.${topic.slug}.label`) })}
          </h2>
          <div className="flex flex-wrap gap-2">
            {topic.facets.map((facet) => (
              <Link
                key={facet.id}
                href={`/?q=${encodeURIComponent(facet.query)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel/50 px-3 py-1.5 text-[13px] text-fg transition-colors hover:border-accent/50 hover:bg-panel"
              >
                <Search className="h-3.5 w-3.5 text-fg-faint" />
                {t(`items.${topic.slug}.facets.${facet.id}`)}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {!steps && !error && !missing ? <p className="text-sm text-fg-muted">{t('loading')}</p> : null}

      {steps && steps.length === 0 ? (
        <Empty icon={Search} title={t('noPassages')}>
          {t('noPassagesBody')}
        </Empty>
      ) : null}

      {steps
        ? TEXT_IDS.filter((textId) => byText[textId]?.length).map((textId) => (
            <section key={textId} className="mb-9">
              <h2 className="mb-2.5 text-sm font-medium">{getTextLabel(textId)}</h2>
              <ul className="space-y-1.5">
                {byText[textId].map((step) => (
                  <li key={step.passageKey}>
                    <Link
                      href={passageHref(step)}
                      className="block rounded-lg px-3 py-2 transition-colors hover:bg-panel/60"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium">
                          {step.book} {step.chapter}:{step.verse}
                        </span>
                        {step.source ? <SourceBadge source={step.source as DisplaySource} /> : null}
                        <span className="ms-auto tabular-nums text-fg-faint">
                          {Math.round(step.score * 100)}%
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-fg-muted">{step.preview}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        : null}
    </Page>
  );
}

export default function TopicPage() {
  return (
    <Suspense fallback={null}>
      <TopicView />
    </Suspense>
  );
}
