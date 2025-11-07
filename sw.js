// sw.js – offline için cache-first + version query toleransı
const CACHE_NAME = 'redstar-cbt-v8';
const ASSETS = [
  '/index.html',
  '/styles/main.css',
  '/scripts/app.js',
  '/assets/bg-clouds.jpg',
  '/assets/learjet.png',
  '/assets/brand/redstar-aviation.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/modules/demo-intro.json',
  // Splash dosyaları
  '/assets/splash/intro.mp4',
  '/assets/splash/intro.mp3',
  '/assets/splash/poster.jpg', // varsa
  // Manifest (isteğe bağlı; query'siz yol)
  '/manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Sayfa gezintileri: çevrimdışı fallback index
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  if (url.origin === location.origin) {
    // Önce tam eşleşmeyi dene (versiyonsuz istekler için)
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        // Eğer query parametreli istek (örn. ?v=rs6) cache’de yoksa,
        // aynı kaynağın query’siz halini dene:
        const cleanReq = new Request(url.pathname, { method: req.method, headers: req.headers, mode: req.mode, credentials: req.credentials, redirect: req.redirect, referrer: req.referrer, integrity: req.integrity });
        return caches.match(cleanReq).then(c2 => c2 || fetch(req));
      })
    );
  } else {
    // dış istekler: network-first (düşerse cache)
    event.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});
