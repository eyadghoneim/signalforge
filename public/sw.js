// Service worker خفيف: كاش للهيكل الثابت (shell) + شبكة أولاً لأي API.
// الهدف: فتح أسرع + قابلية التثبيت كتطبيق (PWA). البيانات الحية دايماً من الشبكة.
const CACHE_NAME = 'signalforge-shell-v1';
const SHELL = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // API + أي حاجة متغيرة: شبكة أولاً، ومع الفشل نرجع للكاش إن وُجد.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => res)
        .catch(() => caches.match(req).then((c) => c || new Response(JSON.stringify({ ok: false, error: 'offline' }), { headers: { 'content-type': 'application/json' } }))),
    );
    return;
  }
  // الهيكل الثابت: كاش أولاً مع تحديث في الخلفية.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    }),
  );
});
