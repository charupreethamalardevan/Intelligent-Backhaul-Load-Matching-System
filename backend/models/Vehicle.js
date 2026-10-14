const mongoose = require('mongoose');

const VEHICLE_TYPES = ['mini_truck', 'open_truck', 'container_truck', 'refrigerated_truck', 'tanker', 'trailer'];

const vehicleSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vehicleNumber: { type: String, required: true, trim: true },
    vehicleType: { type: String, required: true, enum: VEHICLE_TYPES },
    maxCapacityTonnes: { type: Number, required: true, min: 0.1 },
    fuelType: { type: String, enum: ['diesel', 'petrol', 'cng', 'electric'], default: 'diesel' },
    // What kinds of cargo this vehicle can carry, e.g. ['general','fragile'].
    // Used as a soft signal in match scoring, not a hard constraint --
    // vehicleType vs Load.requiredVehicleType is the hard constraint.
    cargoCompatibility: [String],
    driverName: String,
    driverPhone: String,
    // The real link to the Fleet Driver (role==='driver') operating this
    // vehicle -- only a Fleet Owner can set this (routes/vehicles.js
    // PATCH /:id/assign-driver), and only to a driver who signed up with
    // this Fleet Owner's own invite code. A driver may request a load
    // ONLY for the vehicle they're assigned to here (see routes/requests.js
    // POST /). driverName/driverPhone above stay as free-text display
    // fields; this is the real queryable relationship. Null = unassigned.
    assignedDriverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Vehicle || mongoose.model('Vehicle', vehicleSchema);
module.exports.VEHICLE_TYPES = VEHICLE_TYPES;
