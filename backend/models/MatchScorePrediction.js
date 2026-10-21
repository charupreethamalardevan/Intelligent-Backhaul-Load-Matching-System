const mongoose = require('mongoose');

// ER-diagram entity: MATCH_SCORE_PREDICTION -- ML Module 1 (Load-Truck
// Match/Compatibility Scoring)'s output, modeled 1:1 with MATCH via a
// unique FK (Table Reduction doc's stated 1:1-via-unique-FK pattern,
// same as RouteFeasibility.js/ProfitabilityPrediction.js/Payment.js
// below). Carries BOTH the rule-based score (services/matching.js, always
// present) and the ML model's probability (ml-service's
// compatibility_model.joblib, present only when the microservice was
// reachable) side by side, so the record keeps explaining *why* a match
// was recommended even when the ML signal was unavailable at the time.
const matchScorePredictionSchema = new mongoose.Schema(
  {
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true, unique: true },
    ruleBasedScore: { type: Number, required: true }, // services/matching.js scoreMatch().matchScore
    factors: mongoose.Schema.Types.Mixed, // the 7 weighted SRS factors, for explainability
    weights: mongoose.Schema.Types.Mixed,
    mlProbability: { type: Number, default: null }, // 0-1, from compatibility_model.joblib, null if ML was unavailable
    modelVersion: { type: String, default: null },
    predictedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.models.MatchScorePrediction || mongoose.model('MatchScorePrediction', matchScorePredictionSchema);
