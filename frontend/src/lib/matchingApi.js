import { apiFetch } from './api.js';

// matches: [{ load|vehicle+trip, eligible, matchScore, factors, weights, detourKm, profitability, mlCompatibility?, mlProfitability? }]
// mlCompatibility (0-1, optional): ML Module 1's own trained-model probability,
// from the Python microservice in ml-service/. Only present when that service
// was reachable when the backend computed this list -- absent otherwise, and
// the rest of the match is unaffected either way.
// mlProfitability (optional, { predictedMarginPct, predictedProfit }): ML
// Module 2's trained-model profit forecast, from the same microservice --
// same "present only if reachable, absent otherwise" contract, shown
// alongside (never instead of) the existing rule-based `profitability`.
export const matchesForTrip = (tripId) => apiFetch(`/matching/for-trip/${tripId}`);
export const matchesForLoad = (loadId) => apiFetch(`/matching/for-load/${loadId}`);
