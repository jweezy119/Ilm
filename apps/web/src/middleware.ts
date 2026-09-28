import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Redirects `/compare` to `/en/compare` and negotiates a locale for the rest.
 *
 * Without this the locale lives in a cookie only, so a shared link carries no
 * language and the first request cannot know which catalog to render.
 */
export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next internals, and anything with a file
  // extension. The API is matched by exact prefix: /api/health is a real route,
  // and prefixing it would make the browser ask the API for /en/api/health.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
