import type { MetadataRoute } from 'next';

/**
 * Public, indexable pages only. The offline notice is robots-noindex and the
 * results pages are query-driven, so neither belongs here. Locales are listed
 * explicitly because localePrefix is 'always' — Google should find /he and /ar
 * directly rather than through a redirect from /.
 */
const ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || 'https://ilm.pabandi.com').replace(/\/+$/, '');

const PAGES = [
  { path: '', priority: 1, changeFrequency: 'weekly' as const },
  { path: '/read', priority: 0.9, changeFrequency: 'weekly' as const },
  { path: '/topics', priority: 0.8, changeFrequency: 'weekly' as const },
  { path: '/journeys', priority: 0.7, changeFrequency: 'monthly' as const },
  { path: '/library', priority: 0.7, changeFrequency: 'monthly' as const },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/contact', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/support', priority: 0.3, changeFrequency: 'yearly' as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ['en', 'ar', 'he'].flatMap((locale) =>
    PAGES.map(({ path, priority, changeFrequency }) => ({
      url: `${ORIGIN}/${locale}${path}`,
      lastModified,
      changeFrequency,
      priority,
    }))
  );
}
