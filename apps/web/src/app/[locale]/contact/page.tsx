import type { Metadata } from 'next';
import { Mail } from 'lucide-react';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { Page, PageHeader } from '@/components/Shell';

/**
 * Where a reader can actually reach someone.
 *
 * This page exists because the privacy policy promises a deletion mechanism and had
 * none. Both legal pages ended with a section telling a reader to get in touch, and
 * the heading rendered as nothing at all — a missing translation key returns an
 * empty string rather than a visible placeholder, so the section vanished and what
 * remained was a paragraph about deleting a search log with no way to ask. A privacy
 * policy is only a disclosure if the mechanism it names exists, and GDPR and CCPA
 * both turn on that rather than on the prose.
 *
 * Three kinds of message, because they are genuinely different and a single address
 * hides that. A wrong passage reference is the one that matters most here: Ilm cites
 * scripture, and a citation that points at the wrong verse is a claim about what a
 * text says. Everything else in this app is built so that a reader can check it, and
 * a wrong reference defeats that entirely.
 *
 * One address and no form. A contact form needs an endpoint that delivers mail, and
 * a form that silently fails is worse than an address a reader can see, copy and
 * use in whatever client they already trust.
 */

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('contact');

  const address = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@example.com';

  const sections: Array<[string, string]> = [
    [t('correctionsTitle'), t('correctionsBody')],
    [t('privacyTitle'), t('privacyBody')],
    [t('securityTitle'), t('securityBody')],
  ];

  return (
    <Page>
      <PageHeader title={t('title')} description={t('intro')} />

      <div className="max-w-[68ch] space-y-6 text-[15px] leading-relaxed text-fg-muted">
        <section>
          <h2 className="font-medium text-fg">{t('addressLabel')}</h2>
          <a
            href={`mailto:${address}`}
            className="mt-1.5 inline-flex items-center gap-2 text-accent underline underline-offset-4"
          >
            <Mail className="h-3.5 w-3.5" />
            {address}
          </a>
          {/*
              Shown in the app rather than only in the source, because a placeholder
              address that reaches a reader is a message nobody will receive and a
              privacy request nobody will act on. It disappears once
              NEXT_PUBLIC_CONTACT_EMAIL is set.
          */}
          {address === 'hello@example.com' ? (
            <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-400">{t('addressNote')}</p>
          ) : null}
        </section>

        {sections.map(([heading, body]) => (
          <section key={heading}>
            <h2 className="font-medium text-fg">{heading}</h2>
            <p className="mt-1.5">{body}</p>
          </section>
        ))}

        <section className="border-t border-line pt-4 dark:border-white/10">
          <h2 className="font-medium text-fg">{t('responseTitle')}</h2>
          <p className="mt-1.5">{t('responseBody')}</p>
        </section>
      </div>
    </Page>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('contact');
  return { title: t('title'), robots: { index: false, follow: true } };
}