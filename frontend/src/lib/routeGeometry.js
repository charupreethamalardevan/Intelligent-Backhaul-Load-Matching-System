// Resolves a real, road-following path between two known cities, so the
// map can draw an actual route (and a simulated marker can travel along
// it) instead of the straight dashed line between two pins that
// RoutePreviewMap/TripMap used before. Uses OSRM's free, keyless public
// routing API (https://project-osrm.org) -- this is purely a map-drawing
// aid. It never feeds into the matching engine or the profitability
// estimate, which stay on backend/utils/distance.js's documented
// straight-line (haversine) estimate on purpose, so nothing about the
// scoring methodology described in the report changes.
//
// Falls back to the old straight two-point line if OSRM can't be reached
// (offline machine, OSRM briefly down, demo wifi) -- the map should never
// break just because a free third-party service is unavailable for a
// moment.

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const FETCH_TIMEOUT_MS = 6000;

// "lat1,lng1|lat2,lng2" -> { path, distances, total }. In-memory only
// (cleared on page reload) -- every re-render of the same trip/booking
// row asks for the same source/destination pair, so this keeps that from
// re-fetching OSRM on every render.
const cache = new Map();

function roundKey(n) {
  return Math.round(n * 1000) / 1000; // ~100m grid is plenty for a cache key
}

function key(a, b) {
  return `${roundKey(a.lat)},${roundKey(a.lng)}|${roundKey(b.lat)},${roundKey(b.lng)}`;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Builds the cumulative-distance table a path needs so a marker can be
// placed at "40% of the way along the road", not just "40% of the way
// between the two endpoints" -- the two are very different once the road
// actually bends.
function withCumulative(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i += 1) {
    distances.push(
      distances[i - 1] +
        haversineKm({ lat: points[i - 1][0], lng: points[i - 1][1] }, { lat: points[i][0], lng: points[i][1] }),
    );
  }
  return { path: points, distances, total: distances[distances.length - 1] };
}

function straightLineFallback(source, destination) {
  return withCumulative([
    [source.lat, source.lng],
    [destination.lat, destination.lng],
  ]);
}

// Returns a Promise<{ path: [[lat,lng], ...], distances: [cumulativeKm, ...], total: km }>.
// `path` and `distances` are always the same length and index-aligned.
// Never rejects -- a routing failure resolves to the straight-line
// fallback instead, so callers never need a .catch().
export function getRoutePath(source, destination) {
  if (!source || !destination) {
    return Promise.resolve(straightLineFallback(source || { lat: 0, lng: 0 }, destination || { lat: 0, lng: 0 }));
  }
  const k = key(source, destination);
  if (cache.has(k)) return Promise.resolve(cache.get(k));

  const url = `${OSRM_BASE}/${source.lng},${source.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;

  return fetch(url, { signal: controller ? controller.signal : undefined })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`OSRM responded ${r.status}`))))
    .then((data) => {
      const coords = data && data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) throw new Error('OSRM returned no route geometry');
      const points = coords.map(([lng, lat]) => [lat, lng]);
      const result = withCumulative(points);
      cache.set(k, result);
      return result;
    })
    .catch(() => {
      // Cache the fallback too, so a dead/unreachable OSRM doesn't retry
      // (and wait out the timeout again) on every render.
      const result = straightLineFallback(source, destination);
      cache.set(k, result);
      return result;
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
}

// Position at `frac` (0..1) along a cumulative-distance-indexed path --
// constant speed along the actual road shape, not along the straight
// bounding line between the two endpoints. Works the same for a real
// OSRM path or the straight-line fallback (a 2-point "path").
export function positionAtFraction(route, frac) {
  if (!route || !route.path || route.path.length === 0) return null;
  const { path, distances, total } = route;
  if (path.length === 1 || total === 0) return { lat: path[0][0], lng: path[0][1] };

  const targetKm = Math.max(0, Math.min(1, frac)) * total;
  let i = 1;
  while (i < distances.length && distances[i] < targetKm) i += 1;
  if (i >= path.length) i = path.length - 1;

  const segFrac = distances[i] === distances[i - 1] ? 0 : (targetKm - distances[i - 1]) / (distances[i] - distances[i - 1]);
  const [lat1, lng1] = path[i - 1];
  const [lat2, lng2] = path[i];
  return {
    lat: lat1 + (lat2 - lat1) * segFrac,
    lng: lng1 + (lng2 - lng1) * segFrac,
  };
}
