import { getLocationCoords } from './locationApi.js';

// Resolves a source/destination/pickup/delivery field to a plain
// {lat, lng, label} point, regardless of which shape it's currently in:
// the new {label, lat, lng} object every location field stores directly
// since AddressInput.jsx replaced the city dropdown, the Route Insights
// panel's still-city-only picker (a plain known-city-id string, e.g.
// "chennai" -- see RouteInsightsTab in FleetDashboard.jsx for why that
// one stays city-only), or (only for data from before this change, or
// not yet run through scripts/migrateLocationsToCoords.js) a legacy
// known-city-id string on a Trip/Load itself.
export function resolvePointSync(loc) {
  if (loc && typeof loc === 'object' && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
    return { lat: loc.lat, lng: loc.lng, label: loc.label };
  }
  return null;
}

export function resolvePoint(loc) {
  const direct = resolvePointSync(loc);
  if (direct) return Promise.resolve(direct);
  if (typeof loc === 'string' && loc) {
    return getLocationCoords()
      .then((map) => map[loc.toLowerCase()] || null)
      .catch(() => null);
  }
  return Promise.resolve(null);
}
