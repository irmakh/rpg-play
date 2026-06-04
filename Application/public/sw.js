const CACHE = 'rpg-v79';

const STATIC = [
  // Core pages
  '/login.html',
  '/index.html',
  '/table.html',
  // Console theme
  '/console/',
  '/console/table-console.html',
  '/console/table-secondary.html',
  '/console/manifest.json',
  '/console/manifest-d20.json',
  '/console/manifest-d20-companion.json',
  // Manifests & icons
  '/manifest.json',
  '/img/icon-192.png',
  '/img/icon-512.png',
  // CSS
  '/css/table.css',
  '/css/table-theme-modern.css',
  '/css/console/table-console.css',
  // Shared JS libs
  '/js/monster-stat-block.js',
  '/js/lib/esc.js',
  '/js/lib/chat-render.js',
  '/js/lib/dnd-data.js',
  '/js/lib/realtime.js',
  '/js/lib/dice-engine.js',
  '/js/lib/lightbox.js',
  // Table JS modules
  '/js/table/table-state.js',
  '/js/table/table-utils.js',
  '/js/table/table-auth.js',
  '/js/table/table-map.js',
  '/js/table/table-realtime.js',
  '/js/table/table-initiative.js',
  '/js/table/table-chat.js',
  '/js/table/table-monsters.js',
  '/js/table/table-panel.js',
  '/js/table/table-hppanel.js',
  '/js/table/table-addtoken.js',
  '/js/table/table-music.js',
  '/js/table/table-main.js',
  // Console JS
  '/js/console/table-console.js',
  '/js/console/secondary.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // allSettled so one failed fetch doesn't abort the install
      Promise.allSettled(STATIC.map(url => c.add(url)))
    )
  );
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
  const url = new URL(e.request.url);
  // Always network for API, SSE, WebSocket
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
