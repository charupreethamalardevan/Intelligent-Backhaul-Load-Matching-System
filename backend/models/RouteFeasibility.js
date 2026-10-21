const mongoose = require('mongoose');

// ER-diagram entity: ROUTE_FEASIBILITY -- ML Module 4 (Empty-Run Risk
// Prediction, empty_run_model.joblib)'s output, modeled 1:1 with MATCH via
// a unique FK. Named after the ER diagram's "Route Deviation Feasibility"
// module, which in this app's actual implementation is the empty-run-risk
// signal (services/mlClient.js's getEmptyRunRiskBatch): how likely the
// truck is to run this route empty/under-detour-budget if it DOESN'T take
// this particular backhaul.
const routeFeasibilitySchema = new mongoose.Schema(
  {
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true, unique: true },
    detourKm: { type: Number, required: true }, // services/matching.js scoreRoute().detourKm
    feasible: { type: Boolean, required: true }, // false if a hard constraint rejected the pairing
    emptyRunRiskPct: { type: Number, default: null }, // from empty_run_model.joblib, null if ML was unavailable
    riskLevel: { type: String, enum: ['low', 'medium', 'high', null], default: null },
    reason: String, // the hard-constraint rejection reason, when feasible === false
    modelVersion: { type: String, default: null },
    predictedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.models.RouteFeasibility || mongoose.model('RouteFeasibility', routeFeasibilitySchema);
