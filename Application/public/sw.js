// Written by Irmak Hakman — 2026-10-15 14:27
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

const CACHE = 'rpg-v276';

const STATIC = [
  // Core pages
  '/campaigns.html',
  '/css/tokens.css',
  '/css/templates.css',
  '/js/lib/template.js',
  '/css/app-shell.css',
  '/css/campaigns.css',
  '/js/campaigns.js',
  '/js/lib/modal-guard.js',
  '/handouts.html',
  '/css/handouts.css',
  '/js/handouts.js',
  '/waiting-screens.html',
  '/css/waiting-screens.css',
  '/js/waiting-screens.js',
  '/login.html',
  '/index.html',
  '/table.html',
  '/music.html',
  // Console theme
  '/console/',
  '/console/table-console.html',
  '/console/table-secondary.html',
  '/console/probe.html',
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
  '/css/table-ux.css',
  '/css/table-sheet-popout.css',
  '/css/weather.css',
  '/css/notifications.css',
  '/css/console/console.css',
  '/css/console/panel.css',
  '/css/console/map.css',
  // Console typeface (referenced from console.css, so it needs listing to work offline)
  '/fonts/plex-cond-400-latin.woff2',
  '/fonts/plex-cond-400-latin-ext.woff2',
  '/fonts/plex-cond-500-latin.woff2',
  '/fonts/plex-cond-500-latin-ext.woff2',
  '/fonts/plex-cond-600-latin.woff2',
  '/fonts/plex-cond-600-latin-ext.woff2',
  // Shared JS libs
  '/js/monster-stat-block.js',
  '/js/lib/esc.js',
  '/js/lib/desktop-link.js',
  '/js/lib/chat-render.js',
  '/js/lib/dnd-data.js',
  '/js/lib/realtime.js',
  '/js/table/table-waiting.js',
  '/js/lib/icons.js',
  '/js/lib/notifications.js',
  '/js/lib/music-sync.js',
  '/js/lib/dice-engine.js',
  '/js/lib/lightbox.js',
  '/js/lib/fr_calendar.js',
  '/js/lib/calendar-list.js',
  '/js/lib/weather-ui.js',
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
  '/js/table/table-popout.js',
  '/js/table/table-weather.js',
  '/js/table/table-main.js',
  '/js/table/table-ux.js',
  // Console JS
  '/js/lib/auth-ui.js',
  '/js/console/console-login.js',
  '/js/console/console-gamepad.js',
  '/js/console/table-console.js',
  '/js/lib/chat-pm.js',
  '/js/console/panel-core.js',
  '/js/console/panel-nav.js',
  '/js/console/panel-turn.js',
  '/js/console/panel-token.js',
  '/js/console/panel-sheet.js',
  '/js/console/panel-chat.js',
  '/js/console/panel-table.js',
  '/js/console/panel-handouts.js',
  '/js/console/panel-music.js',
  '/js/console/panel-notify.js',
  '/js/console/panel-pad.js',
  '/js/console/panel-realtime.js',
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
  // Always network for video and audio. The browser asks for them in byte
  // ranges, and a partial (206) response cannot go in the cache; a whole one
  // could be a 500 MB story video, far too large to keep offline.
  if (e.request.headers.has('range')
      || e.request.destination === 'video' || e.request.destination === 'audio'
      || /\.(mp4|webm|mp3|ogg|wav|m4a)$/i.test(url.pathname)) return;

  const cacheGet = () =>
    fetch(e.request).then(res => {
      if (res.ok && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    });

  // Network-first for HTML / navigations so the app shell is never stale
  // (cache-first on HTML would keep serving an old page that references
  // removed scripts/markup). Falls back to cache when offline.
  const isHTML = e.request.mode === 'navigate'
    || e.request.destination === 'document'
    || url.pathname.endsWith('.html');
  if (isHTML) {
    e.respondWith(
      cacheGet().catch(() =>
        caches.match(e.request).then(c => c || caches.match('/index.html'))
      )
    );
    return;
  }

  // Cache-first for versioned static assets (JS/CSS/img are busted via ?v=N).
  e.respondWith(
    caches.match(e.request).then(cached => cached || cacheGet())
  );
});
