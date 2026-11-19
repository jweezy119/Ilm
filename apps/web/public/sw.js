/*
 * A service worker with a narrow cache.
 *
 * The previous version cached nothing, deliberately: Ilm's pages are answers,
 * and a stale answer is a lie about what the texts say. That rule still holds.
 * What is safe to cache here is the part that cannot become untrue:
 *
 *   - hashed static assets under /_next/static/, and icons/manifest;
 *   - GET /api/topics, a curated list that changes only with a deployment;
 *   - one static offline notice, used only when a navigation actually fails.
 *
 * No search result, passage, theme score, library entry or HTML page is cached.
 * A reader without a connection gets a short page saying so, never a stale
 * answer dressed up as a current one.
 */

const STATIC_CACHE = 'ilm-static-v2';
const TOPICS_CACHE = 'ilm-topics-v2';
const OFFLINE_URL = '/en/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      // The notice is a page like any other, but it is fetched here so that it
      // exists offline without ever intercepting a normal navigation.
      .then((cache) => cache.add(OFFLINE_URL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([STATIC_CACHE, TOPICS_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:png|svg|woff2?|webmanifest)$/.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  if (url.pathname === '/api/topics') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(TOPICS_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return (
            cached ||
            new Response(JSON.stringify({ success: false, error: { code: 'OFFLINE', message: 'Offline' } }), {
              status: 503,
              headers: { 'content-type': 'application/json' },
            })
          );
        })
    );
    return;
  }

  if (request.mode === 'navigate') {
    // Network only while online. The cached page is the failure path, shown
    // solely when the network is gone — never in place of a live answer.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});
