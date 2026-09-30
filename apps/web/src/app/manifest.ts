import type { MetadataRoute } from 'next';

/**
 * The web app manifest — what makes Ilm installable, and what the Trusted Web
 * Activity wrapper reads to describe itself.
 *
 * It sits at the site root rather than under [locale], so there is one manifest
 * serving three locales. Chrome caches one manifest per origin, and a per-locale one
 * would mean whichever locale was visited first decided the installed app's name
 * and start page for everyone. The name is the trilingual mark for the same reason:
 * it is the same app in every language, so the manifest describes it once.
 *
 * `lang` and `dir` are deliberately absent. The name is Latin, Arabic and Hebrew at
 * once, so either value would be wrong for two thirds of it, and a manifest that
 * declares a language it is not entirely in misleads the screen reader and the
 * launcher's own heuristics.
 *
 * `start_url` is /en rather than /. Bare / would land on the default locale by
 * server redirect, and a redirect inside a Trusted Web Activity is a launch that
 * visibly bounces — the address bar flickers and the back gesture acquires an entry
 * that goes nowhere.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ilm · علم · דַּעַת',
    short_name: 'Ilm',
    description:
      'The Quran, Torah, Talmud and both Testaments, in Hebrew, Greek, Aramaic and Arabic. Read a passage, and see what the other texts say about it.',
    id: '/',
    start_url: '/en',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fdfcfa',
    theme_color: '#065f46',
    categories: ['books', 'education', 'lifestyle'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        // The maskable file is the mark inset into a full-bleed background, because
        // Android crops it to the launcher's shape and anything near the edge is lost.
        purpose: 'maskable',
      },
    ],
  };
}