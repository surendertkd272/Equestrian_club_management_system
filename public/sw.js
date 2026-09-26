// Equiwings service worker — stale-while-revalidate for GETs.
// Strategy:
//   - GET requests that succeed: stash in a cache so we can serve them when
//     the network is flaky (typical at outdoor arenas).
//   - Cache hits show immediately; network response then overwrites the
//     cached copy in the background.
//   - Non-GET (POST/PATCH/DELETE) always hits the network so writes are
//     never replayed from cache.
//   - HTML navigations get the same treatment so a coach can re-open
//     /attendance on a flat-zero bar.

// Bump this string to force every client to drop its old cached pages on the
// next visit (the activate handler deletes any cache name != CACHE_NAME).
// v3: flush stale page HTML that still showed internal "§" spec labels.
// v4: navigations are now network-first (see fetch handler) — stops stale
//     cached HTML from referencing JS chunks a later deploy deleted, which
//     surfaced as "client-side exception" / ChunkLoadError on some pages.
// v5: ONLY content-hashed static files are served cache-first now. Everything
//     else — navigations, in-app page loads (RSC payloads), API reads — is
//     network-first. v4 still answered in-app navigation and router.refresh()
//     from cache before the network: after a deploy users kept running old
//     code (the Record Payment dialog's removed ₹3,000 cap came back from
//     cache), and after a save the refreshed page could show pre-save data —
//     an invoice still "outstanding" after it was paid. Bumping the name also
//     deletes every client's v4 cache on activation.
const CACHE_NAME = "ew-cache-v5";

// Immutable: Next's build output is content-hashed (a new deploy means new
// URLs), and the rest are static public files. Safe to serve from cache.
function isImmutable(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf)$/i.test(url.pathname)
  );
}

// Sensitive / fast-moving endpoints we never want stale copies of. The
// service worker should pass-through to the network for any path that
// matches.
const NO_CACHE_PREFIXES = [
  "/api/auth",
  "/api/owner",
  "/api/account",
  "/api/notifications",
  "/api/search",
  "/api/cron",
  "/api/webhooks",
  "/api/payments",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// `postMessage({type:"PURGE_CACHE"})` is sent from the logout flow so the
// next user on a shared device can't see the previous user's cached pages.
// We drop the entire stale-while-revalidate cache; the service worker will
// repopulate it on demand from the next session's GETs.
self.addEventListener("message", (event) => {
  if (event?.data?.type === "PURGE_CACHE") {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      })(),
    );
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only GETs are cached. POSTs are always live.
  if (req.method !== "GET") return;

  // Skip cross-origin (analytics, fonts CDNs etc.) — let the browser handle.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Skip Next.js HMR + RSC payloads while in dev; the cache busts itself
  // on reload but the HMR socket gets confused if we intercept.
  if (url.pathname.startsWith("/_next/webpack-hmr")) return;

  // Auth, owner-portal, notifications and other sensitive/fast-moving
  // endpoints should always hit the network — stale data here is a bug.
  if (NO_CACHE_PREFIXES.some((p) => url.pathname.startsWith(p))) return;

  // Content-hashed and static assets: cache-first, then network. These never
  // change under the same URL, so a cached copy is never stale.
  if (isImmutable(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && res.status === 200 && res.type === "basic") cache.put(req, res.clone()).catch(() => {});
        return res;
      })(),
    );
    return;
  }

  // Everything else — HTML navigations, in-app page loads (Next's RSC fetches
  // carry `RSC: 1` and a `_rsc` query, and are NOT mode "navigate", which is
  // how v4 served them stale), and API reads: NETWORK-FIRST. The cache is only
  // an offline fallback, which is what it was for — a flaky arena connection.
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res && res.status === 200 && res.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      } catch {
        const cached = await caches.match(req);
        return cached || Response.error();
      }
    })(),
  );
});
