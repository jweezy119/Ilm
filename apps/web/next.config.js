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
      { source: '/api/recommendations/:path*', destination: `${API_ORIGIN}/api/recommendations/:path*` },
      { source: '/api/compare/:path*', destination: `${API_ORIGIN}/api/compare/:path*` },
      { source: '/api/lexicon', destination: `${API_ORIGIN}/api/lexicon` },
      { source: '/api/users/:path*', destination: `${API_ORIGIN}/api/users/:path*` },
      { source: '/health', destination: `${API_ORIGIN}/health` },
    ];
  },
};

module.exports = nextConfig;
