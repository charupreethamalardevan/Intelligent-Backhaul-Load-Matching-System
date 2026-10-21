// (no changes needed here -- updateVehicle already exists below, it just
// wasn't called from any UI yet; see FleetDashboard.jsx's VehiclesTab.)
import { apiFetch } from './api.js';

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const listVehicles = () => apiFetch('/vehicles').then((d) => d.vehicles);
export const getVehicle = (id) => apiFetch(`/vehicles/${id}`).then((d) => d.vehicle);
export const createVehicle = (data) => apiFetch('/vehicles', json('POST', data)).then((d) => d.vehicle);
export const updateVehicle = (id, data) => apiFetch(`/vehicles/${id}`, json('PUT', data)).then((d) => d.vehicle);
export const deleteVehicle = (id) => apiFetch(`/vehicles/${id}`, { method: 'DELETE' });

// Fleet Owner only: this fleet's actual registered Driver accounts (not
// invite codes -- see lib/api.js's /invites calls for those), and the
// assign/reassign action itself. driverId may be null to unassign.
export const listFleetDrivers = () => apiFetch('/vehicles/fleet-drivers').then((d) => d.drivers);
export const assignDriver = (vehicleId, driverId) =>
  apiFetch(`/vehicles/${vehicleId}/assign-driver`, json('PATCH', { driverId })).then((d) => d.vehicle);

export const VEHICLE_TYPES = ['mini_truck', 'open_truck', 'container_truck', 'refrigerated_truck', 'tanker', 'trailer'];
