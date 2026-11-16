/* Cache shell for PWA. Cache is for availability of the interface, NOT a proxy connection. */
const CACHE = 'qmrproxy-shell-v7-miniapp-20261116';
const SHELL = [
  './', './index.html', './styles.css', './app.js',
  './telegram-miniapp.js', './manifest.webmanifest', './assets/icon.svg', './assets/icon-192.png',
  './assets/icon-512.png', './assets/qmr-social-preview.png', './assets/icons.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/nodes.json')) {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, clone)));
      }
      return response;
    }).catch(async () => await caches.match(request) || new Response('{"updated_at":null,"nodes":[]}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  event.respondWith(fetch(request).catch(async () => await caches.match(request) || new Response('Offline', { status: 503 })));
});
