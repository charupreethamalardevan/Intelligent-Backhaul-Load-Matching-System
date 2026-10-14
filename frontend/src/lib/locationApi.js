import { apiFetch } from './api.js';

// The known-city list every pickup/delivery/source/destination dropdown
// draws from -- served by the backend (routes/index.js) so it can never
// drift from utils/distance.js's own CITY_COORDS, the only cities the
// matching/profitability engines can actually estimate distance between.
export const listLocations = () => apiFetch('/locations').then((d) => d.locations);

let coordsCache = null;
// A lowercase-id -> {lat, lng, label} lookup for TripMap.jsx, built from
// this same locations list (now carrying lat/lng too, see routes/index.js)
// so a trip's source/destination strings -- already one of these ids,
// chosen from a LocationSelect dropdown -- resolve straight to real
// coordinates without a second, hand-kept coordinate table to drift out
// of sync with the backend's CITY_COORDS.
export function getLocationCoords() {
  if (coordsCache) return Promise.resolve(coordsCache);
  return listLocations().then((locs) => {
    coordsCache = {};
    for (const loc of locs) {
      coordsCache[String(loc.id).toLowerCase()] = { lat: loc.lat, lng: loc.lng, label: loc.label };
    }
    return coordsCache;
  });
}
