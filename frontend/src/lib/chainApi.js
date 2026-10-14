import { apiFetch } from './api.js';

// GET /matching/chain-for-trip/:tripId -- compares the single best direct
// backhaul load for a trip against the single best 2-leg chain found
// among a bounded set of candidates (backend/services/chainFinder.js).
// Response: { trip, vehicle, directBackhaul, directProfit, chain, recommendation,
// maxHopsSupported }. recommendation is one of 'chain_wins' | 'direct_wins' |
// 'chain_only' | 'direct_only' | 'none'. Additive -- never replaces matchesForTrip.
export const chainForTrip = (tripId) => apiFetch(`/matching/chain-for-trip/${tripId}`);
