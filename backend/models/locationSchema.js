const mongoose = require('mongoose');

// Shared sub-schema for every source/destination/pickup/delivery field
// (Route.source/destination, Load.pickupLocation/deliveryLocation).
// Replaces the old "just a known-city-id string" shape so a location can
// be a real geocoded address or a map-clicked / live-GPS point, not only
// one of utils/distance.js's ~16 hardcoded cities -- while still
// guaranteeing every location carries real coordinates the matching and
// profitability engines (utils/distance.js's distanceKm) can always
// compute a distance from. `label` is whatever human-readable text the
// frontend resolved it to (a Nominatim result's display name, "My
// current location", or a quick-pick city name) -- purely for display,
// never parsed back into coordinates.
const locationSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false },
);

module.exports = locationSchema;
