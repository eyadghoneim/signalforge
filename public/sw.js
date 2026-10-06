// Service worker خفيف: كاش للهيكل الثابت (shell) + شبكة أولاً للـ API ولصفحة HTML نفسها.
// الهدف: فتح أسرع أوفلاين + قابلية التثبيت كتطبيق (PWA). البيانات الحية دايماً من الشبكة،
// وصفحة التطبيق بتيجي من الشبكة أولاً عشان النشر الجديد يوصل فوراً مش من الكاش القديم.
const CACHE_NAME = 'signalforge-shell-v2';
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
  // API: شبكة فقط دائماً — الكاش مبيكتبش استجابات API أصلاً، والفولباك الأوفلاين استجابة خطأ صريحة.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => res)
        .catch(() => new Response(JSON.stringify({ ok: false, error: 'offline' }), { headers: { 'content-type': 'application/json' } })),
    );
    return;
  }
  // صفحة HTML: شبكة أولاً مع فولباك للكاش أوفلاين — يمنع عرض نسخة واجهة قديمة بعد كل نشر.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/'))),
    );
    return;
  }
  // باقي الهيكل الثابت (أيقونات/مانيفست): كاش أولاً مع تحديث في الخلفية.
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
