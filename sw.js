const CACHE = "signals-v1";
const URLS = ["/github.com-new/","/github.com-new/index.html","/github.com-new/manifest.json","/github.com-new/icon.svg"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(URLS)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.url.includes("api.") || e.request.url.includes("googleapis")) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).catch(() => r)));
});