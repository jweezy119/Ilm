import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
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
 *
 * The optional Basic gate is for a quick tunnel, which has no DNS or Cloudflare
 * Access in front of it. It guards page requests only; /api and static assets
 * are excluded by the matcher below. Unset either variable and there is no gate.
 */
const intlMiddleware = createMiddleware(routing);

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Ilm", charset="UTF-8"' },
  });
}

function authorized(request: NextRequest): boolean {
  const user = process.env.ILM_BASIC_USER;
  const password = process.env.ILM_BASIC_PASS;
  if (!user || !password) return true;

  const header = request.headers.get('authorization');
  if (!header?.startsWith('Basic ')) return false;
  try {
    const [givenUser, ...parts] = atob(header.slice(6)).split(':');
    return givenUser === user && parts.join(':') === password;
  } catch {
    return false;
  }
}

export default function middleware(request: NextRequest) {
  if (!authorized(request)) return unauthorized();
  return intlMiddleware(request);
}

export const config = {
  // Everything except API routes, the health probe, Next internals, and anything
  // with a file extension. /api and /health are matched exactly: prefixing them
  // would make the browser ask the API for /en/api/health, and a redirected
  // /health is not a health check — Fly and Docker both need a 200 from the
  // rewrite to the API, not a 307 to /en/health.
  matcher: ['/((?!api|health|opengraph-image|twitter-image|_next|_vercel|.*\\..*).*)'],
};
