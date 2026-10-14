const mongoose = require('mongoose');
const { VEHICLE_TYPES } = require('./Vehicle');

// A Load is a shipper's transportation requirement (SRS Section 11).
const loadSchema = new mongoose.Schema(
  {
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pickupLocation: { type: String, required: true, trim: true },
    deliveryLocation: { type: String, required: true, trim: true },
    cargoType: { type: String, required: true, trim: true },
    cargoWeightTonnes: { type: Number, required: true, min: 0.1 },
    // 'any' means no hard vehicle-type constraint; otherwise the matching
    // engine hard-rejects a vehicle whose type doesn't match (SRS 5.3).
    requiredVehicleType: { type: String, enum: [...VEHICLE_TYPES, 'any'], default: 'any' },
    pickupDateTime: { type: Date, required: true },
    deliveryDeadline: { type: Date, required: true },
    specialRequirements: String,
    expectedPrice: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['open', 'matched', 'completed', 'cancelled'], default: 'open' },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Load || mongoose.model('Load', loadSchema);
