'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ArrowLeft, Info, Users } from 'lucide-react';
import { Page, PageHeader, Empty } from '@/components/Shell';
import { getTextChipClass } from '@/lib/utils';
import { api } from '@/lib/api';
import type { Figure } from '@ilm/shared';

/**
 * One person, named across traditions.
 *
 * The relation is not this product's opinion. The Quran makes it — at 3:45 and 4:171
 * it names Isa as "the Messiah, Jesus the son of Mary" — so the page opens by linking
 * those two verses rather than asserting anything itself.
 *
 * What the columns add is that the same person is called عيسى in the Quran, Ἰησοῦς in
 * the Gospels and يسوع in the hadith. That is most of what is interesting about a
 * cross-tradition figure and a plain "related passages" edge would have thrown it
 * away, so the forms are shown rather than only the counts.
 *
 * Two things the page is careful about:
 *
 * The counts carry their unit, because the corpora are not measured alike — the
 * Quran is one passage per surah, the New Testament one per verse — and "26" beside
 * "963" would otherwise read as a comparison it cannot support.
 *
 * The corpora left out say why. The Old Testament is the sharpest case: searching
 * the Hebrew for the Talmudic form returns 121 passages, every one of them Joshua
 * son of Jozadak, who is spelled identically. Leaving that gap unexplained on a page
 * about Jesus would invite the reader to conclude something untrue.
 */

function CorpusColumn({ corpus }: { corpus: Figure['corpora'][number] }) {
  const t = useTranslations('figure');

  return (
    <section className="min-w-0 flex-1">
      <header className="mb-2 border-b border-line pb-2">
        <span className={getTextChipClass(corpus.textId)}>{corpus.name}</span>
        <p className="mt-1.5 font-mono text-[13px] text-fg">
          {corpus.mentions.toLocaleString()}{' '}
          <span className="text-fg-faint">
            {corpus.mentions === 1 ? t('mention') : t('mentions')} · {corpus.unit}
          </span>
        </p>
        {corpus.forms.length > 0 ? (
          <p className="mt-1 text-[12px] text-fg-muted" dir="auto">
            {corpus.forms.join(' · ')}
          </p>
        ) : null}
      </header>

      <ul className="space-y-3">
        {corpus.sample.map((p) => (
          <li key={p.passageKey}>
            <Link
              href={`/passage/${p.passageKey.split(':').map(encodeURIComponent).join('/')}`}
              className="ref text-[13px] hover:underline"
            >
              {p.book} {p.chapter}:{p.verse}
            </Link>
            <p className="mt-0.5 text-[13px] leading-relaxed text-fg">
              {p.text.length > 200 ? `${p.text.slice(0, 200)}…` : p.text}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FigureDetail({ slug }: { slug: string }) {
  const t = useTranslations('figure');
  const [data, setData] = useState<Figure | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .figure(slug)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : t('loadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, t]);

  if (error) return <Empty title={t('loadFailed')}>{error}</Empty>;
  if (!data) return <div className="skeleton h-32 w-full" />;

  return (
    <>
      <PageHeader title={data.name} description={t('description')} />

      {/*
          The basis, before anything else on the page. If the identification is going
          to be shown at all it should arrive with the passage that makes it, and not
          as an assertion the product is making on the corpus's behalf.
      */}
      {data.basis.identification ? (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2.5 text-[12px] leading-relaxed text-fg-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
          <span>
            {t('basisPrefix')}{' '}
            {(data.basis.passageKeys ?? []).map((key, i) => (
              <span key={key}>
                {i > 0 ? ', ' : ''}
                <Link
                  href={`/passage/${key.split(':').map(encodeURIComponent).join('/')}`}
                  className="text-accent underline underline-offset-2"
                >
                  {key.replace(/:/g, ' ')}
                </Link>
              </span>
            ))}
            {' — '}
            {data.basis.identification}
          </span>
        </p>
      ) : null}

      <p className="mb-5 text-[12px] text-fg-faint">
        {t('total', { count: data.totalMentions.toLocaleString() })}
      </p>

      {data.absent.length > 0 ? (
        <div className="mb-6 space-y-2">
          {data.absent.map((a) => (
            <p
              key={a.textId}
              className="rounded-lg border border-line bg-raised px-3 py-2.5 text-[12px] leading-relaxed text-fg-muted"
            >
              <strong className="font-medium text-fg">{a.name}</strong> — {a.reason}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-5">
        {data.corpora.map((corpus) => (
          <CorpusColumn key={corpus.textId} corpus={corpus} />
        ))}
      </div>
    </>
  );
}

function FigureInner() {
  const { slug } = useParams<{ slug: string }>();
  const t = useTranslations('figure');

  return (
    <Page>
      <div className="mb-4">
        <Link href="/topics" className="btn btn-secondary">
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Link>
      </div>
      <FigureDetail slug={String(slug)} />
    </Page>
  );
}

export default function FigurePage() {
  return (
    <Suspense fallback={<div className="skeleton h-32 w-full" />}>
      <FigureInner />
    </Suspense>
  );
}
