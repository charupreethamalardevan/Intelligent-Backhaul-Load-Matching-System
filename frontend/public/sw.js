// Offline backup map (Addendum 32). This service worker does exactly one
// thing: cache OpenStreetMap tile responses as they're fetched, so a map
// area the user has already looked at (while online) still renders -- at
// whatever zoom/position was actually viewed -- when the network is down
// or flaky. It never caches anything else; the app itself (JS/CSS/API
// calls) is left alone, since stale app code or stale booking data would
// be actively wrong, where a stale map tile of a real place is still
// useful.
//
// Strategy: cache-first for tile requests. A tile that's already cached is
// served instantly from cache AND re-fetched in the background to refresh
// it ("stale-while-revalidate") -- tiles basically never change, so
// serving the cached one first costs nothing and avoids a network
// round-trip on every pan/zoom once an area's been seen.

const TILE_CACHE = 'iblms-map-tiles-v1';
const TILE_HOST_PATTERN = /tile\.openstreetmap\.org/;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !TILE_HOST_PATTERN.test(request.url)) return;

  event.respondWith(
    caches.open(TILE_CACHE).then(async (cache) => {
      const cached = await cache.match(request);

      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      // Cached tile -> serve it immediately, refresh in the background.
      // No cached tile -> wait for the network; if that also fails (truly
      // offline, never seen this tile before) there's nothing to show.
      return cached || (await networkFetch) || Response.error();
    }),
  );
});
