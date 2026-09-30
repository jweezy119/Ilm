import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { Page, PageHeader } from '@/components/Shell';

/**
 * The privacy policy and the terms, as one page with a toggle.
 *
 * These exist because Google Play will not review the app without a public URL for
 * each, and because an app that sends a reader's search queries to a third-party
 * service ought to say so in plain words before it does rather than in a document
 * they will not read.
 *
 * The content is in the message files so it is translated like everything else,
 * because a privacy policy a Hebrew-speaking reader cannot read is not disclosure.
 * It states what actually happens: no accounts, reading state in local storage,
 * search queries logged server-side, and the query text sent to Jev.
 *
 * Not a substitute for review by a lawyer in the jurisdictions you operate in. That
 * sentence is not in the policy itself — a policy that hedges about its own validity
 * is worse than one that does not.
 */

async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('legal.privacy');
  const n = await getTranslations('nav');

  const sections: Array<[string, string]> = [
    [t('readTitle'), t('readBody')],
    [t('searchTitle'), t('searchBody')],
    [t('thirdPartyTitle'), t('thirdPartyBody')],
  ];

  return (
    <Page>
      <PageHeader title={t('title')} description={t('intro')} action={<a href={`/${locale}/terms`} className="text-sm text-fg-muted underline underline-offset-4">{n('terms')}</a>} />
      <div className="max-w-[68ch] space-y-6 text-[15px] leading-relaxed text-fg-muted">
        {sections.map(([heading, body]) => (
          <section key={heading}>
            <h2 className="font-medium text-fg">{heading}</h2>
            <p className="mt-1.5">{body}</p>
          </section>
        ))}
        <section className="border-t border-line pt-4 dark:border-white/10">
          <p>{t('noSell')}</p>
        </section>
        <section>
          <h2 className="font-medium text-fg">{n('contact')}</h2>
          <p className="mt-1.5">{t('rights')}</p>
        </section>
        <p className="text-[13px] text-fg-faint">{t('changes')}</p>
      </div>
    </Page>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('legal.privacy');
  // Kept out of search results. Not a secret page — the policy has to be reachable —
  // but it is not content anyone searches for.
  return { title: t('title'), robots: { index: false, follow: true } };
}

export default PrivacyPage;