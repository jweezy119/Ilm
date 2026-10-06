const createNextIntlPlugin = require('next-intl/plugin');

/** @type {import('next').NextConfig} */

// The browser calls /api/* on its own origin and Next proxies to Fastify. One
// origin in development means no CORS preflight and no internal host in the
// client bundle.
//
// NEXT_INTERNAL_API_URL is read here, at build time. It is deliberately not
// NEXT_PUBLIC_*, which would put the internal host in the browser bundle — but
// that also makes forgetting it silent: the pages render and every search returns
// nothing, because the proxy is still aimed at localhost.
//
// `next build` sets NODE_ENV=production itself, so NODE_ENV cannot distinguish a
// deploy from a local production build. Render and CI both mark themselves, so
// that is what the hard failure keys off; elsewhere it warns.
const configured = (process.env.NEXT_INTERNAL_API_URL || '').trim();
const isDeploy = process.env.RENDER === 'true' || process.env.CI === 'true';

const MISSING =
  'NEXT_INTERNAL_API_URL is not set. It must point at the Ilm API, e.g. ' +
  'https://ilm-api.onrender.com. Without it every /api/* request is proxied to ' +
  'http://localhost:4000, so the app renders but returns no results.';

if (isDeploy && !configured) {
  throw new Error(MISSING);
}

if (isDeploy && configured.includes('localhost')) {
  throw new Error(
    `NEXT_INTERNAL_API_URL is "${configured}", which points at localhost. ` +
      'The browser would reach its own machine rather than the API.'
  );
}

if (!configured) {
  console.warn(`[ilm] ${MISSING}`);
}

const API_ORIGIN = configured || 'http://localhost:4000';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@ilm/shared'],
  async rewrites() {
    return [
      { source: '/api/search', destination: `${API_ORIGIN}/api/search` },
      { source: '/api/search/:path*', destination: `${API_ORIGIN}/api/search/:path*` },
      { source: '/api/texts/:path*', destination: `${API_ORIGIN}/api/texts/:path*` },
      { source: '/api/passages/:path*', destination: `${API_ORIGIN}/api/passages/:path*` },
      { source: '/api/themes/:path*', destination: `${API_ORIGIN}/api/themes/:path*` },
      { source: '/api/journeys/:path*', destination: `${API_ORIGIN}/api/journeys/:path*` },
      // The curated topic list behind the quick links. A new API route has to be
      // added here as well, or the browser gets a 404 from Next while the API is
      // serving it perfectly well one origin over.
      //
      // This one is listed on its own because it is a bare path. Sub-paths of a
      // listed prefix do not need their own entry — /api/passages/:path* already
      // carries both /api/passages/:id/citations and /api/passages/resolve, and
      // rewrites are matched in order, so a specific rule placed after it would be
      // dead configuration.
      { source: '/api/topics', destination: `${API_ORIGIN}/api/topics` },
      // Figures. Added with the figure feature and missing from the first attempt, so
      // the page fetched a 404 from Next rather than from the API. The test in
      // src/lib/proxy-routes.test.ts now fails if a new route family is not listed.
      { source: '/api/figures/:path*', destination: `${API_ORIGIN}/api/figures/:path*` },
      // The library. Listed explicitly because it is a bare path with a DELETE
      // child: without this the browser gets a Next HTML error page from
      // /api/library and the save button does nothing at all, which is exactly
      // what happened the first time this was wired.
      { source: '/api/library', destination: `${API_ORIGIN}/api/library` },
      { source: '/api/library/:path*', destination: `${API_ORIGIN}/api/library/:path*` },
      { source: '/api/recommendations/:path*', destination: `${API_ORIGIN}/api/recommendations/:path*` },
      { source: '/api/compare/:path*', destination: `${API_ORIGIN}/api/compare/:path*` },
      { source: '/api/lexicon', destination: `${API_ORIGIN}/api/lexicon` },
      { source: '/api/tts', destination: `${API_ORIGIN}/api/tts` },
      { source: '/api/users/:path*', destination: `${API_ORIGIN}/api/users/:path*` },
      { source: '/health', destination: `${API_ORIGIN}/health` },
    ];
  },
};

// next-intl wraps the config last so its alias for the request config and its
// babel/swc plugins are applied to the user's own configuration.
module.exports = withNextIntl(nextConfig);
