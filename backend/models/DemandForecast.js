const mongoose = require('mongoose');

// ER-diagram entity: DEMAND_FORECAST -- ML Module 3 (Demand Forecasting,
// demand_model.joblib)'s output. Unlike the other 3 prediction tables,
// this is NOT 1:1 with a Match -- a demand forecast is scoped to a
// route CORRIDOR (origin+destination) on a given day, independent of any
// specific truck/load pairing, matching how services/mlClient.js's
// getDemandForecast() and routes/insights.js actually call it (once per
// corridor a Fleet Owner/Driver is viewing, not once per match). Each
// call this app makes to the ML service is logged here as its own row --
// a history of forecasts, not a single cached value -- so "which route
// has more loads" (the trip planner's own words) has a real queryable
// trail across days.
const demandForecastSchema = new mongoose.Schema(
  {
    origin: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    anchorDate: { type: Date, required: true },
    recentLoadCount14d: Number, // the real input feature, for auditability
    recentLoadCount30d: Number,
    predictedLoadCount7d: { type: Number, required: true },
    demandCategory: { type: String, enum: ['low', 'medium', 'high'], required: true },
    modelVersion: String,
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    predictedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

demandForecastSchema.index({ origin: 1, destination: 1, anchorDate: -1 });

module.exports = mongoose.models.DemandForecast || mongoose.model('DemandForecast', demandForecastSchema);
