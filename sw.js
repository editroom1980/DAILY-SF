// DAILY-SF の service worker：画面の部品は先に覚えておく（電波が無くても開ける）。
// 本棚のデータ（GitHub の API）は app.js が自分で取りに行き、朗読は app.js が Cache Storage に直近6本だけ覚える。
const 版 = 'daily-sf-v4';
const 部品 = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(版).then(c => c.addAll(部品)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== 版 && k !== 'dsf-audio').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;
  // 画面の部品：まず取りに行き（新しい版を早く届ける）、取れなければ覚えたもの
  e.respondWith(fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(版).then(k => k.put(r, c)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
});

// 新しい短編の知らせ（Mac の 通知/送る.js が送る）。中身は {title, body, badge}
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: '毎日のSF短編', body: e.data ? e.data.text() : '' }; }
  const 札 = self.navigator && self.navigator.setAppBadge && d.badge ? self.navigator.setAppBadge(d.badge).catch(() => { }) : Promise.resolve();
  e.waitUntil(Promise.all([札, self.registration.showNotification(d.title || '毎日のSF短編', { body: d.body || '', icon: 'icon-192.png', tag: 'daily-sf' })]));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
