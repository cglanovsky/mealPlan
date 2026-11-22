const CACHE_NAME = "mealplan-pwa-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./print.css",
  "./config.js",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
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
