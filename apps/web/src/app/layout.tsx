import type { Metadata, Viewport } from 'next';
import { Inter, Amiri, Frank_Ruehl, GFS_Neohellenic, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const amiri = Amiri({
  subsets: ['arabic'],
  display: 'swap',
  variable: '--font-arabic',
});

const frankRuehl = Frank_Ruehl({
  subsets: ['hebrew'],
  display: 'swap',
  variable: '--font-hebrew',
});

const gfsNeohellenic = GFS_Neohellenic({
  subsets: ['greek'],
  display: 'swap',
  variable: '--font-greek',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Ilm — Sacred Text Comparison & Knowledge',
  description: 'Side-by-side comparison and deep understanding of Quran, Talmud, Torah, Old Testament, and New Testament. Powered by TypeSafe AI for semantic search and context-aware recommendations.',
  keywords: ['quran', 'bible', 'talmud', 'torah', 'comparative religion', 'sacred texts', 'interfaith', 'theology'],
  authors: [{ name: 'Ilm Team' }],
  creator: 'Ilm',
  publisher: 'Ilm',
  robots: 'index, follow',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://ilm.app',
    title: 'Ilm — Sacred Text Comparison & Knowledge',
    description: 'Compare Quran, Bible, Talmud, and Torah side-by-side with AI-powered semantic search.',
    siteName: 'Ilm',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ilm — Sacred Text Comparison',
    description: 'Compare sacred texts side-by-side with intelligent semantic search.',
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1e33' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${amiri.variable} ${frankRuehl.variable} ${gfsNeohellenic.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen bg-white dark:bg-ilm-950 text-ilm-900 dark:text-ilm-50 antialiased">
        {children}
      </body>
    </html>
  );
}