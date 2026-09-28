'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Compass, ArrowLeft, Layers } from 'lucide-react';
import { Page, PageHeader, Empty } from '@/components/Shell';
import { SourceBadge, type DisplaySource } from '@/components/SourceBadge';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { TEXT_IDS, getTextLabel } from '@/lib/utils';
import type { JourneyGroup, PassageJourney, TextId } from '@ilm/shared';

/**
 * The journey view: one passage, then outward through the themes it carries.
 *
 * The passage page answers "what links to this verse" with a flat list of at most
 * eight detected references. This answers the other question — "what is this
 * verse about, and where else do the texts say that" — by grouping passages by the
 * theme they share with the one you were reading. A group is a context, and its
 * members come from different books, usually from different corpora.
 *
 * Deliberately no commentary. A group is named by its theme id, which is a row in
 * the themes table, and every member shows its own score and where that score came
 * from. If a group is only one book agreeing with itself, it says so rather than
 * presenting it as a connection between traditions.
 */

function JourneySkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1, 2].map((g) => (
        <div key={g} className="animate-pulse">
          <div className="mb-3 h-5 w-40 rounded bg-panel" />
          <div className="space-y-2">
            {[0, 1, 2].map((m) => (
              <div key={m} className="h-16 rounded-xl border border-line bg-panel/40" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MemberRow({ member }: { member: JourneyGroup['members'][number] }) {
  return (
    <Link
      href={`/passage/${member.passageKey.split(':').map(encodeURIComponent).join('/')}`}
      className="block rounded-xl border border-line bg-panel/40 px-4 py-3 transition-colors hover:border-accent/50 hover:bg-panel"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">
          {getTextLabel(member.textId)}
        </span>
        <span className="font-medium text-fg">
          {member.book} {member.chapter}:{member.verse}
        </span>
        <SourceBadge source={member.source as DisplaySource} />
        <span className="ms-auto tabular-nums text-fg-muted">{percent(member.score)}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-fg-muted">{member.preview}</p>
    </Link>
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function GroupSection({ group }: { group: JourneyGroup }) {
  const t = useTranslations('journey');

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium capitalize tracking-tight">{group.theme.replace(/_/g, ' ')}</h2>

        {/*
         * How many of the reader's own themes this is worth, and how far it
         * reached. Both are numbers from the database, not a judgement.
         */}
        <span className="rounded-full bg-panel px-2 py-0.5 text-xs text-fg-muted" title={t('sourceScore')}>
          {percent(group.sourceScore)} {t('onThisVerse')}
        </span>

        {group.crossText ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
            title={t('crossTextTitle', { corpora: group.corpora.map((c) => getTextLabel(c)).join(', ') })}
          >
            <Layers className="h-3 w-3" />
            {t('acrossCorpora', { count: group.corpora.length })}
          </span>
        ) : (
          <span className="rounded-full bg-panel px-2 py-0.5 text-xs text-fg-faint" title={t('singleCorpusTitle')}>
            {t('singleCorpus')}
          </span>
        )}
      </div>

      {group.category ? <p className="mb-2 text-xs uppercase tracking-wider text-fg-faint">{group.category.replace(/_/g, ' ')}</p> : null}

      <div className="space-y-2">
        {group.members.map((member) => (
          <MemberRow key={member.passageKey} member={member} />
        ))}
      </div>
    </section>
  );
}

function JourneyView() {
  const t = useTranslations('journey');
  const params = useSearchParams();
  const router = useRouter();
  const passageId = params.get('id');
  const textsParam = params.get('texts');

  const [journey, setJourney] = useState<PassageJourney | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // A corpus filter is part of the URL so a narrowed journey can be shared, and
  // survives a reload, the same way the reader's query params already do.
  const texts = (textsParam?.split(',').filter(Boolean) ?? []) as TextId[];

  const load = useCallback(async () => {
    if (!passageId) {
      setError(t('noPassage'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setJourney(await api.passageJourney(passageId, { texts }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failed'));
    } finally {
      setLoading(false);
    }
  }, [passageId, texts, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const toggleText = (textId: TextId) => {
    const next = texts.includes(textId) ? texts.filter((x) => x !== textId) : [...texts, textId];
    // router.push rather than window.location: the latter has no idea which
    // locale it is on and would drop the reader back to English.
    router.push({ pathname: '/journey', query: { ...(passageId ? { id: passageId } : {}), ...(next.length ? { texts: next.join(',') } : {}) } });
  };

  return (
    <Page wide>
      {journey ? (
        <Link
          href={`/passage/${journey.passageKey.split(':').map(encodeURIComponent).join('/')}`}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Link>
      ) : null}

      <PageHeader
        title={journey ? `${getTextLabel(journey.textId)} · ${journey.book} ${journey.chapter}:${journey.verse}` : t('title')}
        description={t('description')}
      />

      {/* Corpus filter. Narrowing is the point: "where else does the whole corpus
          say this" and "where does the Quran say this" are different questions and
          the answer to the second is buried in the first. */}
      <div className="mb-8 flex flex-wrap gap-2">
        {TEXT_IDS.map((textId) => {
          const on = texts.length === 0 || texts.includes(textId);
          return (
            <button
              key={textId}
              type="button"
              onClick={() => toggleText(textId)}
              aria-pressed={on}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                on ? 'bg-accent-soft text-accent' : 'bg-panel text-fg-faint hover:text-fg-muted'
              }`}
            >
              {getTextLabel(textId)}
            </button>
          );
        })}
      </div>

      {loading ? <JourneySkeleton /> : null}

      {!loading && error ? (
        <Empty icon={Compass} title={t('failed')}>
          {error}
        </Empty>
      ) : null}

      {!loading && !error && journey && journey.groups.length === 0 ? (
        <Empty icon={Compass} title={t('noThemes')}>
          {t('noThemesBody')}
        </Empty>
      ) : null}

      {!loading && journey
        ? journey.groups.map((group) => <GroupSection key={group.theme} group={group} />)
        : null}
    </Page>
  );
}

export default function JourneyPage() {
  return (
    <Suspense fallback={null}>
      <JourneyView />
    </Suspense>
  );
}
