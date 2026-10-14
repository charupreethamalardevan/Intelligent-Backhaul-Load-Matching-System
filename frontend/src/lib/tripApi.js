import { apiFetch } from './api.js';

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const listTrips = () => apiFetch('/trips').then((d) => d.trips);
export const getTrip = (id) => apiFetch(`/trips/${id}`).then((d) => d.trip);
export const createTrip = (data) => apiFetch('/trips', json('POST', data)).then((d) => d.trip);
export const updateTrip = (id, data) => apiFetch(`/trips/${id}`, json('PUT', data)).then((d) => d.trip);
export const deleteTrip = (id) => apiFetch(`/trips/${id}`, { method: 'DELETE' });
