'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ArrowLeft, Info } from 'lucide-react';
import { Page, PageHeader, Empty } from '@/components/Shell';
import { SourceBadge, type DisplaySource } from '@/components/SourceBadge';
import { api } from '@/lib/api';
import { getTextChipClass, getScriptFont } from '@/lib/utils';
import type { ThemeComparison } from '@ilm/shared';

/**
 * One theme, one column per tradition.
 *
 * The whole point is that the columns are beside each other, so a difference is
 * visible by looking rather than inferred from a ranked list. Everything here is
 * therefore in service of keeping the texts readable and the provenance visible:
 * a column says which corpus it is, how many passages that corpus holds above the
 * bar, and whether a model or the local classifier scored them.
 *
 * What the page deliberately does not do is describe what the passages mean. A
 * comparison that wrote a sentence about each tradition would be commentary, and it
 * would be commentary written by a product that has no standing to write it. The
 * reader gets the texts and the reference and the rest is theirs.
 *
 * The bar is on the page because it decides which columns exist. Hidden, an absent
 * column would read as a silence in the tradition rather than as a classifier that
 * did not label anything strongly enough.
 */

/*
 * The steps are the distinct score levels the data actually takes, not an arbitrary
 * grid. Theme scores come in twenty values and cluster hard — 24,332 labels sit at
 * exactly 0.20, 31,125 at 0.15 — so a slider with 0.01 steps would move without
 * changing anything and read as broken. A select over the real levels can only
 * produce a result that differs from its neighbour.
 */
const BAR_STEPS = [0.1, 0.15, 0.2, 0.24, 0.3, 0.32, 0.35, 0.4];

function Bar({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useTranslations('compare');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="compare-bar" className="text-xs text-fg-faint">
        {t('bar')}
      </label>
      <select
        id="compare-bar"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border border-line bg-raised px-2 py-1 text-xs"
      >
        {BAR_STEPS.map((s) => (
          <option key={s} value={s}>
            {t('atLeast', { score: s.toFixed(2) })}
          </option>
        ))}
      </select>
    </div>
  );
}

function Column({ column }: { column: ThemeComparison['columns'][number] }) {
  return (
    <section className="min-w-0 flex-1">
      <header className="mb-2 flex items-center gap-2 border-b border-line pb-2">
        <span className={getTextChipClass(column.textId)}>{column.name}</span>
        <span className="ms-auto text-[11px] text-fg-faint tabular-nums">
          {column.total.toLocaleString()}
        </span>
      </header>

      <ul className="space-y-3">
        {column.passages.map((p) => (
          <li key={p.passageKey}>
            <div className="mb-1 flex items-baseline gap-2">
              <Link
                href={`/passage/${p.passageKey.split(':').map(encodeURIComponent).join('/')}`}
                className="ref truncate hover:underline"
              >
                {p.book} {p.chapter}:{p.verse}
              </Link>
              <SourceBadge source={p.source as DisplaySource} className="px-1 py-0.5 text-[10px]" />
              <span className="ms-auto font-mono text-[11px] text-fg-faint tabular-nums">
                {p.score.toFixed(2)}
              </span>
            </div>

            {p.originalText ? (
              <p
                dir={column.direction}
                className={`mb-1 text-[13px] leading-relaxed text-fg-muted ${getScriptFont(p.language)}`}
              >
                {p.originalText.length > 160 ? `${p.originalText.slice(0, 160)}…` : p.originalText}
              </p>
            ) : null}

            <p className="text-[13px] leading-relaxed text-fg">
              {p.text.length > 220 ? `${p.text.slice(0, 220)}…` : p.text}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Comparison({ slug, bar, onBar }: { slug: string; bar: number; onBar: (v: number) => void }) {
  const t = useTranslations('compare');
  const [data, setData] = useState<ThemeComparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);

    api
      .themeCompare(slug, { bar })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : t('loadFailed'));
      });

    return () => {
      cancelled = true;
    };
  }, [slug, bar, t]);

  if (error) return <Empty title={t('loadFailed')}>{error}</Empty>;
  if (!data) return <div className="skeleton h-32 w-full" />;

  const floor = data.scoreLevels.length > 0 ? data.scoreLevels[0] : data.bar;

  return (
    <>
      <PageHeader title={data.label} description={t('description')} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Bar value={bar} onChange={onBar} />
        <span className="text-[11px] text-fg-faint">
          {t('levels', { levels: data.scoreLevels.map((s) => s.toFixed(2)).join(', ') })}
        </span>
      </div>

      {/*
          Why columns can be missing, stated before the reader notices a gap.

          A comparison page is where "the Talmud does not discuss justice" gets
          invented without anyone deciding to say it — the column is simply not
          there. It is absent because no passage scored above the bar, which is a
          fact about a keyword classifier and says nothing whatever about the
          tradition.
      */}
      {data.absent.length > 0 ? (
        <p className="mb-5 flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2.5 text-[12px] leading-relaxed text-fg-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
          <span>
            {t('absentPrefix')}{' '}
            <strong className="font-medium text-fg">{data.absent.map((a) => a.name).join(', ')}</strong>
            {' — '}
            {t('absentSuffix', { floor: floor.toFixed(2) })}
          </span>
        </p>
      ) : null}

      {data.columns.length === 0 ? (
        <Empty title={t('noColumnsTitle')}>{t('noColumnsBody', { floor: floor.toFixed(2) })}</Empty>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-5">
          {data.columns.map((column) => (
            <Column key={column.textId} column={column} />
          ))}
        </div>
      )}
    </>
  );
}

function CompareInner() {
  const { slug } = useParams<{ slug: string }>();
  const [bar, setBar] = useState(0.2);
  const t = useTranslations('compare');

  // Held here and passed down, so the bar the page states and the bar the data was
  // fetched with cannot disagree. An earlier version had a visible control holding
  // its own state and a hidden one driving the fetch, which meant the control the
  // reader could see changed nothing at all.
  const onBar = useCallback((value: number) => setBar(value), []);

  return (
    <Page>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/topics" className="btn btn-secondary">
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Link>
      </div>
      <Comparison slug={String(slug)} bar={bar} onBar={onBar} />
    </Page>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="skeleton h-32 w-full" />}>
      <CompareInner />
    </Suspense>
  );
}