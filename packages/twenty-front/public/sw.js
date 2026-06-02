/**
 * Exe CRM — Service Worker
 *
 * Strategy:
 *   Static assets (JS/CSS/fonts/images) → cache-first
 *   GraphQL + API calls → network-first (CRM data must be fresh)
 *   Navigation → network-first with offline fallback
 *
 * Ported from exe-wiki's proven offline-cache.js pattern.
 */

const CACHE_VERSION = 1;
const SHELL_CACHE = `exe-crm-shell-v${CACHE_VERSION}`;
const API_CACHE = "exe-crm-api-v1";
const OFFLINE_URL = "/offline.html";

const MAX_API_ENTRIES = 200;

// ─── Install ────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll([OFFLINE_URL]))
  );
  self.skipWaiting();
});

// ─── Activate — clean old caches ────────────────────────────────────
self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, API_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("exe-crm-") && !keep.has(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ──────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests over HTTP(S)
  if (request.method !== "GET") return;
  if (!url.protocol.startsWith("http")) return;

  // GraphQL: always network-first (CRM data must be fresh)
  if (url.pathname === "/graphql" || url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Static assets: cache-first (JS, CSS, fonts, images)
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Navigation: network-first with offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Everything else: network with cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ─── Cache trim on message ──────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "TRIM_CACHES") {
    trimCache(API_CACHE, MAX_API_ENTRIES);
  }
});

// ─── Caching strategies ─────────────────────────────────────────────

function cacheFirst(request, cacheName) {
  return caches.match(request).then(
    (cached) =>
      cached ||
      fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(cacheName).then((cache) => cache.put(request, clone));
        }
        return response;
      })
  );
}

function networkFirst(request, cacheName) {
  return fetch(request)
    .then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(cacheName).then((cache) => cache.put(request, clone));
      }
      return response;
    })
    .catch(() =>
      caches.match(request).then(
        (cached) =>
          cached ||
          new Response(JSON.stringify({ error: "offline" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
      )
    );
}

// ─── Route matchers ─────────────────────────────────────────────────

function isStaticAsset(pathname) {
  return /\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|ico|webp)(\?.*)?$/.test(
    pathname
  );
}

// ─── Cache management ───────────────────────────────────────────────

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const toDelete = keys.slice(0, keys.length - maxEntries);
  await Promise.all(toDelete.map((key) => cache.delete(key)));
}
