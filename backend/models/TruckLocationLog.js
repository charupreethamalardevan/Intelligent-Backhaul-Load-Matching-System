const mongoose = require('mongoose');

// ER-diagram weak entity: TRUCK_LOCATION_LOG -- the append-only GPS trail
// for a truck, keyed by (truckId, loggedAt) (composite PK, same reduction
// rule as the other weak entities above). This is the REAL history behind
// the single "latest point" already cached on Match.liveLocation: every
// time routes/matches.js's PATCH /:id/location handler accepts a new
// real-GPS reading (source: 'real_gps'), or the frontend's TripMap.jsx
// animation tick posts a simulated preview point (source: 'simulated',
// clearly flagged so it's never confused with a genuine reading), a row is
// appended here. This is what makes "GPS integrated, and also a
// simulation" (the user's own words) a real, queryable table instead of
// just an in-memory animation.
const truckLocationLogSchema = new mongoose.Schema(
  {
    truckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck', required: true },
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    source: { type: String, enum: ['real_gps', 'simulated'], required: true },
    loggedAt: { type: Date, default: Date.now }, // the weak entity's partial key
  },
  { timestamps: true },
);

truckLocationLogSchema.index({ truckId: 1, loggedAt: -1 });

module.exports = mongoose.models.TruckLocationLog || mongoose.model('TruckLocationLog', truckLocationLogSchema);
