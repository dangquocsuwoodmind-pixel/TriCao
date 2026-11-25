// Service worker ứng dụng điện thoại Trí Cao: lưu đệm giao diện, KHÔNG lưu đệm dữ liệu /api.
const CACHE = 'tricao-m-v1';
const SHELL = ['/m/', '/m/app.js', '/shared/core.js', '/m/manifest.webmanifest', '/m/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // Ưu tiên mạng để luôn có bản mới; mất mạng thì dùng bản đã lưu
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && r.type === 'basic') { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('/m/'))));
});
