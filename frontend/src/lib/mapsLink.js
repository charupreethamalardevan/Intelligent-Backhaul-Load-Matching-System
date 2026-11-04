// Builds a Google Maps directions URL for a trip's source/destination
// (shared by TripMapModal's "Open in Google Maps" link and RequestsPanel's
// Track Load rows, so both stay in sync). Prefers real lat/lng
// (locationSchema.js) for a precise pin; falls back to the place's text
// label for older/unmigrated string data so the link still works, just
// less precisely pinned.
import { locationLabel } from './locationLabel.js';

function mapsPoint(loc) {
  if (!loc) return '';
  if (typeof loc === 'object' && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
    return `${loc.lat},${loc.lng}`;
  }
  return encodeURIComponent(locationLabel(loc) || '');
}

export function googleMapsDirectionsUrl(source, destination) {
  if (!source || !destination) return null;
  return `https://www.google.com/maps/dir/?api=1&origin=${mapsPoint(source)}&destination=${mapsPoint(destination)}&travelmode=driving`;
}

// Resolves the right "origin" point for a booking's navigation link --
// prefers its live-tracked GPS position (request.liveLocation) over the
// trip's static starting point, whenever the vehicle side has actually
// shared a real GPS fix. Without this, "Open in Google Maps" kept
// routing from wherever the trip originally started even after the truck
// had driven most of the way, instead of from where it actually is now --
// the exact thing the in-app map's own red "Live" marker already shows
// (see TripMap.jsx's own hasLive check, which this mirrors). liveLocation
// is only ever written from a real GPS reading, never the simulated
// preview (see TripMap.jsx's own comment on that), so it's always safe
// to treat as the truck's genuine current position when present.
export function tripOrigin(request) {
  const live = request?.liveLocation;
  if (live && live.lat != null && live.lng != null) return live;
  return request?.tripId?.source || null;
}
