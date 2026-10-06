import type { Metadata } from 'next';
import { Coffee, CreditCard, ExternalLink, Heart, Wallet } from 'lucide-react';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { Page, PageHeader } from '@/components/Shell';
import { CopyableAddress } from '@/components/CopyableAddress';

/**
 * Supporting Ilm.
 *
 * Links out rather than embedding a checkout. A PayPal or Square button script
 * would need the CSP widened to their domains on every page, and a hosted link
 * opens the provider's own checkout — which is where a reader expects to type card
 * details anyway, and which Ilm then never touches.
 *
 * Each provider is configured by an environment variable and only rendered when
 * set. A donate button pointing at a placeholder is worse than no button: it is a
 * payment link that goes nowhere, on the one page where trust matters most.
 *
 * NEXT_PUBLIC_ variables are inlined at build time, so changing one needs a
 * rebuild, not just a restart.
 */

type Provider = {
  key: 'paypal' | 'square' | 'bmac';
  url: string | undefined;
  icon: typeof Heart;
};

/** Only https links to a payment page are rendered; anything else is ignored. */
function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'support' });
  return { title: t('metaTitle'), description: t('intro') };
}

export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('support');

  const providers: Provider[] = [
    { key: 'paypal', url: safeUrl(process.env.NEXT_PUBLIC_DONATE_PAYPAL_URL), icon: Wallet },
    { key: 'square', url: safeUrl(process.env.NEXT_PUBLIC_DONATE_SQUARE_URL), icon: CreditCard },
    { key: 'bmac', url: safeUrl(process.env.NEXT_PUBLIC_DONATE_BMAC_URL), icon: Coffee },
  ];
  const available = providers.filter((p) => p.url);
  const solanaAddress = process.env.NEXT_PUBLIC_DONATE_SOLANA_ADDRESS?.trim();

  return (
    <Page>
      <PageHeader title={t('title')} description={t('intro')} />

      <div className="max-w-[68ch] space-y-8 text-[15px] leading-relaxed text-fg-muted">
        <section>
          <h2 className="font-medium text-fg">{t('whereTitle')}</h2>
          <ul className="mt-2 list-disc space-y-1 ps-5">
            <li>{t('whereServers')}</li>
            <li>{t('whereModels')}</li>
            <li>{t('whereTexts')}</li>
          </ul>
        </section>

        <section aria-labelledby="support-options-heading">
          <h2 id="support-options-heading" className="font-medium text-fg">
            {t('optionsTitle')}
          </h2>

          {available.length === 0 && !solanaAddress ? (
            <p className="mt-2 rounded-lg border border-dashed border-line p-4 text-sm">{t('none')}</p>
          ) : (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {solanaAddress && (
                <li>
                  <div className="card flex h-full flex-col p-4">
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                        <Wallet className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-fg">{t('solana.name')}</span>
                        <span className="block text-xs text-fg-muted">{t('solana.body')}</span>
                      </span>
                    </div>
                    <CopyableAddress address={solanaAddress} />
                  </div>
                </li>
              )}
              {available.map(({ key, url, icon: Icon }) => (
                <li key={key}>
                  <a
                    id={`support-${key}`}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="card group flex h-full min-h-[64px] items-center gap-3 p-4 transition-colors hover:border-accent"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-fg">{t(`${key}.name`)}</span>
                      <span className="block text-xs text-fg-muted">{t(`${key}.body`)}</span>
                    </span>
                    <ExternalLink className="h-4 w-4 shrink-0 text-fg-faint group-hover:text-accent" aria-hidden />
                    <span className="sr-only">{t('opensInNewTab')}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-medium text-fg">{t('neutralTitle')}</h2>
          <p className="mt-1.5">{t('neutralBody')}</p>
        </section>

        <p className="text-xs text-fg-faint">{t('processorNote')}</p>
      </div>
    </Page>
  );
}
