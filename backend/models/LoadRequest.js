const mongoose = require('mongoose');
const { ROLE_IDS } = require('../utils/roles');

// The booking/match lifecycle (SRS Section 13, extended):
// pending_fleet_approval -> requested -> accepted -> confirmed -> pickup
// -> in_transit -> delivered -> completed, with rejected/cancelled as
// terminal side-exits. pending_fleet_approval is a Fleet-Owner-only gate:
// a request a Fleet Driver initiates starts here and only becomes visible
// to the Load Poster once their Fleet Owner approves it (moving it to
// 'requested', the same state every other request starts in). Created
// from a real matching.js score at the moment someone requests a
// trip<->load pairing, so matchScore/profitability are a frozen snapshot
// of why this pairing was recommended, not recomputed later.
const STATUSES = [
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

const loadRequestSchema = new mongoose.Schema(
  {
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    loadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true },
    vehicleOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    loadPosterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Frozen at creation time so the fleet-approval gate can be enforced
    // without a second lookup, and so the record keeps explaining *why*
    // it needed that gate even if the requester's role later changes.
    requestedByRole: { type: String, enum: ROLE_IDS },

    matchScore: Number,
    scoreBreakdown: mongoose.Schema.Types.Mixed,
    profitability: mongoose.Schema.Types.Mixed,

    status: { type: String, enum: STATUSES, default: 'requested' },

    // Real GPS, reported by the driver's own device while the booking is
    // actively on the road (status 'pickup' or 'in_transit' -- see the
    // PATCH /:id/location guard in routes/requests.js). Null until someone
    // on the vehicle side shares their location at least once. When this
    // is null, the frontend's TripMap falls back to an animated preview
    // along the trip's source->destination line instead of a real
    // position -- it never invents a fake "live" point.
    liveLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.models.LoadRequest || mongoose.model('LoadRequest', loadRequestSchema);
module.exports.STATUSES = STATUSES;
