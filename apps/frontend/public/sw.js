// Installable PWA offline shell (BP §5.1-§5.2, ADR-5). Deliberately
// conservative: this product is authenticated and per-user, so caching API
// responses risks serving stale or another session's data offline. Only two
// things are ever cached --
//   1. /_next/static/* -- content-hashed, immutable, safe to keep forever.
//   2. the last-seen navigation (HTML) response -- lets the app shell open
//      offline instead of the browser's own offline error page; the client
//      still needs the network for any real data and already handles that
//      failure with its own retry UI (see RankScreen/DiscoverScreen).
// /api/* and everything cross-origin always goes to the network untouched.

const SHELL_CACHE = 'reel-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          const cached = await cache.match(request);
          return cached ?? Response.error();
        }
      })(),
    );
  }
});
