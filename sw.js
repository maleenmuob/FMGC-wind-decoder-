// Offline cache for the FMGC Wind Decoder.
// Bump VERSION whenever any app file changes so iPads pick up the update.
const VERSION = "v1";
const CACHE = `fmgc-wind-${VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./decoder.js",
  "./pdf-lines.js",
  "./manifest.webmanifest",
  "./vendor/pdfjs/pdf.min.mjs",
  "./vendor/pdfjs/pdf.worker.min.mjs",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" })))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("fmgc-wind-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

// Cache first; only same-origin GET requests are ever handled.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() =>
        req.mode === "navigate" ? caches.match("./index.html") : Response.error()
      );
    })
  );
});
