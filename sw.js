// Offline layer. The app shell must cache for install/offline to work; optional files (your data seed) never block it.
const CACHE = 'max-effort-v9-7-2';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'css/styles.css',
  'js/app.js', 'js/engine.js', 'js/plan.js', 'js/db.js', 'js/importers.js', 'js/coach_prompt.js', 'js/export.js'];
const OPTIONAL = ['data/seed.json'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    await Promise.all(OPTIONAL.map((u) => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
