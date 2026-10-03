const CACHE='mechyard-v1';
const LOCAL=['./','index.html','style.css','game.js','manifest.webmanifest','icon.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(LOCAL))));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{
    const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return r;
  }).catch(()=>hit)));
});
