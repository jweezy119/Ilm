import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { Page, PageHeader } from '@/components/Shell';
import { supportUrl } from '@/lib/support';

/**
 * How a reader keeps the servers running.
 *
 * Like the contact page, this page refuses to invent a destination: a support
 * button pointing at nobody configured is worse than saying plainly that this
 * deployment has no link yet. Supporting Ilm never changes what a search
 * returns — no accounts, no tiers, no different answers.
 */
export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('support');
  const url = supportUrl();

  const sections: Array<[string, string]> = [
    [t('whyTitle'), t('whyBody')],
    [t('whatTitle'), t('whatBody')],
  ];

  return (
    <Page>
      <PageHeader title={t('title')} description={t('intro')} />

      <div className="max-w-[68ch] space-y-6 text-[15px] leading-relaxed text-fg-muted">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white underline-offset-4 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('button')}
          </a>
        ) : (
          <p className="text-[13px] text-amber-700 dark:text-amber-400">{t('notConfigured')}</p>
        )}

        {sections.map(([heading, body]) => (
          <section key={heading}>
            <h2 className="font-medium text-fg">{heading}</h2>
            <p className="mt-1.5">{body}</p>
          </section>
        ))}
      </div>
    </Page>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('support');
  return { title: t('title'), robots: { index: false, follow: true } };
}
