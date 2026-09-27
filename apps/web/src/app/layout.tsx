import type { Metadata, Viewport } from 'next';
import { Inter, Amiri, Noto_Sans_Hebrew, Noto_Serif } from 'next/font/google';
import { Providers } from '@/components/Providers';
import './globals.css';

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

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: 'Ilm — Sacred Text Comparison',
    template: '%s · Ilm',
  },
  description:
    'Search, compare, and trace themes across the Quran, Torah, Talmud, Old Testament and New Testament. Recommendations are transparent weighted scores, not generated claims.',
  keywords: ['quran', 'bible', 'talmud', 'torah', 'comparative religion', 'sacred texts', 'interfaith'],
  openGraph: {
    type: 'website',
    title: 'Ilm — Sacred Text Comparison',
    description: 'Compare sacred texts side by side with scored, transparent connections.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdfcfa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1a17' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${amiri.variable} ${hebrew.variable} ${greek.variable}`}
    >
      <body className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
