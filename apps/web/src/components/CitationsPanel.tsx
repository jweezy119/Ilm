'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Quote, Layers } from 'lucide-react';
import { api } from '@/lib/api';
import { getTextLabel } from '@/lib/utils';
import type { CitationGroup, PassageCitations } from '@ilm/shared';

/**
 * Citations: the other texts that say these same words.
 *
 * This is the cross-corpus half of the cross-reference data, on its own. The
 * mixed list on the passage page ranks a quotation next to a shared theme next to
 * a book agreeing with itself, and the most confident-looking entries are usually
 * the least interesting.
 *
 * **Nothing here says who quotes whom.** The stored direction is bidirectional
 * because verse order is per-corpus, so there is no shared ordering that would
 * distinguish a later passage from an earlier one. The copy says "the same words
 * appear in" and links both ways, because claiming lineage from an unordered pair
 * of n-gram matches is the kind of mistake that makes a reader distrust every
 * other number on the page.
 *
 * The shared words are shown, because "these texts share a 12-word run" is
 * checkable and "these texts are related" is not. That is the whole point of the
 * app, and it is the reason the matched string is stored at all.
 */
export function CitationsPanel({ passageId, passageKey }: { passageId: string; passageKey: string }) {
  const t = useTranslations('citations');
  const [data, setData] = useState<PassageCitations | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .citations(passageId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        // A missing citation list is not an error worth shouting about: most
        // passages have none, and the passage itself is the point of the page.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [passageId]);

  if (failed || !data || data.total === 0) return null;

  return (
    <section className="mt-8">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <Quote className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-medium">{t('title', { count: data.total })}</h2>
      </header>

      {/* What kind of claim this is, stated before the list rather than implied
          by it. */}
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">{t('explain')}</p>

      <div className="space-y-5">
        {data.groups.map((group) => (
          <Group key={group.textId} group={group} />
        ))}
      </div>
    </section>
  );
}

function Group({ group }: { group: CitationGroup }) {
  const t = useTranslations('citations');
  const passageHref = (key: string) => `/passage/${key.split(':').map(encodeURIComponent).join('/')}`;

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-fg-faint">
        <Layers className="h-3 w-3" />
        {t('inCorpus', { corpus: getTextLabel(group.textId), count: group.count })}
      </div>

      <ul className="space-y-2">
        {group.members.map((member) => (
          <li key={member.passageId} className="rounded-lg border border-line bg-panel/40 px-3 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
              <Link href={passageHref(member.passageKey)} className="font-medium hover:underline">
                {member.book} {member.chapter}:{member.verse}
              </Link>
              <span className="text-fg-faint">
                {t('run', { words: member.longestRun })}
              </span>
              <span className="ms-auto tabular-nums text-fg-faint">{Math.round(member.strength * 100)}%</span>
            </div>

            {/* The shared words, and then the same words in the other passage's
                own context. A reader can check the second against the first
                without leaving the page, which is the claim the app makes. */}
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg" dir="ltr">
              <span className="bg-accent-soft text-accent">“{member.sharedText}”</span>
            </p>
            {member.otherText && member.otherText !== member.sharedText ? (
              <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-fg-muted">{member.otherText}</p>
            ) : null}
            {member.sharedRuns.length > 1 ? (
              <p className="mt-1 text-[11px] text-fg-faint">{t('runs', { count: member.sharedRuns.length })}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
