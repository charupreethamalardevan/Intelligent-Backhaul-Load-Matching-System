const mongoose = require('mongoose');

// ER-diagram entity: TRUCK. Replaces the old Vehicle collection (see
// Vehicle.js, kept temporarily only for the migration script in
// scripts/migrateTo22Tables.js) -- same real fields, but with 2 fixes the
// Design Consistency Review flagged against the old schema:
//   1. truckType/bodyType are now 2 separate dimensions (capacity class vs
//      body style), matching Project Overview Section 3, instead of one
//      ambiguous `vehicleType` enum that conflated both.
//   2. routeId links a truck to the ROUTE it has actually registered
//      (Project Overview Objective 1 / SRS 2.2: "truck and planned route
//      are entered") -- the old schema had no such field.
const CAPACITY_CLASSES = ['mini', 'medium', 'heavy', 'multi_axle'];
const BODY_TYPES = ['open_body', 'closed_container', 'flatbed_trailer', 'tanker', 'reefer', 'tipper'];

// Kept for backward compatibility with the matching engine and existing
// frontend selects, which still speak the old combined vocabulary -- see
// utils/truckTypeMapping.js, which converts between the two.
const VEHICLE_TYPES = ['mini_truck', 'open_truck', 'container_truck', 'refrigerated_truck', 'tanker', 'trailer'];

const truckSchema = new mongoose.Schema(
  {
    truckOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'TruckOwner', required: true },
    vehicleNumber: { type: String, required: true, trim: true },
    capacityClass: { type: String, enum: CAPACITY_CLASSES },
    bodyType: { type: String, enum: BODY_TYPES },
    // Still stored for now so every existing route/ML call that reads
    // `vehicleType` keeps working unmodified during the migration --
    // derived from capacityClass+bodyType when both are known, otherwise
    // set directly (old-style) at registration. See utils/truckTypeMapping.js.
    vehicleType: { type: String, required: true, enum: VEHICLE_TYPES },
    maxCapacityTonnes: { type: Number, required: true, min: 0.1 },
    fuelType: { type: String, enum: ['diesel', 'petrol', 'cng', 'electric'], default: 'diesel' },
    cargoCompatibility: [String],
    driverName: String,
    driverPhone: String,
    assignedDriverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },
    // The planned ROUTE this truck is currently registered against, if
    // any (Design Consistency Review finding #5). Null until the owner/
    // driver plans a trip for it.
    routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', default: null },
    currentLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      label: { type: String, default: null },
    },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Truck || mongoose.model('Truck', truckSchema);
module.exports.CAPACITY_CLASSES = CAPACITY_CLASSES;
module.exports.BODY_TYPES = BODY_TYPES;
module.exports.VEHICLE_TYPES = VEHICLE_TYPES;
