const mongoose = require('mongoose');

// ER-diagram entity: PROFITABILITY_PREDICTION -- ML Module 2
// (Profitability Prediction, profitability_model.joblib)'s output,
// modeled 1:1 with MATCH via a unique FK. Carries the full cost/revenue
// breakdown the Profitability Module UI already displays (Project Spec
// Section 14), plus the ML model's own margin/profit estimate alongside
// the rule-based one (services/profitability.js) -- same
// "both signals side by side" pattern as MatchScorePrediction.js.
// predictedProfit is a DERIVED attribute (revenue - costs), computed here
// at write time and stored rather than recomputed on every read -- the
// Design Consistency Review flagged the old schema for NOT marking this
// field as derived, so this comment is that correction.
const profitabilityPredictionSchema = new mongoose.Schema(
  {
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true, unique: true },
    estimatedRevenue: { type: Number, required: true },
    estimatedFuelCost: { type: Number, required: true },
    estimatedTollCost: { type: Number, default: 0 },
    otherEstimatedCosts: { type: Number, default: 0 },
    estimatedOperatingCost: { type: Number, required: true }, // fuel + toll + other
    predictedProfit: { type: Number, required: true }, // DERIVED: estimatedRevenue - estimatedOperatingCost
    mlPredictedMarginPct: { type: Number, default: null }, // from profitability_model.joblib, null if ML was unavailable
    mlPredictedProfit: { type: Number, default: null },
    modelVersion: { type: String, default: null },
    predictedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.models.ProfitabilityPrediction || mongoose.model('ProfitabilityPrediction', profitabilityPredictionSchema);
