import { apiFetch } from './api.js';

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const listRequests = () => apiFetch('/requests').then((d) => d.requests);
export const getRequest = (id) => apiFetch(`/requests/${id}`).then((d) => d.request);
export const createRequest = (tripId, loadId) => apiFetch('/requests', json('POST', { tripId, loadId })).then((d) => d.request);
export const updateRequestStatus = (id, status) => apiFetch(`/requests/${id}/status`, json('PATCH', { status })).then((d) => d.request);
// Called from TripMap's "Share my location" toggle (driver/owner side
// only, and only while the booking is pickup/in_transit -- the backend
// re-checks both, this is just what lets the UI post a position at all).
// `source` is optional and omitted for a real GPS reading (backend
// defaults to 'real_gps'); TripMap's simulated-preview animation passes
// 'simulated' so the point is logged to TruckLocationLog without ever
// being written into match.liveLocation / shown as a real "Live" marker
// (see routes/matches.js's PATCH /:id/location).
export const updateRequestLocation = (id, lat, lng, source) => apiFetch(`/requests/${id}/location`, json('PATCH', { lat, lng, source })).then((d) => d.liveLocation);

export const STATUS_LABELS = {
  pending_fleet_approval: 'Pending Fleet Approval',
  requested: 'Requested',
  accepted: 'Accepted',
  confirmed: 'Confirmed',
  pickup: 'Pickup',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

// What each status can move to next -- mirrors backend/routes/requests.js's
// ALLOWED_TRANSITIONS, used only to decide which action buttons to show.
// The backend is the real authority; a disallowed click just surfaces its
// error message. From pending_fleet_approval, 'requested' IS the Fleet
// Owner's approval (only they may click it -- RequestsPanel filters this
// per-viewer, since the backend restricts it to the Fleet Owner alone).
export const NEXT_ACTIONS = {
  pending_fleet_approval: ['requested', 'rejected', 'cancelled'],
  requested: ['accepted', 'rejected', 'cancelled'],
  accepted: ['confirmed', 'cancelled'],
  confirmed: ['pickup', 'cancelled'],
  pickup: ['in_transit'],
  in_transit: ['delivered'],
  delivered: ['completed'],
};
