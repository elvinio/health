const CACHE = 'finance-v176';
const EXT_CACHE = 'finance-ext-v1';
const ASSETS = [
  '/health/finance.html',
  '/health/finance.css',
  '/health/finance-core.js',
  '/health/finance-drive.js',
  '/health/finance-expenses.js',
  '/health/finance-investments.js',
  '/health/finance-events.js',
  '/health/finance-insurance.js',
  '/health/finance-tax.js',
  '/health/finance-ai.js',
  '/health/finance-wiki.js',
  '/health/finance-app.js',
  '/health/finance-gmail.js',
  '/health/fonts/eb-garamond.woff2',
  '/health/themes.css',
  '/health/icons/icon-192.png',
  '/health/icons/icon-512.png',
  '/health/fonts/material-symbols-outlined.css',
  '/health/fonts/material-symbols-outlined.woff2',
  '/health/manifest.json',
];

// Versioned external assets — safe to cache indefinitely.
const EXT_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE && k !== EXT_CACHE && !k.startsWith('health-tracker-'))
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Cache-first for versioned external assets (Leaflet). Cached on first fetch.
  if (EXT_ASSETS.some(u => url === u)) {
    e.respondWith(
      caches.open(EXT_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => cached || fetch(e.request))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      if (cs.length) return cs[0].focus();
      return clients.openWindow('/health/finance.html');
    })
  );
});
