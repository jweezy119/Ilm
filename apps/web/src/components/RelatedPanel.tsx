'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ArrowRight, Quote, Sparkles, Bookmark, Layers, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { getTextLabel } from '@/lib/utils';
import type { RelatedPassages, RelatedPassage } from '@ilm/shared';

/**
 * What else on the site is about this passage.
 *
 * Three relation families, previously in three places, each of which answered a
 * third of the question: verbatim citation, model-detected relation, shared theme.
 * They are here together because the useful question is one question, and they
 * are kept in separate groups because they are not the same kind of finding.
 *
 * The grouping *is* the honesty. An eleven-word run shared with Ezekiel is
 * arithmetic over the stored texts, and a reader can check it by looking at the
 * other verse. A shared theme is a keyword classifier's opinion about a tag.
 * Ranked in one column without saying which was which, the first would silently
 * lend its authority to the third — which is the failure this product exists to
 * avoid, and the reason the app labels the source of every score.
 *
 * Nothing here says who quotes whom. The stored direction is bidirectional on
 * purpose: verse order is per-corpus, so there is no shared ordering that would
 * tell a later passage from an earlier one.
 */

const GROUPS: Array<{ kind: RelatedPassage['kind']; icon: typeof Quote }> = [
  { kind: 'verbatim', icon: Quote },
  { kind: 'relation', icon: Sparkles },
  { kind: 'theme', icon: Bookmark },
];

/**
 * Which figures this passage names, offered above the relations.
 *
 * A cross-tradition figure is not a relation between two passages, so it does not
 * belong in the three relation groups below — it is the same person appearing under
 * four names, which is a different kind of claim and needs its own surface. Placed
 * first because a verse that names the figure is where a reader is most likely to
 * want to see it.
 */
export function FigureNotice({ passageId }: { passageId: string }) {
  const t = useTranslations('figure');
  const [figures, setFigures] = useState<Array<{ slug: string; name: string; form: string; stance: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .passageFigures(passageId)
      .then((r) => {
        if (!cancelled) setFigures(r.figures);
      })
      // Silent on failure. A notice that cannot be fetched should leave the page as
      // it was, not show an error where nothing was wrong.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [passageId]);

  if (figures.length === 0) return null;

  return (
    <section className="mb-6">
      {figures.map((f) => (
        <Link
          key={f.slug}
          href={`/figure/${f.slug}`}
          className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2.5 text-[13px] transition-colors hover:border-accent/50"
        >
          <Users className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
          <span className="text-fg-muted">
            {t('notice', { name: f.name, form: f.form })}
          </span>
          <ArrowRight className="ms-auto h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />
        </Link>
      ))}
    </section>
  );
}

export function RelatedPanel({ passageId }: { passageId: string }) {
  const t = useTranslations('related');
  const [data, setData] = useState<RelatedPassages | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .related(passageId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        // Most passages have no related passages at all, and a missing panel is
        // not an error worth shouting about on a page whose point is the passage.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [passageId]);

  if (failed || !data || data.empty) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-1 text-sm font-medium">{t('title')}</h2>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">{t('explain')}</p>

      <div className="space-y-5">
        {GROUPS.map(({ kind, icon: Icon }) => {
          const rows = data.byKind[kind];
          if (!rows || rows.length === 0) return null;
          return (
            <div key={kind}>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-fg-faint">
                <Icon className="h-3 w-3" />
                {t(`kinds.${kind}.heading`, { count: rows.length })}
              </div>
              <ul className="space-y-2">
                {rows.map((row) => (
                  <Row key={`${row.passageKey}-${kind}`} row={row} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Row({ row }: { row: RelatedPassage }) {
  const t = useTranslations('related');
  const href = `/passage/${row.passageKey.split(':').map(encodeURIComponent).join('/')}`;

  return (
    <li className="rounded-lg border border-line bg-panel/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Link href={href} className="font-medium hover:underline">
          {row.book} {row.chapter}:{row.verse}
        </Link>
        <span className="rounded-full bg-panel px-1.5 py-0.5 text-[10px] text-fg-faint">
          {getTextLabel(row.textId, true)}
        </span>

        {/*
          The relation, and who says so. `ngram` means the words are literally
          identical; `jev` means a model judged it; `derived` means a keyword
          classifier tagged both passages. Three different claims.
        */}
        <span
          className="rounded-full bg-panel px-1.5 py-0.5 text-[10px] text-fg-muted"
          title={t(`kinds.${row.kind}.sourceTitle`, { source: row.source })}
        >
          {t(`kinds.${row.kind}.relation.${row.relation === 'shared_theme' ? 'shared_theme' : row.relation}`)}
        </span>

        <span className="ms-auto tabular-nums text-fg-faint">{Math.round(row.strength * 100)}%</span>
      </div>

      {/* The shared words, for a verbatim match: the claim the reader can check
          without leaving the page. */}
      {row.sharedText ? (
        <p className="mt-1.5 text-[13px] leading-relaxed" dir="ltr">
          <span className="bg-accent-soft text-accent">“{row.sharedText}”</span>
        </p>
      ) : null}

      {row.preview ? (
        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-fg-muted">{row.preview}</p>
      ) : null}

      {row.sharedTheme ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-fg-faint">
          <Layers className="h-3 w-3" />
          {row.sharedTheme.replace(/_/g, ' ')}
        </p>
      ) : null}
    </li>
  );
}
