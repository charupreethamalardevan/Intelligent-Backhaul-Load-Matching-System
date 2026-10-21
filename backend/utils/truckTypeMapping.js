const { CAPACITY_CLASSES, BODY_TYPES, VEHICLE_TYPES } = require('../models/Truck');

// Truck.js splits the old single `vehicleType` enum (mini_truck/open_truck/
// container_truck/refrigerated_truck/tanker/trailer) into the 2 real
// dimensions the Project Overview describes -- capacityClass (mini/medium/
// heavy/multi_axle) and bodyType (open_body/closed_container/
// flatbed_trailer/tanker/reefer/tipper) -- per the Design Consistency
// Review's finding #7. Every existing route, the matching engine
// (services/matching.js), the ML microservice, and the frontend's vehicle-
// type select still speak the old combined vocabulary, so Truck.js keeps
// storing both: the legacy `vehicleType` (required, drives every existing
// comparison) AND the new 2-dimensional pair (optional, shown wherever the
// UI wants the more precise breakdown). This file is the one place that
// translates between them, so the mapping is never duplicated.
const VEHICLE_TYPE_TO_DIMENSIONS = {
  mini_truck: { capacityClass: 'mini', bodyType: 'open_body' },
  open_truck: { capacityClass: 'medium', bodyType: 'open_body' },
  container_truck: { capacityClass: 'heavy', bodyType: 'closed_container' },
  refrigerated_truck: { capacityClass: 'heavy', bodyType: 'reefer' },
  tanker: { capacityClass: 'heavy', bodyType: 'tanker' },
  trailer: { capacityClass: 'multi_axle', bodyType: 'flatbed_trailer' },
};

// Inverse lookup, built once -- "closed_container heavy" -> 'container_truck'.
const DIMENSIONS_TO_VEHICLE_TYPE = {};
for (const [vehicleType, { capacityClass, bodyType }] of Object.entries(VEHICLE_TYPE_TO_DIMENSIONS)) {
  DIMENSIONS_TO_VEHICLE_TYPE[`${capacityClass}:${bodyType}`] = vehicleType;
}

// Given the legacy vehicleType the frontend/registration form already
// sends, returns the matching { capacityClass, bodyType } pair to store
// alongside it. Falls back to the closest reasonable guess if an unknown
// value somehow arrives, rather than throwing.
function dimensionsFromVehicleType(vehicleType) {
  return VEHICLE_TYPE_TO_DIMENSIONS[vehicleType] || { capacityClass: 'medium', bodyType: 'open_body' };
}

// The reverse, for any future UI that lets someone pick the 2 dimensions
// directly instead of the combined list.
function vehicleTypeFromDimensions(capacityClass, bodyType) {
  return DIMENSIONS_TO_VEHICLE_TYPE[`${capacityClass}:${bodyType}`] || 'open_truck';
}

module.exports = {
  VEHICLE_TYPE_TO_DIMENSIONS,
  dimensionsFromVehicleType,
  vehicleTypeFromDimensions,
  CAPACITY_CLASSES,
  BODY_TYPES,
  VEHICLE_TYPES,
};
