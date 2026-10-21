const mongoose = require('mongoose');
const { ROLE_IDS } = require('../utils/roles');

// ER-diagram entity: MATCH. Replaces the old LoadRequest collection (see
// LoadRequest.js, kept temporarily only for the migration script) -- the
// core truck<->load pairing and its booking lifecycle. Field names are
// updated to the new Truck/Route vocabulary (routeId/truckId instead of
// tripId/vehicleId); the lifecycle itself, and every status value, are
// unchanged from LoadRequest.js so routes/matches.js (its successor) can
// keep the exact same state machine.
const STATUSES = [
  'recommended', // ER-diagram's own first state, before anyone has acted on it
  'pending_fleet_approval',
  'requested',
  'accepted',
  'confirmed',
  'pickup',
  'in_transit',
  'delivered',
  'completed',
  'rejected',
  'cancelled',
];

const matchSchema = new mongoose.Schema(
  {
    routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
    truckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck', required: true },
    loadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true },
    truckOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'TruckOwner', required: true },
    loadPosterId: { type: mongoose.Schema.Types.ObjectId, ref: 'LoadPoster', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestedByRole: { type: String, enum: ROLE_IDS },

    status: { type: String, enum: STATUSES, default: 'requested' },

    // Real GPS reported by the truck side while on the road (status
    // 'pickup'/'in_transit') -- also mirrored into TruckLocationLog as an
    // append-only history (this field stays as the single "latest point"
    // for cheap reads; TruckLocationLog.js is the full trail).
    liveLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Match || mongoose.model('Match', matchSchema);
module.exports.STATUSES = STATUSES;
