const CACHE = 'health-tracker-v15';
const EXT_CACHE = 'health-tracker-ext-v1';
const ASSETS = ['/health/tracker.html', '/health/tracker-chat.js', '/health/tracker-radio.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE && k !== EXT_CACHE && !k.startsWith('finance-'))
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Cache the Claude SDK ESM module (versioned CDN URL) on first fetch so the
  // chat UI keeps loading; the chat itself still needs network to call the API.
  if (url.startsWith('https://esm.sh/')) {
    e.respondWith(
      caches.open(EXT_CACHE).then(c =>
        c.match(e.request).then(hit => hit || fetch(e.request).then(res => {
          if (res && res.ok) c.put(e.request, res.clone());
          return res;
        }))
      )
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      if (cs.length) return cs[0].focus();
      return clients.openWindow('/health/tracker.html');
    })
  );
});
