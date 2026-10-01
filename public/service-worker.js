const CACHE_NAME = 'hisab-v1.5';
const APP_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/js/constants.js',
  '/js/date.js',
  '/js/firebase.js',
  '/js/data.js',
  '/js/calculations.js',
  '/js/ui.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_ASSETS))
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

async function networkFirst(request, fallbackPath = null) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      const copy = response.clone();
      const cache = await caches.open(CACHE_NAME);
      await cache.put(fallbackPath || request, copy);
    }
    return response;
  } catch (error) {
    const cached = await caches.match(fallbackPath || request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase Hosting reserves /__ for SDK/Auth configuration. Never intercept it.
  if (
    event.request.method !== 'GET'
    || url.pathname.startsWith('/__')
    || url.origin !== self.location.origin
  ) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, '/index.html'));
    return;
  }

  // Icons are immutable enough to prefer the local copy. App code/styles use
  // network-first below so installed PWAs do not remain on an old deployment.
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || networkFirst(event.request))
    );
    return;
  }

  event.respondWith(networkFirst(event.request));
});
