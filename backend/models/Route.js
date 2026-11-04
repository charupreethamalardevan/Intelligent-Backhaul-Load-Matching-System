const mongoose = require('mongoose');
const locationSchema = require('./locationSchema');

// ER-diagram entity: ROUTE. Replaces the old Trip collection (see Trip.js,
// kept temporarily only for the migration script). source/destination are
// now real {label, lat, lng} points (locationSchema.js) -- a geocoded
// address, a map-clicked point, or the user's live GPS location -- instead
// of a plain known-city-id string, so the Map and Route Module can show
// (and the matching engine can score against) an actual place, not just
// "Chennai". `waypoints` stays as optional purely-descriptive intermediate
// points, same as before.
const routeSchema = new mongoose.Schema(
  {
    truckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck', required: true },
    truckOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'TruckOwner', required: true },
    source: { type: locationSchema, required: true },
    destination: { type: locationSchema, required: true },
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
