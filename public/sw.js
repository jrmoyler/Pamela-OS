/* Pamela OS service worker — app-shell caching + offline fallback. */
const VERSION = "pamela-os-v1";
// Build files are content-hashed, so each deploy adds new names; cap the cache so old ones don't pile up.
const MAX_STATIC = 300;
const SHELL = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache data/API calls

  // Static build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            // Never pin an error (e.g. a 404 for a chunk from an old deploy) in the cache.
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy).then(() => trim(c)));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: network-first, fall back to the offline page.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html").then((hit) => hit || Response.error())));
  }
});

async function trim(cache) {
  const keys = (await cache.keys()).filter((k) => new URL(k.url).pathname.startsWith("/_next/static/"));
  // Cache keys come back in insertion order, so the oldest go first.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_STATIC)).map((k) => cache.delete(k)));
}
