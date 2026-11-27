const CACHE_NAME = 'private-rules-pwa-v4';
const APP_SHELL = [
  '/pwa-install',
  '/manifest.webmanifest',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
  '/apple-touch-icon-1.1.0.png',
];

const NO_CACHE_PATH = /^\/(api|rules|sub|p|t|health)(\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || NO_CACHE_PATH.test(url.pathname)) return;

  // HTML navigations always prefer fresh network so new deployments load immediately
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/pwa-install')));
    return;
  }

  // Immutable Vite hashed assets & static icons use cache-first with background fill
  if (url.pathname.startsWith('/assets/') || APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && response.type === 'basic') {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          }),
      ),
    );
  }
});
