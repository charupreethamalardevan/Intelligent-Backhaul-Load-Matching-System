const { scoreMatch } = require('./matching');

// Addendum 28 deferred this ("we will add the ML later, that will
// recommend loads") and Addendum 34's progress-log queue carried it
// forward as "multi-leg backhaul chaining": recognizing that two loads
// taken back-to-back (e.g. Chennai->Madurai, then Madurai->Tirunelveli)
// can sometimes be worth more than stopping after a single direct
// backhaul load. This module is the first, bounded version of that --
// a 2-leg comparison, not a general route-chaining optimizer.
//
// Deliberately NOT a general multi-leg optimizer: it explores a bounded
// number of candidates rather than every possible combination, and it
// only builds 2-leg chains this round (a real third leg, or comparing
// chains of different lengths against each other, is future work -- see
// the progress log). This keeps the search fast and explainable rather
// than exhaustive, which matters because scoring is O(leg1 candidates x
// open loads) and there is no hard cap on how many loads are open.
const LEG1_CANDIDATES_EXPLORED = 5;
const LEG2_CANDIDATES_EXPLORED = 5;
const MAX_HOPS_SUPPORTED = 2;

// Leg 1 is exactly what GET /api/matching/for-trip/:tripId already
// computes (SRS Section 4's single-leg backhaul) -- reusing scoreMatch
// unmodified, not a parallel reimplementation, so "the direct backhaul"
// shown in this comparison is always the literal #1 result a user would
// also see on the Find Loads tab for this same trip.
function scoreLeg1Candidates({ vehicle, trip, loads }) {
  const results = [];
  for (const load of loads) {
    const result = scoreMatch({ vehicle, trip, load });
    if (result.eligible) results.push({ load, ...result });
  }
  results.sort((a, b) => b.matchScore - a.matchScore);
  return results;
}

// Leg 2: after dropping off load1, the vehicle has no planned route of
// its own any more -- it's just sitting at load1's delivery city. We
// model that as a synthetic one-load "trip" whose source is load1's
// delivery city and whose destination is the CANDIDATE load2's own
// delivery city (i.e. "assume the vehicle drives straight there, nothing
// beyond this load is committed yet"). That lets us reuse scoreMatch /
// estimateProfitability completely unmodified instead of duplicating
// their logic for a second time. The "detour" that falls out of that
// scoring is therefore the honest cost of repositioning from load1's
// drop-off point to load2's pickup point -- not a deviation from a route
// the vehicle was already going to drive, since for leg 2 there isn't
// one.
//
// `availableFrom` for this synthetic trip is load1's own delivery
// deadline -- an approximation (the planning deadline, not a GPS-
// confirmed actual delivery time), consistent with how every other date
// field in this app is a planning input, not a live tracking signal.
function scoreLeg2Candidates({ vehicle, load1, loads }) {
  const availableFrom = load1.deliveryDeadline;
  const results = [];
  for (const load2 of loads) {
    if (String(load2._id) === String(load1._id)) continue;
    const syntheticTrip = {
      source: load1.deliveryLocation,
      destination: load2.deliveryLocation,
      availableFrom,
    };
    const result = scoreMatch({ vehicle, trip: syntheticTrip, load: load2 });
    if (result.eligible) results.push({ load: load2, ...result });
  }
  results.sort((a, b) => b.matchScore - a.matchScore);
  return results;
}

function legProfit(leg) {
  const p = leg?.profitability;
  if (!p || p.error) return null;
  return p.estimatedProfit;
}

// The one function callers use: for a given trip, finds the best single
// direct backhaul load AND the best 2-leg chain (load1 then load2) among
// a bounded set of candidates, and says which one wins on total
// estimated profit. This is a separate, additive comparison a caller
// opts into -- it never changes or replaces the existing single-leg
// /for-trip ranking.
function findBestChainForTrip({ vehicle, trip, openLoads }) {
  const leg1Candidates = scoreLeg1Candidates({ vehicle, trip, loads: openLoads });
  const directBackhaul = leg1Candidates[0] || null;
  const directProfit = directBackhaul ? legProfit(directBackhaul) : null;

  let bestChain = null;
  const topLeg1 = leg1Candidates.slice(0, LEG1_CANDIDATES_EXPLORED);
  for (const leg1 of topLeg1) {
    const leg1Profit = legProfit(leg1);
    if (leg1Profit == null) continue;
    const leg2Candidates = scoreLeg2Candidates({ vehicle, load1: leg1.load, loads: openLoads }).slice(0, LEG2_CANDIDATES_EXPLORED);
    for (const leg2 of leg2Candidates) {
      const leg2Profit = legProfit(leg2);
      if (leg2Profit == null) continue;
      const totalProfit = leg1Profit + leg2Profit;
      if (!bestChain || totalProfit > bestChain.totalProfit) {
        bestChain = { legs: [leg1, leg2], totalProfit };
      }
    }
  }

  let recommendation;
  if (bestChain && directProfit != null) {
    recommendation = bestChain.totalProfit > directProfit ? 'chain_wins' : 'direct_wins';
  } else if (bestChain) {
    recommendation = 'chain_only';
  } else if (directProfit != null) {
    recommendation = 'direct_only';
  } else {
    recommendation = 'none';
  }

  return {
    directBackhaul,
    directProfit,
    chain: bestChain,
    recommendation,
    maxHopsSupported: MAX_HOPS_SUPPORTED,
  };
}

module.exports = { findBestChainForTrip, MAX_HOPS_SUPPORTED };
