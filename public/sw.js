const CACHE = "tqqq-v2";

// Dev serves from localhost with Next.js rebuilding chunks on every change;
// the cache-first strategy below would keep serving stale copies and produce
// "module factory is not available" errors. Registering the SW at all in dev
// (rather than skipping it, as before) is what lets push notifications be
// tested locally — this flag just keeps it a no-op for asset caching there.
const IS_LOCAL = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

const PRECACHE = ["/", "/levels", "/chart", "/options"];

self.addEventListener("install", (event) => {
  if (!IS_LOCAL) {
    event.waitUntil(
      caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
    );
  }
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (event) => {
  // No caching at all in dev — let every request fall through to the network.
  if (IS_LOCAL) return;

  const { request } = event;
  const url = new URL(request.url);

  // Never cache API routes — always go to network
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests: network-first, fall back to cached page or root
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () => caches.match(request).then((cached) => cached || caches.match("/"))
      )
    );
    return;
  }

  // Static assets (_next/static, images, fonts): cache-first
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/fonts/") ||
    /\.(png|jpg|jpeg|svg|ico|woff2?)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
  }
});
