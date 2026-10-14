const { cityDistanceKm } = require('../utils/distance');

// Documented assumptions (SRS Section 14 requires every figure to be
// clearly labelled as an estimate). Tune these three rates to taste.
const FUEL_RATE_PER_KM = 8; // Rs/km
const TOLL_RATE_PER_KM = 1.5; // Rs/km
const OTHER_RATE_PER_KM = 0.5; // Rs/km
const FUEL_EFFICIENCY_KM_PER_L = 4; // rough diesel truck average
const CO2_KG_PER_L_DIESEL = 2.68; // standard diesel combustion factor

// Estimates the financial effect of a vehicle (on tripSource->tripDest)
// taking on a specific load (pickup->delivery), per SRS Section 14's
// worked example (Revenue / Estimated Cost / Estimated Profit), plus a
// small Section 15 environmental estimate. Every number here is a
// documented estimate, not a measurement -- `assumptions` is returned
// alongside the figures so the UI can disclose that.
function estimateProfitability({ tripSource, tripDestination, pickupLocation, deliveryLocation, expectedPrice }) {
  const toPickup = cityDistanceKm(tripSource, pickupLocation);
  const loaded = cityDistanceKm(pickupLocation, deliveryLocation);
  const fromDelivery = cityDistanceKm(deliveryLocation, tripDestination);
  const direct = cityDistanceKm(tripSource, tripDestination);

  if (toPickup == null || loaded == null || fromDelivery == null || direct == null) {
    return { error: 'Cannot estimate profitability -- one of the locations is not in the known-city list.' };
  }

  const totalTripDistance = toPickup + loaded + fromDelivery;
  const detourKm = Math.max(0, totalTripDistance - direct);

  const fuelCost = Math.round(totalTripDistance * FUEL_RATE_PER_KM);
  const tollCost = Math.round(totalTripDistance * TOLL_RATE_PER_KM);
  const otherCost = Math.round(totalTripDistance * OTHER_RATE_PER_KM);
  const estimatedOperatingCost = fuelCost + tollCost + otherCost;
  const estimatedProfit = Math.round(expectedPrice - estimatedOperatingCost);

  // Empty-return comparison (SRS 14): the vehicle was driving tripSource->
  // tripDestination either way, so the INCREMENTAL cost of taking this
  // load is only the detour, not the whole trip.
  const additionalTripCost = Math.round(detourKm * (FUEL_RATE_PER_KM + TOLL_RATE_PER_KM + OTHER_RATE_PER_KM));
  const potentialIncrementalBenefit = Math.round(expectedPrice - additionalTripCost);

  // Environmental estimate (SRS 15) -- how much empty running this
  // backhaul avoids versus returning with nothing.
  const emptyKmAvoided = Math.round(Math.min(direct, totalTripDistance) * 10) / 10;
  const fuelSavedLiters = Math.round((emptyKmAvoided / FUEL_EFFICIENCY_KM_PER_L) * 10) / 10;
  const co2AvoidedKg = Math.round(fuelSavedLiters * CO2_KG_PER_L_DIESEL * 10) / 10;

  return {
    distanceKm: { toPickup, loaded, fromDelivery, totalTripDistance: Math.round(totalTripDistance * 10) / 10, detourKm: Math.round(detourKm * 10) / 10 },
    revenue: expectedPrice,
    estimatedFuelCost: fuelCost,
    estimatedTollCost: tollCost,
    estimatedOtherCost: otherCost,
    estimatedOperatingCost,
    estimatedProfit,
    emptyReturnComparison: {
      withoutBackhaulRevenue: 0,
      withBackhaulRevenue: expectedPrice,
      additionalTripCost,
      potentialIncrementalBenefit,
    },
    environmental: { emptyKmAvoided, fuelSavedLiters, co2AvoidedKg },
    assumptions: `Estimates only. Fuel ₹${FUEL_RATE_PER_KM}/km, toll ₹${TOLL_RATE_PER_KM}/km, other ₹${OTHER_RATE_PER_KM}/km, ${FUEL_EFFICIENCY_KM_PER_L} km/L. Distances are straight-line, not real road distances.`,
  };
}

module.exports = { estimateProfitability };
