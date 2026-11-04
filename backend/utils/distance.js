// Distance helpers for the matching/profitability engines. Every
// source/destination/pickup/delivery is now a real {label, lat, lng}
// point (models/locationSchema.js) -- geocoded from an address, clicked
// on the map, or the user's live GPS -- not only one of the ~16
// hardcoded cities below. `distanceKm` is the one function the matching
// engine and profitability estimator actually call now; it works on any
// two coordinate pairs, straight-line (haversine), same documented
// "estimate, not a real road distance" caveat as before.
//
// CITY_COORDS/cityDistanceKm/isKnownCity are kept (not deleted) for two
// things that still deliberately work on a fixed, named-city vocabulary
// rather than free addresses: the Route Insights "Demand forecast" panel
// (its ML model and historical DemandForecast rows are keyed by these
// city names, not arbitrary coordinates -- see routes/insights.js) and
// the quick-pick city chips the new address input offers alongside
// search, so a user can still jump straight to a major hub without
// typing or waiting on a geocoder.
const CITY_COORDS = {
  chennai: [13.0827, 80.2707],
  madurai: [9.9252, 78.1198],
  coimbatore: [11.0168, 76.9558],
  bengaluru: [12.9716, 77.5946],
  trichy: [10.7905, 78.7047],
  salem: [11.6643, 78.146],
  hyderabad: [17.385, 78.4867],
  mumbai: [19.076, 72.8777],
  delhi: [28.7041, 77.1025],
  kolkata: [22.5726, 88.3639],
  vijayawada: [16.5062, 80.648],
  kochi: [9.9312, 76.2673],
  pune: [18.5204, 73.8567],
  vellore: [12.9165, 79.1325],
  tirupati: [13.6288, 79.4192],
  tirunelveli: [8.7139, 77.7567],
};

function normalize(city) {
  return String(city || '').trim().toLowerCase();
}

function isKnownCity(city) {
  return !!CITY_COORDS[normalize(city)];
}

function haversineKm(a, b) {
  const R = 6371;
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Returns null (not a crash) when either city isn't in CITY_COORDS --
// kept only for the known-city-vocabulary features described above.
function cityDistanceKm(cityA, cityB) {
  const a = CITY_COORDS[normalize(cityA)];
  const b = CITY_COORDS[normalize(cityB)];
  if (!a || !b) return null;
  return Math.round(haversineKm(a, b) * 10) / 10;
}

// Accepts any two {lat, lng} points -- a geocoded address, a map click, a
// live GPS fix, or (for seed/legacy data) a resolved city -- and returns
// the straight-line distance in km, or null if either point is missing
// real coordinates. This is now the ONE distance function the matching
// engine (services/matching.js) and profitability estimator
// (services/profitability.js) call.
function distanceKm(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof a.lng !== 'number' || typeof b.lat !== 'number' || typeof b.lng !== 'number') {
    return null;
  }
  return Math.round(haversineKm([a.lat, a.lng], [b.lat, b.lng]) * 10) / 10;
}

module.exports = { CITY_COORDS, isKnownCity, haversineKm, cityDistanceKm, distanceKm };
