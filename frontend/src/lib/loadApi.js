import { apiFetch } from './api.js';

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const listLoads = () => apiFetch('/loads').then((d) => d.loads);
export const getLoad = (id) => apiFetch(`/loads/${id}`).then((d) => d.load);
export const createLoad = (data) => apiFetch('/loads', json('POST', data)).then((d) => d.load);
export const updateLoad = (id, data) => apiFetch(`/loads/${id}`, json('PUT', data)).then((d) => d.load);
export const deleteLoad = (id) => apiFetch(`/loads/${id}`, { method: 'DELETE' });

// Open loads near a place, closest first -- no trip/vehicle needed yet.
// Used to browse "what's around here" when choosing where to head next
// on a multi-stop return journey (re-run with a new location each time).
export const loadsNear = (location, radiusKm) =>
  apiFetch(`/loads/near?location=${encodeURIComponent(location)}${radiusKm ? `&radiusKm=${radiusKm}` : ''}`);
