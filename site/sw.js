'use strict';
const CACHE='qmrproxy-v2-review-1', CORE=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icons/icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(all=>Promise.all(all.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
 const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==self.location.origin)return;
 if(new URL(r.url).pathname.endsWith('/nodes.json')){
  e.respondWith(fetch(r).then(resp=>{if(resp.ok){const clone=resp.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(r,clone)));}return resp;}).catch(()=>caches.match(r)));return;
 }
 e.respondWith(caches.match(r).then(cache=>cache||fetch(r)));
});
