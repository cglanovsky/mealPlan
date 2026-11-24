const CACHE_NAME = "mealplan-pwa-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./print.css",
  "./config.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512-v2.png",
  "./favicon.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
});

self.addEventListener("fetch", event => {
  if (event.request.url.includes("script.google.com")) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
