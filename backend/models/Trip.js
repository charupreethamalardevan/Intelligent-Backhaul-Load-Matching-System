const mongoose = require('mongoose');

// A Trip is a Vehicle's AVAILABILITY posting -- "this vehicle will be
// driving from source to destination from this time, find it a backhaul
// load" (SRS Section 4, Step 1). The Vehicle profile is static; a Trip is
// one instance of it being available for a specific return route.
const tripSchema = new mongoose.Schema(
  {
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    source: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    availableFrom: { type: Date, required: true },
    status: { type: String, enum: ['available', 'matched', 'completed', 'cancelled'], default: 'available' },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Trip || mongoose.model('Trip', tripSchema);
