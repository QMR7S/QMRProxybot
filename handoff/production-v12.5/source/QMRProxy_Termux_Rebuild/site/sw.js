/* QMR Proxy PWA — v11 Studio. Network-first; never cache protected API responses. */
const CACHE='qmr-v123-quality-20261121';
const FILES=['./','./index.html','./styles.css','./theme-v11.css','./refine-v11.css','./studio-v11.css','./extra-v11.css','./app.js?v=123','./quality-v119.css?v=123','./quality-v119.js?v=123','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./assets/ui-icons.svg','./navigation-v11.js','./proxy-tools-core.js','./proxy-tools-ui.js','./mini/','./mini/mini.js?v=123','./mini/mini.css','./guide/','./faq/','./safety/','./privacy/','./terms/','./contact/'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('qmr-')||k.startsWith('qmrproxy-'))&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{const req=event.request,url=new URL(req.url);if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/')||url.pathname.includes('/telegram-webhook')||url.pathname.endsWith('/quality-public-v119.json'))return;
  event.respondWith(fetch(req).then(response=>{if(response.ok&&(url.pathname.endsWith('/nodes.json')||url.pathname.endsWith('/extra-proxies.json')))event.waitUntil(caches.open(CACHE).then(c=>c.put(req,response.clone())));return response;}).catch(async()=>await caches.match(req)||new Response('Offline',{status:503})));
});
