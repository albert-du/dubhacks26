/* Dump service worker — app shell + static assets for flaky venue Wi-Fi.
 * Uploads are queued in IndexedDB by the page itself (lib/client/uploadQueue.ts),
 * so this worker never touches /api. Media files are never cached here: when a
 * Dumpster burns, nothing should linger on guests' phones beyond the HTTP cache. */
const CACHE = "dump-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.png", "/icon-192.png", "/brand/mark-green.webp", "/brand/fire.webp"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Hashed build assets: cache-first, forever.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: network-first so rooms are fresh; fall back to the last copy when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.ok ? res.clone() : null;
          caches.open(CACHE).then((c) => (copy ? c.put(req, copy) : c.delete(req)));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
    );
  }
});

// The page tells us when a room burns so its cached shell goes too.
self.addEventListener("message", (e) => {
  if (e.data?.type === "forget-room" && typeof e.data.path === "string") {
    caches.open(CACHE).then((c) => Promise.all([c.delete(e.data.path), c.delete(`${e.data.path}/stage`)]));
  }
});
