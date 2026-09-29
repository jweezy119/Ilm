import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Redirects `/compare` to `/en/compare` and negotiates a locale for the rest.
 *
 * Without this the locale lives in a cookie only, so a shared link carries no
 * language and the first request cannot know which catalog to render.
 *
 * The library's anonymous id is deliberately *not* set here. The API mints it on
 * the first `/api/library` call, and that Set-Cookie does survive the rewrite to
 * the API — it was tested, because it looked like it might not. Setting it in
 * middleware as well would mean two mechanisms with different behaviour: cookies
 * set on a middleware response reach the browser only for redirects and not for
 * cached document responses, so a reader would get an id sometimes and not
 * others, with nothing to explain the difference. One mechanism, in the layer
 * that owns the data.
 */
export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next internals, and anything with a file
  // extension. The API is matched by exact prefix: /api/health is a real route,
  // and prefixing it would make the browser ask the API for /en/api/health.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
