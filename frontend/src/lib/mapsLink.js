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
