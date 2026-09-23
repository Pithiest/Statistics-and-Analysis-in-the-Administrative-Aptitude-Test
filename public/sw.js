const CACHE_PREFIX = "pithiest-xingce-";
// Each generation stays isolated until every required entry asset is cached.
const CACHE_NAME = `${CACHE_PREFIX}v13`;
const SHELL_URL = "/index.html";
const SHELL_ASSETS = ["/", SHELL_URL, "/manifest.webmanifest", "/pithiest-icon.svg"];
const NAVIGATION_TIMEOUT_MS = 1200;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.all(SHELL_ASSETS.map((url) => fetchAndCache(cache, url))).then(() => warmEntryAssets(cache)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const currentVersion = cacheVersion(CACHE_NAME);
        const previousCache = keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME && cacheVersion(key) < currentVersion)
          .sort((left, right) => cacheVersion(right) - cacheVersion(left))[0];
        return Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME && key !== previousCache)
            .map((key) => caches.delete(key))
        );
      })
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
  const cached = await matchCached(SHELL_URL);
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
  const cached = await matchCached(request);
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

async function warmEntryAssets(cache) {
  const response = await fetch(SHELL_URL, { cache: "reload" });
  if (!isCacheable(response)) throw new Error("The application shell could not be cached");
  await cache.put(SHELL_URL, response.clone());
  const html = await response.text();
  const urls = [...new Set([...html.matchAll(/["'](\/assets\/[^"']+)["']/g)].map((match) => match[1]))];
  if (!urls.some((url) => /\.(?:m?js)(?:[?#]|$)/i.test(url))) {
    throw new Error("The application entry script is missing from the shell");
  }
  await Promise.all(urls.map((url) => fetchAndCacheRequired(cache, url)));
}

async function fetchAndCacheRequired(cache, url) {
  const response = await fetch(url, { cache: "reload" });
  if (!isCacheable(response)) throw new Error(`A required application asset could not be cached: ${url}`);
  await cache.put(url, response);
}

async function matchCached(request) {
  const current = await caches.open(CACHE_NAME);
  const currentMatch = await current.match(request);
  if (currentMatch) return currentMatch;

  const previousKeys = (await caches.keys())
    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME && cacheVersion(key) < cacheVersion(CACHE_NAME))
    .sort((left, right) => cacheVersion(right) - cacheVersion(left));
  for (const key of previousKeys) {
    const previous = await caches.open(key);
    const match = await previous.match(request);
    if (match) return match;
  }
  return undefined;
}

function cacheVersion(name) {
  return Number(name.slice(CACHE_PREFIX.length).replace(/^v/i, "")) || 0;
}

function isCacheable(response) {
  return response && response.ok && response.type === "basic";
}
