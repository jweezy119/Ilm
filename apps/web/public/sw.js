/*
 * A service worker that deliberately does nothing.
 *
 * It exists because installability requires one, and because the Trusted Web
 * Activity wrapper expects the origin to have registered it. That is the whole job.
 *
 * The temptation with a service worker is to cache things — the app shell, the
 * fonts, the icon. On this app that is actively dangerous, for reasons worth writing
 * down rather than discovering later.
 *
 * Ilm's pages are server-rendered per request and its results are live: a search
 * answers from a database, and a passage page reflects theme labels and cross
 * references that change when the corpus is re-ingested. Caching HTML means a reader
 * is shown a search result that no longer exists, or a passage that has since been
 * re-scored, with no way to tell and no way to refresh past it. A cached app shell is
 * worse still, because the shell and the data are the same request here.
 *
 * So there is no precache, no runtime cache, and no fetch interception at all. The
 * `fetch` listener below never calls respondWith, which means the browser handles
 * every request exactly as it would with no service worker installed. Deleting this
 * file would change nothing except installability.
 *
 * The alternative — caching static assets only, by extension — was not worth the
 * failure mode. A stale font or icon is a cosmetic bug; a stale HTML page is a lie
 * about what the texts say, and this product's entire claim is that it does not lie
 * about that.
 */

const CACHE = 'ilm-shell-v1';

/*
 * Kept, and empty on purpose. An install step that caches nothing still gives the
 * browser a version to compare against on the next load, which is what makes
 * `skipWaiting` meaningful rather than decorative.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(() => self.skipWaiting()));
});

/*
 * Every previously-installed cache is deleted on activate. There is only ever one and
 * it holds nothing, so this is close to a no-op — but it means a cache left behind by
 * an older version of this file cannot outlive it.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/*
 * Declared, and inert. Chrome's installability check requires a service worker with
 * a fetch handler; without this listener the app is not installable at all. Nothing
 * responds, so nothing is intercepted.
 */
self.addEventListener('fetch', () => {});