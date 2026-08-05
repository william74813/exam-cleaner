const CACHE = 'exam-cleaner-v2.1.0-20260805-r2';
const CORE = [
  './',
  './index.html',
  './scanner.html',
  './release-v2.1.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './preview/v2.1/index.html',
  './preview/v2.1/enhance-v1.js',
  './preview/v2.1/default-gray-v1.js',
  './preview/v2.1/rc-ui.js',
  './preview/v2.1/detect-grabcut-v1.js',
  './preview/v2.1/touch-corner-handles-v1.js',
  './preview/v2.1/release-ui-v21.js',
  './preview/v2.1/multipage-v1.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const request = event.request;
  const isNavigation = request.mode === 'navigate' || request.destination === 'document';

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
