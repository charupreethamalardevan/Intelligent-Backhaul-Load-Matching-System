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
// AddressInput.jsx's free-text autocomplete -- proxies OpenStreetMap
// Nominatim through the backend (backend/routes/geocode.js), never calls
// it directly from the browser (keeps the required User-Agent + rate
// limit in one place). Returns [] (not a throw) on a network/API hiccup
// so a slow/unreachable geocoder just shows no suggestions for a moment
// rather than an error state -- the quick-pick cities and map-click
// fallback still work either way.
export function searchAddress(query) {
  return apiFetch(`/geocode/search?q=${encodeURIComponent(query)}`)
    .then((d) => d.results || [])
    .catch(() => []);
}

// Turns a map click or a live GPS fix into a human-readable label.
// Always resolves (never rejects) -- on failure, falls back to the raw
// coordinates as the label, same safety net the backend route itself
// already has.
export function reverseGeocode(lat, lng) {
  return apiFetch(`/geocode/reverse?lat=${lat}&lng=${lng}`).catch(() => ({
    label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    lat,
    lng,
  }));
}

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
