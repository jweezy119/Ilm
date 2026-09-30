import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every API path the client calls must be proxied.
 *
 * The web app does not talk to the API directly. It fetches `/api/...` on its own
 * origin and relies on a rewrite in next.config.js to forward it, so a route that
 * exists in the API and is absent from that list returns 404 from Next.js — the
 * request never reaches the service, and the page shows whatever it shows for a
 * missing endpoint.
 *
 * That is what happened to /api/figures. The route was built, the client method was
 * written, the page compiled, every type checked, and the page rendered "Request
 * failed with 404" in production. Nothing in the type system connects a client
 * method to a proxy rule, and nothing in the API connects a route to one either, so
 * this reads both files and checks the join.
 *
 * This is the third stale list in this repository, after the corpus enumeration in
 * the web store and the one in the indexer, and the lesson is the same each time: a
 * list of things is a thing that goes stale, and the fix is a test rather than
 * vigilance.
 */

const config = readFileSync(join(__dirname, '../../next.config.js'), 'utf8');
const client = readFileSync(join(__dirname, 'api.ts'), 'utf8');

// Character codes, so the closers need no quote characters in the source.
const QUOTE = 0x22;
const APOSTROPHE = 0x27;
const BACKTICK = 0x60;
const CLOSERS = new Set([
  QUOTE, APOSTROPHE, BACKTICK, 0x20, 0x09, 0x0a, 0x0d,
  0x29, 0x2c, 0x3f, 0x3c, 0x3e, 0x7c, 0x5e,
  // A ${ in a template ends the literal part of the path. Without it,
  // `/api/texts${opts.includeEmbeddings ? ... }` was read as a path called
  // "/api/texts${options.includeEmbeddings" and reported as unproxied, when the
  // only thing wrong was the scanner.
  0x7b,
  // And the dollar that starts one, since the brace is already a boundary.
  0x24,
]);

/** The proxy rules as path prefixes; `/api/passages/:path*` covers `/api/passages/x`. */
function proxiedPrefixes(): string[] {
  const sources: string[] = [];
  const pattern = /source:\s*'([^']+)'/g;
  for (const m of config.matchAll(pattern)) sources.push(m[1]);
  return sources.filter((s) => s.startsWith('/api')).map((s) => s.replace(/\/:path\*$/, ''));
}

/**
 * Every `/api/...` path the client calls, with template segments collapsed.
 *
 * Scanned rather than matched with a regex: a path starts with /api/ and ends at a
 * quote or a bracket, and expressing that as a regex puts a backtick and two kinds
 * of quote inside a character class inside a string literal. Comparing code points
 * avoids the quoting entirely.
 */
function clientPaths(): string[] {
  const found = new Set<string>();
  let from = 0;

  for (;;) {
    const start = client.indexOf('/api/', from);
    if (start === -1) break;

    let end = start;
    while (end < client.length && !CLOSERS.has(client.charCodeAt(end))) end += 1;

    const raw = client.slice(start, end);
    // A template segment becomes a wildcard, so /api/themes/*/compare prefix-matches.
    // Trim a dangling ${ left by the scan, then collapse any complete one.
    found.add(raw.replace(/\$\{[^}]*\}/g, '*').replace(/\/$/, ''));
    from = end > start ? end : start + 5;
  }

  return [...found];
}

describe('api proxy', () => {
  it('proxies every path the client calls', () => {
    const prefixes = proxiedPrefixes();
    const missing = clientPaths().filter(
      (path) => !prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    );

    expect(
      missing,
      `These client paths match no rewrite in next.config.js, so they 404 from Next.js instead of reaching the API: ${missing.join(', ')}`
    ).toEqual([]);
  });
});
