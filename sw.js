// Service worker minimo: mette in cache i file dell'app così si apre subito.
const CACHE = 'cerca-v9';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'novita.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' = scarica da GitHub, ignorando le copie che il browser tiene per ~10 minuti
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Prima la rete, poi la cache se offline. Le chiamate a YouTube non vengono toccate.
// cache: 'no-cache' = chiede sempre a GitHub se il file è cambiato, così gli aggiornamenti arrivano subito.
self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request))
  );
});
