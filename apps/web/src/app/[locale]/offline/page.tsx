import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { Page, PageHeader } from '@/components/Shell';

/**
 * The one page the service worker is allowed to serve without a network.
 *
 * It carries no data, no scores and no passage text. Its whole job is to say
 * plainly that the connection is gone and that the app will not guess what a
 * text says from a cached page. Every other page keeps going to the network.
 *
 * Kept as plain strings: passing an icon component from this server component
 * into the client `Empty` would cross the boundary as a function and fail.
 */
export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('offline');

  return (
    <Page>
      <PageHeader title={t('title')} description={t('description')} />
      <section className="card max-w-[68ch] p-5">
        <h2 className="text-sm font-medium">{t('emptyTitle')}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{t('emptyBody')}</p>
      </section>
    </Page>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('offline');
  return { title: t('title'), robots: { index: false, follow: false } };
}
