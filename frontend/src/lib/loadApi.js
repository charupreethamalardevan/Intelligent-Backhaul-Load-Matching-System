import { apiFetch } from './api.js';

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const listLoads = () => apiFetch('/loads').then((d) => d.loads);
export const getLoad = (id) => apiFetch(`/loads/${id}`).then((d) => d.load);
export const createLoad = (data) => apiFetch('/loads', json('POST', data)).then((d) => d.load);
export const updateLoad = (id, data) => apiFetch(`/loads/${id}`, json('PUT', data)).then((d) => d.load);
export const deleteLoad = (id) => apiFetch(`/loads/${id}`, { method: 'DELETE' });

// Open loads near a real point (any address, map click or the user's live
// location -- see AddressInput.jsx), closest first -- no trip/vehicle
// needed yet. Used to browse "what's around here" when choosing where to
// head next on a multi-stop return journey (re-run with a new point each
// time). `label` is only echoed back by the backend for display.
export const loadsNear = (lat, lng, label, radiusKm) =>
  apiFetch(
    `/loads/near?lat=${lat}&lng=${lng}${label ? `&label=${encodeURIComponent(label)}` : ''}${radiusKm ? `&radiusKm=${radiusKm}` : ''}`,
  );

// "I have no planned trip yet -- what open loads near me could this
// vehicle actually carry?" (FleetDashboard.jsx's Nearby Loads tab).
// Hard-filtered server-side by the vehicle's own capacity/type/
// availability and scored for estimated profit; each result's `load` is
// the full Load document (already real {label,lat,lng} pickup/delivery
// points), ready to hand straight to createTrip()/createRequest() if the
// driver picks one.
export const discoverLoads = ({ vehicleId, lat, lng, label, availableFrom, radiusKm }) =>
  apiFetch(
    `/loads/discover?vehicleId=${encodeURIComponent(vehicleId)}&lat=${lat}&lng=${lng}` +
      `${label ? `&label=${encodeURIComponent(label)}` : ''}` +
      `${availableFrom ? `&availableFrom=${encodeURIComponent(availableFrom)}` : ''}` +
      `${radiusKm ? `&radiusKm=${radiusKm}` : ''}`,
  );
