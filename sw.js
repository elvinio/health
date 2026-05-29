const CACHE = 'finance-v55';
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
  '/health/finance-app.js',
  '/health/finance-gmail.js',
  '/health/themes.css',
  '/health/icons/icon-192.png',
  '/health/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
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
