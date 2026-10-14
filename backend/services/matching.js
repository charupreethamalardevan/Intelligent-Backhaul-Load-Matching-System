const { cityDistanceKm } = require('../utils/distance');
const { estimateProfitability } = require('./profitability');

// The weights from SRS Section 6. Centralized and named, not hard-coded
// inline, so they can be tuned later without hunting through the scoring
// function (SRS Section 6: "Weights should be configurable, not
// hard-coded everywhere").
const WEIGHTS = {
  routeCompatibility: 0.25,
  capacityCompatibility: 0.15,
  timingCompatibility: 0.15,
  cargoVehicleFit: 0.15,
  detourEfficiency: 0.1,
  profitability: 0.15,
  reliability: 0.05,
};

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

// SRS Section 8: hard constraints must be checked BEFORE any ML/ranking --
// an impossible pairing (capacity exceeded, wrong vehicle type) is
// rejected outright, never merely scored low. Returns a reason string if
// rejected, or null if the pairing is physically possible.
function checkHardConstraints({ vehicle, trip, load }) {
  if (load.cargoWeightTonnes > vehicle.maxCapacityTonnes) {
    return `Cargo (${load.cargoWeightTonnes}t) exceeds this vehicle's capacity (${vehicle.maxCapacityTonnes}t).`;
  }
  if (load.requiredVehicleType !== 'any' && load.requiredVehicleType !== vehicle.vehicleType) {
    return `This load requires a ${load.requiredVehicleType.replace('_', ' ')}, not a ${vehicle.vehicleType.replace('_', ' ')}.`;
  }
  const availableFrom = new Date(trip.availableFrom);
  const deliveryDeadline = new Date(load.deliveryDeadline);
  if (availableFrom > deliveryDeadline) {
    return 'The vehicle is not available until after this load’s delivery deadline.';
  }
  return null;
}

function scoreRoute({ trip, load }) {
  const toPickup = cityDistanceKm(trip.source, load.pickupLocation);
  const loaded = cityDistanceKm(load.pickupLocation, load.deliveryLocation);
  const fromDelivery = cityDistanceKm(load.deliveryLocation, trip.destination);
  const direct = cityDistanceKm(trip.source, trip.destination);
  if (toPickup == null || loaded == null || fromDelivery == null || direct == null) return null;

  const total = toPickup + loaded + fromDelivery;
  const detourKm = Math.max(0, total - direct);
  // Route compatibility: detour as a PROPORTION of the planned trip --
  // a 20km detour on a 500km trip barely matters; the same 20km on a
  // 40km trip is a huge deviation.
  const routeCompatibility = clamp(100 - (detourKm / Math.max(direct, 1)) * 100);
  // Detour efficiency: the ABSOLUTE extra kilometres, regardless of trip
  // length -- a separate, deliberately distinct signal from the ratio
  // above (SRS lists Route Compatibility and Detour Efficiency separately).
  const detourEfficiency = clamp(100 - detourKm / 2);
  return { detourKm: Math.round(detourKm * 10) / 10, routeCompatibility, detourEfficiency };
}

function scoreCapacity({ vehicle, load }) {
  const utilization = load.cargoWeightTonnes / vehicle.maxCapacityTonnes;
  // Best when the load uses most of the vehicle's capacity without
  // exceeding it (already hard-rejected above if it does). Under-filling
  // a big truck with a tiny load is a valid but weaker match.
  return clamp(utilization * 100);
}

function scoreTiming({ trip, load }) {
  const availableFrom = new Date(trip.availableFrom);
  const pickup = new Date(load.pickupDateTime);
  const deadline = new Date(load.deliveryDeadline);
  const slackHours = (deadline - availableFrom) / 36e5;
  const leadHours = (pickup - availableFrom) / 36e5;
  if (leadHours < 0) return 40; // vehicle only becomes free after pickup time -- tight but not impossible
  // More slack between availability and the delivery deadline = safer
  // timing match. 72h+ of slack scores full marks.
  return clamp((slackHours / 72) * 100, 20, 100);
}

function scoreCargoFit({ vehicle, load }) {
  if (load.requiredVehicleType !== 'any' && load.requiredVehicleType === vehicle.vehicleType) {
    if (vehicle.cargoCompatibility?.includes(load.cargoType)) return 100;
    return 85;
  }
  if (vehicle.cargoCompatibility?.includes(load.cargoType)) return 80;
  return 60;
}

function scoreProfitability(profitability) {
  if (!profitability || profitability.error) return 50;
  const { revenue, estimatedOperatingCost } = profitability;
  if (revenue <= 0) return 0;
  const margin = (revenue - estimatedOperatingCost) / revenue; // can be negative
  // A 40%+ profit margin scores full marks; a loss-making load scores 0.
  return clamp(50 + margin * 125);
}

function scoreReliability(ownerRatingAvg) {
  // New accounts have no rating history yet -- default to a neutral
  // score rather than fabricating a good or bad track record.
  if (ownerRatingAvg == null) return 70;
  return clamp((ownerRatingAvg / 5) * 100);
}

// The one function everything else calls: given a vehicle+trip (a return
// route a truck is available for) and a load (a shipper's requirement),
// return either a hard rejection or a full, explainable score (SRS
// Section 4's "match score must be explainable, not a mysterious number").
function scoreMatch({ vehicle, trip, load, ownerRatingAvg }) {
  const rejection = checkHardConstraints({ vehicle, trip, load });
  if (rejection) return { eligible: false, reason: rejection };

  const route = scoreRoute({ trip, load });
  if (!route) {
    return { eligible: false, reason: 'One of the locations involved is not in the known-city list, so route distance cannot be estimated.' };
  }

  const profitability = estimateProfitability({
    tripSource: trip.source,
    tripDestination: trip.destination,
    pickupLocation: load.pickupLocation,
    deliveryLocation: load.deliveryLocation,
    expectedPrice: load.expectedPrice,
  });

  const factors = {
    routeCompatibility: route.routeCompatibility,
    capacityCompatibility: scoreCapacity({ vehicle, load }),
    timingCompatibility: scoreTiming({ trip, load }),
    cargoVehicleFit: scoreCargoFit({ vehicle, load }),
    detourEfficiency: route.detourEfficiency,
    profitability: scoreProfitability(profitability),
    reliability: scoreReliability(ownerRatingAvg),
  };

  const matchScore = Math.round(Object.keys(WEIGHTS).reduce((sum, key) => sum + factors[key] * WEIGHTS[key], 0));

  return {
    eligible: true,
    matchScore,
    factors,
    weights: WEIGHTS,
    detourKm: route.detourKm,
    profitability,
  };
}

module.exports = { scoreMatch, checkHardConstraints, WEIGHTS };
