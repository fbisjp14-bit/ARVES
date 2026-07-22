const CACHE_NAME = 'osone-cache-v2-gemini-fix';
const APP_SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Never cache API calls or non-GET requests. This prevents stale Gemini errors
  // and avoids persisting responses that may be tied to user credentials.
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Network-first ensures a new Vercel deployment replaces the old app quickly.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('/index.html');
        throw new Error('Recurso indisponível offline.');
      })
  );
});
