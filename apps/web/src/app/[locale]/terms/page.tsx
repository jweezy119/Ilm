import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { Page, PageHeader } from '@/components/Shell';
import { ContactLink } from '@/components/ContactLink';

async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('legal.terms');
  const n = await getTranslations('nav');

  const sections: Array<[string, string]> = [
    [t('useTitle'), t('useBody')],
    [t('accuracyTitle'), t('accuracyBody')],
    [t('quoteTitle'), t('quoteBody')],
  ];

  return (
    <Page>
      <PageHeader title={t('title')} description={t('intro')} action={<a href={`/${locale}/privacy`} className="text-sm text-fg-muted underline underline-offset-4">{n('privacy')}</a>} />
      <div className="max-w-[68ch] space-y-6 text-[15px] leading-relaxed text-fg-muted">
        {sections.map(([heading, body]) => (
          <section key={heading}>
            <h2 className="font-medium text-fg">{heading}</h2>
            <p className="mt-1.5">{body}</p>
          </section>
        ))}
        <section className="border-t border-line pt-4 dark:border-white/10">
          <h2 className="font-medium text-fg">{n('contact')}</h2>
          <p className="mt-1.5">{t('contact')}</p>
          <ContactLink />
        </section>
      </div>
    </Page>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('legal.terms');
  return { title: t('title'), robots: { index: false, follow: true } };
}

export default TermsPage;