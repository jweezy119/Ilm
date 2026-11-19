import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Installability.
 *
 * Chrome will not offer "Add to home screen" without a manifest, a service worker
 * with a fetch handler, a 192px and a 512px icon, a `start_url` and a `display` of
 * `standalone` or `fullscreen`. Every one of those is a separate file or a separate
 * key, and each one fails on its own — the page still works, the build still
 * succeeds, and the only symptom is that the app quietly cannot be installed. That
 * is the kind of thing that gets discovered the day before a release.
 *
 * These assert the shape from the source rather than from a served page, because the
 * served page only exists after a deploy and this is meant to catch the mistake
 * before one.
 */

// This file lives in src/lib, so the app root is two levels up rather than one.
const root = join(__dirname, '..', '..');
const manifest = readFileSync(join(root, 'src/app/manifest.ts'), 'utf8');
const layout = readFileSync(join(root, 'src/app/[locale]/layout.tsx'), 'utf8');
const worker = readFileSync(join(root, 'public/sw.js'), 'utf8');
const assetlinks = readFileSync(join(root, 'src/app/.well-known/assetlinks.json/route.ts'), 'utf8');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/**
 * Comments stripped, so an assertion about what the code does is not satisfied or
 * broken by the prose describing it.
 *
 * public/sw.js spends most of its length explaining why it caches nothing, and
 * including `respondWith` in that explanation is enough to make a naive
 * "does not call respondWith" assertion fail on a file whose whole point is that it
 * does not.
 */
function code(of: string): string {
  return of.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('installability', () => {
  it('declares a manifest and links it from every page', () => {
    // Chrome reads the manifest from the <link rel=manifest> in the head. A manifest
    // that exists and is not linked is a manifest that does not exist.
    expect(existsSync(join(root, 'src/app/manifest.ts'))).toBe(true);
    expect(layout).toContain("manifest: '/manifest.webmanifest'");
  });

  it('has the icons and the sizes installability requires', () => {
    expect(manifest).toContain("sizes: '192x192'");
    expect(manifest).toContain("sizes: '512x512'");
    for (const file of ['public/icon-192.png', 'public/icon-512.png', 'public/icon-maskable-512.png']) {
      expect(existsSync(join(root, file)), `${file} is missing`).toBe(true);
    }
  });

  it('offers a maskable icon, because Android crops to the launcher shape', () => {
    // Without purpose: 'maskable' the launcher masks the standard icon to its own
    // shape, which clips the corners of a rounded-square mark and leaves it smaller
    // than every other icon on the home screen.
    expect(manifest).toContain("purpose: 'maskable'");
  });

  it('starts on a real page and covers the whole site', () => {
    expect(manifest).toContain("start_url: '/en'");
    expect(manifest).toContain("scope: '/'");
    expect(manifest).toMatch(/display: '(standalone|fullscreen)'/);
  });

  it('sets one manifest for all three locales, not one per language', () => {
    // Chrome caches one manifest per origin. A per-locale manifest means whichever
    // language was visited first decides the installed app's name and start page for
    // everyone, and a Hebrew reader can end up with an app called "Ilm" that opens
    // in English.
    expect(manifest).toContain("name: 'Ilm · علم · דַּעַת'");
    // And no lang or dir: the name is three scripts at once, so either value would
    // be wrong for two thirds of it.
    expect(manifest).not.toMatch(/^\s*(lang|dir):/m);
  });

  it('accepts a shared reference from other apps', () => {
    // A share target turns "share this verse into Ilm" into one OS gesture.
    // The action has to be a real page inside the manifest scope, and the search
    // page has to accept the fields the OS sends or the gesture lands on a
    // page that quietly ignores it.
    expect(manifest).toContain('share_target:');
    expect(manifest).toContain("action: '/en'");
    expect(manifest).toMatch(/method: 'GET'/);
    expect(manifest).toContain("params: { title: 'title', text: 'text', url: 'url' }");
    expect(read('src/app/[locale]/page.tsx')).toContain("params.get('text')");
  });

  it('registers a service worker that has a fetch handler', () => {
    // A fetch listener is required for installability even when it does nothing.
    expect(code(worker)).toContain("self.addEventListener('fetch'");
    expect(read('src/components/ServiceWorkerRegistration.tsx')).toContain("navigator.serviceWorker.register('/sw.js'");
    // Production only: a worker registered on the dev server caches nothing but
    // outlives hot reloads, and confuses every stale-response question afterwards.
    expect(read('src/components/ServiceWorkerRegistration.tsx')).toContain("process.env.NODE_ENV !== 'production'");
  });

  it('caches only things that cannot become untrue', () => {
    /*
     * Ilm's pages are answers from a live database. Caching a search result or a
     * passage means showing a reader something that may no longer be current,
     * with no way to tell and no way to refresh past it. The safe set is hashed
     * static assets, the curated topic list, and one static offline notice used
     * only when a navigation actually fails.
     */
    const bare = code(worker);
    expect(bare).toContain("url.pathname.startsWith('/_next/static/')");
    expect(bare).toContain("url.pathname === '/api/topics'");
    expect(bare).toContain("OFFLINE_URLS = ['/en/offline', '/ar/offline', '/he/offline']");
    expect(bare).toContain("request.mode === 'navigate'");
    // The offline notice is the one page served without a network, so it has
    // to speak the reader's language.
    expect(bare).toContain("match(/^\\/(en|ar|he)(?:\\/|$)/)");

    // No data that can change may be stored in either cache.
    for (const unsafe of ['/api/search', '/api/passages', '/api/compare', 'localStorage']) {
      expect(bare, `${unsafe} must never be cached`).not.toContain(unsafe);
    }
    // A navigation goes to the network first; the cached notice is the failure
    // path, not a replacement for a live answer.
    expect(bare).toContain('offlineFor(url.pathname)');
  });

  it('serves a static offline notice and an install action', () => {
    expect(existsSync(join(root, 'src/app/[locale]/offline/page.tsx'))).toBe(true);
    expect(read('src/components/InstallApp.tsx')).toContain('beforeinstallprompt');
    expect(read('src/app/[locale]/page.tsx')).toContain('<InstallApp />');
  });

  it('keeps the screen on while audio is playing', () => {
    expect(read('src/lib/useWakeLock.ts')).toContain("wakeLock.request('screen')");
    expect(read('src/components/RecitationPlayer.tsx')).toContain('useWakeLock(playing)');
    expect(read('src/components/GlobalPodcastPlayer.tsx')).toContain('useWakeLock(segments.length > 0)');
  });

  it('serves verified links with a placeholder rather than a plausible-looking fake', () => {
    // Digital Asset Links is what removes the browser bar from a TWA. A wrong
    // fingerprint fails verification silently, and the symptom looks like a Play
    // problem rather than a bad file, so the placeholder has to be obviously wrong.
    expect(assetlinks).toContain('REPLACE_WITH_SHA256_OF_YOUR_RELEASE_KEYSTORE');
    expect(assetlinks).toContain('export function GET()');
    expect(assetlinks).toContain('delegate_permission/common.handle_all_urls');
  });

  it('cannot commit the release keystore', () => {
    /*
     * The single file in this repository that would let someone publish an update to
     * Ilm, and the one whose loss means unpublishing rather than shipping the next
     * version — because Android identifies an update by its signing key.
     *
     * Asserted rather than trusted because the failure is invisible until it is
     * catastrophic, and because the natural first keystore someone generates lands in
     * the repo root, which is exactly where a .gitignore entry has to already be.
     */
    const ignore = readFileSync(join(root, '..', '..', '.gitignore'), 'utf8');
    for (const pattern of ['*.keystore', '*.jks', 'keystore.properties']) {
      expect(ignore, `${pattern} is not ignored`).toContain(pattern);
    }
  });

  it('keeps the keystore and the fingerprint apart', () => {
    /*
     * The fingerprint is derived from the keystore and is public — Android fetches
     * it from the site to verify the link — so it belongs in a committed file. The
     * keystore does not. Conflating them is how one of the two leaks.
     */
    expect(assetlinks).toContain('delegate_permission/common.handle_all_urls');
    expect(read('scripts/build-android-twa.ts')).toContain('fingerprintOf');
    expect(read('scripts/build-android-twa.ts')).toContain('writeAssetlinks(packageName, fingerprint)');
  });

  it('publishes a privacy policy, because Play will not review without one', () => {
    // Not a nice-to-have. The Play listing requires a public URL, and this one has
    // to exist in three languages because a policy a Hebrew-speaking reader cannot
    // read is not disclosure.
    for (const file of ['messages/en.json', 'messages/he.json', 'messages/ar.json']) {
      const messages = JSON.parse(read(file));
      expect(messages.legal.privacy.readTitle, `${file} has no privacy policy`).toBeTruthy();
      expect(messages.legal.privacy.thirdPartyBody, `${file} does not disclose Jev`).toContain('Jev');
      expect(messages.legal.privacy.searchBody, `${file} does not disclose search logging`).toBeTruthy();
    }
    expect(existsSync(join(root, 'src/app/[locale]/privacy/page.tsx'))).toBe(true);
    expect(existsSync(join(root, 'src/app/[locale]/terms/page.tsx'))).toBe(true);
  });
});