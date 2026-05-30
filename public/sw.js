const CACHE_PREFIX = "pithiest-xingce-";
const CACHE_NAME = `${CACHE_PREFIX}v8`;
const SHELL_URL = "/index.html";
const SHELL_ASSETS = ["/", SHELL_URL, "/manifest.webmanifest", "/pithiest-icon.svg"];
const NAVIGATION_TIMEOUT_MS = 3500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.all(SHELL_ASSETS.map((url) => fetchAndCache(cache, url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/pithiest-icon.svg") {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirstNavigation(request) {
  const cached = await caches.match(SHELL_URL);
  const network = fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(SHELL_URL, response.clone());
      }
      return response;
    })
    .catch(() => cached || Response.error());

  if (!cached) return network;

  return Promise.race([
    network,
    new Promise((resolve) => {
      setTimeout(() => resolve(cached), NAVIGATION_TIMEOUT_MS);
    })
  ]);
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request).then(async (response) => {
    if (isCacheable(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  });
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  return network;
}

async function fetchAndCache(cache, url) {
  try {
    const response = await fetch(url, { cache: "reload" });
    if (isCacheable(response)) await cache.put(url, response);
  } catch {
    // Best-effort warmup only. Failed optional assets must not block the new worker.
  }
}

function isCacheable(response) {
  return response && response.ok && response.type === "basic";
}
