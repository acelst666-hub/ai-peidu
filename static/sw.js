'use strict';
const CACHE = 'ai-reader-pwa-v7';

function swUrl(path){
  // 相对当前 sw 所在目录，兼容 GitHub Pages 子路径
  return new URL(path, self.location.href).href;
}

const PRECACHE = [
  '../',
  '../index.html',
  './style.css',
  './app.js',
  './local-data.js',
  './local-api.js',
  './cloud-sync.js',
  './manifest.json',
  './icon-192.svg',
].map(swUrl);

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(PRECACHE.map((u) => c.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.pathname.includes('/api/')) return;

  // JS / HTML：网络优先，避免更新被旧缓存卡住
  const networkFirst = url.pathname.endsWith('.js')
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('/index.html');

  if(networkFirst){
    e.respondWith(
      fetch(req).then((res) => {
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if(res && res.ok && url.pathname.includes('/static/')){
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
