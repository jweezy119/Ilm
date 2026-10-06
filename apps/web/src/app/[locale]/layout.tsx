import type { Metadata, Viewport } from 'next';
import { Inter, Amiri, Noto_Sans_Hebrew, Noto_Serif } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Providers } from '@/components/Providers';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { routing, isRtl } from '@/i18n/routing';
import '../globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const amiri = Amiri({
  subsets: ['arabic'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-arabic',
});

const hebrew = Noto_Sans_Hebrew({
  subsets: ['hebrew'],
  display: 'swap',
  variable: '--font-hebrew',
});

const greek = Noto_Serif({
  subsets: ['greek'],
  display: 'swap',
  variable: '--font-greek',
});

/**
 * Fonts are exposed as CSS variables rather than applied by name.
 *
 * An Arabic or Hebrew interface needs its own typeface for the interface itself,
 * not only for the scripture inside it, and that is a different decision from
 * which font renders a Quranic verse. globals.css picks between them on `dir` and
 * `lang`, so switching language does not reflow the page.
 */
const fontVariables = `${inter.variable} ${amiri.variable} ${hebrew.variable} ${greek.variable}`;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: 'meta' });

  return {
    // The manifest is read by the browser and by the TWA wrapper; declaring it here
    // puts the `<link rel=manifest>` in the head, which is what Chrome's
    // installability check looks for.
    manifest: '/manifest.webmanifest',
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: { default: t('title'), template: `%s · ${locale === 'en' ? 'Ilm' : t('title').split('—')[0].trim()}` },
    description: t('description'),
    keywords: ['quran', 'bible', 'talmud', 'torah', 'comparative religion', 'sacred texts', 'interfaith'],
    openGraph: {
      type: 'website',
      title: t('title'),
      description: t('description'),
    },
    // A Hebrew page is a Hebrew page. Without this, search engines and screen
    // readers are told the content is in the wrong language.
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])),
    },
    robots: { index: true, follow: true },
    /*
     * Tells iOS this is an app. Without `apple-mobile-web-app-capable`, an installed
     * iOS shortcut opens in a Safari tab with a URL bar, which is the difference
     * between an app and a bookmark.
     */
    applicationName: 'Ilm',
    appleWebApp: { capable: true, title: 'Ilm', statusBarStyle: 'black-translucent' },
    formatDetection: { telephone: false },
    icons: {
      icon: [
        { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      // iOS does not read the manifest, and takes its home-screen icon from here.
      apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdfcfa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1a17' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Lets next-intl resolve messages for this render without re-reading them from
  // the request, which is what keeps a static build static.
  setRequestLocale(locale);

  const rtl = isRtl(locale);

  return (
    <html
      lang={locale}
      // The one attribute that mirrors the whole page. Every directional style in
      // the app is a logical property, so this is sufficient — adding `dir` here
      // without converting `left-`/`ml-` to `start-`/`ms-` would mirror the chrome
      // and leave the content the wrong way round.
      dir={rtl ? 'rtl' : 'ltr'}
      suppressHydrationWarning
      className={fontVariables}
    >
      <body className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] antialiased">
        {/* Picks up the reader's locale from the <html> tag; without it every
            client component would assume English. */}
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
