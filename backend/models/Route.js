const mongoose = require('mongoose');

// ER-diagram entity: ROUTE. Replaces the old Trip collection (see Trip.js,
// kept temporarily only for the migration script) -- same real fields
// (source/destination/availableFrom/status), plus `waypoints` so the trip
// planner's map can show a real multi-point path rather than just two
// endpoints (part of the "make the map realistic" requirement).
const routeSchema = new mongoose.Schema(
  {
    truckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck', required: true },
    truckOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'TruckOwner', required: true },
    source: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    // Optional intermediate points a driver plans to pass through --
    // purely descriptive; the matching engine still scores against
    // source/destination only, same as the old Trip-based flow.
    waypoints: [
      {
        label: String,
        lat: Number,
        lng: Number,
        _id: false,
      },
    ],
    availableFrom: { type: Date, required: true },
    status: { type: String, enum: ['available', 'matched', 'completed', 'cancelled'], default: 'available' },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Route || mongoose.model('Route', routeSchema);
