import { apiFetch } from './api.js';

// Thin wrappers for the "Route Insights" panel (Addendum 39) -- the UI home
// for ML Modules 3 (Demand Forecasting) and 4 (Empty-Run Risk Prediction).
// Both can come back { eligible: false, reason } when the route/trip isn't
// scorable or the ML microservice is unreachable -- the panel shows that
// reason in place of the prediction rather than treating it as an error.

// demandForecast: { eligible, origin, destination, recentLoadCount14d,
// recentLoadCount30d, predictedLoadCount7d, demandCategory, modelVersion }
// or { eligible: false, reason }.
export const demandForecast = (origin, destination) =>
  apiFetch(`/insights/demand-forecast?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`);

// emptyRunRisk: { trips: [{ trip, compatibleLoadsNearbyCount,
// emptyRunRiskPct, riskLevel, modelVersion }, ...] } -- "my" available
// trips (or my Fleet Owner's, if I'm a driver), each scored independently;
// emptyRunRiskPct/riskLevel/modelVersion are null for a trip the ML
// microservice couldn't score.
export const emptyRunRisk = () => apiFetch('/insights/empty-run-risk');
