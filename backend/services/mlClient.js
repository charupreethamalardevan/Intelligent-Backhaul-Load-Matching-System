// Thin client for the ML Module 1 (Match/Compatibility Prediction) Python
// microservice (ml-service/app.py). This is an OPTIONAL, best-effort signal
// on top of the existing rule-based engine (services/matching.js), which is
// never modified or blocked by this file -- if the microservice is slow,
// unreachable, or simply not running, every function here resolves to null
// (per item) rather than throwing, and callers just omit the ML field.
//
// Uses the global `fetch` built into Node 18+; no extra HTTP dependency.

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';
const TIMEOUT_MS = Number(process.env.ML_SERVICE_TIMEOUT_MS) || 1500;

let warnedUnavailable = false;

function warnOnce(message) {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  console.warn(`[mlClient] ${message} -- continuing with the rule-based score only. (This warning only prints once per server run.)`);
}

async function postJson(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${ML_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`ML service responded ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// Scores a single vehicle/trip/load pairing. Returns a probability (0-1)
// or null if the service is unavailable or the pairing wasn't eligible on
// its end (it re-checks the same hard constraints matching.js does).
async function getMlCompatibility({ vehicle, trip, load, ownerRatingAvg }) {
  try {
    const data = await postJson('/predict', {
      vehicle: { vehicleType: vehicle.vehicleType, maxCapacityTonnes: vehicle.maxCapacityTonnes, cargoCompatibility: vehicle.cargoCompatibility },
      trip: { source: trip.source, destination: trip.destination, availableFrom: trip.availableFrom },
      load: {
        pickupLocation: load.pickupLocation,
        deliveryLocation: load.deliveryLocation,
        cargoType: load.cargoType,
        cargoWeightTonnes: load.cargoWeightTonnes,
        requiredVehicleType: load.requiredVehicleType,
        pickupDateTime: load.pickupDateTime,
        deliveryDeadline: load.deliveryDeadline,
        expectedPrice: load.expectedPrice,
      },
      ownerRatingAvg: ownerRatingAvg ?? null,
    });
    return data.eligible ? data.probability : null;
  } catch (err) {
    warnOnce(`Could not reach the ML microservice at ${ML_SERVICE_URL} (${err.message})`);
    return null;
  }
}

// Batched version for ranked-list endpoints (for-trip / for-load), so a
// whole list of candidates costs one HTTP round trip instead of N. `items`
// is [{ id, vehicle, trip, load, ownerRatingAvg }]. Returns a Map of
// id -> probability (missing entries mean "no ML signal for this one").
async function getMlCompatibilityBatch(items) {
  if (!items.length) return new Map();
  try {
    const data = await postJson('/predict-batch', {
      items: items.map((it) => ({
        id: it.id,
        vehicle: { vehicleType: it.vehicle.vehicleType, maxCapacityTonnes: it.vehicle.maxCapacityTonnes, cargoCompatibility: it.vehicle.cargoCompatibility },
        trip: { source: it.trip.source, destination: it.trip.destination, availableFrom: it.trip.availableFrom },
        load: {
          pickupLocation: it.load.pickupLocation,
          deliveryLocation: it.load.deliveryLocation,
          cargoType: it.load.cargoType,
          cargoWeightTonnes: it.load.cargoWeightTonnes,
          requiredVehicleType: it.load.requiredVehicleType,
          pickupDateTime: it.load.pickupDateTime,
          deliveryDeadline: it.load.deliveryDeadline,
          expectedPrice: it.load.expectedPrice,
        },
        ownerRatingAvg: it.ownerRatingAvg ?? null,
      })),
    });
    const map = new Map();
    for (const pred of data.predictions || []) {
      if (pred.eligible) map.set(pred.id, pred.probability);
    }
    return map;
  } catch (err) {
    warnOnce(`Could not reach the ML microservice at ${ML_SERVICE_URL} (${err.message})`);
    return new Map();
  }
}

// ML Module 2 (Profitability Prediction, Addendum 36) -- same microservice
// process as Module 1 (ml-service/app.py loads both models), same
// optional/best-effort contract: resolves to null/an empty Map on any
// failure instead of throwing, and is called alongside -- never instead of
// -- the existing rule-based backend/services/profitability.js, which is
// unmodified.
async function getMlProfitability({ vehicle, trip, load }) {
  try {
    const data = await postJson('/predict-profitability', {
      vehicle: { vehicleType: vehicle.vehicleType, maxCapacityTonnes: vehicle.maxCapacityTonnes },
      trip: { source: trip.source, destination: trip.destination, availableFrom: trip.availableFrom },
      load: {
        pickupLocation: load.pickupLocation,
        deliveryLocation: load.deliveryLocation,
        cargoType: load.cargoType,
        cargoWeightTonnes: load.cargoWeightTonnes,
        requiredVehicleType: load.requiredVehicleType,
        pickupDateTime: load.pickupDateTime,
        deliveryDeadline: load.deliveryDeadline,
        expectedPrice: load.expectedPrice,
      },
    });
    return data.eligible ? { predictedMarginPct: data.predictedMarginPct, predictedProfit: data.predictedProfit } : null;
  } catch (err) {
    warnOnce(`Could not reach the ML microservice at ${ML_SERVICE_URL} (${err.message})`);
    return null;
  }
}

// Batched version, same id-keyed Map pattern as getMlCompatibilityBatch.
async function getMlProfitabilityBatch(items) {
  if (!items.length) return new Map();
  try {
    const data = await postJson('/predict-profitability-batch', {
      items: items.map((it) => ({
        id: it.id,
        vehicle: { vehicleType: it.vehicle.vehicleType, maxCapacityTonnes: it.vehicle.maxCapacityTonnes },
        trip: { source: it.trip.source, destination: it.trip.destination, availableFrom: it.trip.availableFrom },
        load: {
          pickupLocation: it.load.pickupLocation,
          deliveryLocation: it.load.deliveryLocation,
          cargoType: it.load.cargoType,
          cargoWeightTonnes: it.load.cargoWeightTonnes,
          requiredVehicleType: it.load.requiredVehicleType,
          pickupDateTime: it.load.pickupDateTime,
          deliveryDeadline: it.load.deliveryDeadline,
          expectedPrice: it.load.expectedPrice,
        },
      })),
    });
    const map = new Map();
    for (const pred of data.predictions || []) {
      if (pred.eligible) map.set(pred.id, { predictedMarginPct: pred.predictedMarginPct, predictedProfit: pred.predictedProfit });
    }
    return map;
  } catch (err) {
    warnOnce(`Could not reach the ML microservice at ${ML_SERVICE_URL} (${err.message})`);
    return new Map();
  }
}

// ML Module 3 (Demand Forecasting, Addendum 39) -- same microservice
// process, same optional/best-effort contract: resolves to null on any
// failure instead of throwing. recentLoadCount14d/30d are computed by the
// CALLER from real Load documents on this exact route (see
// routes/insights.js) -- this function does not touch the database itself.
async function getDemandForecast({ origin, destination, anchorDate, recentLoadCount14d, recentLoadCount30d }) {
  try {
    const data = await postJson('/predict-demand', {
      origin,
      destination,
      anchorDate,
      recentLoadCount14d: recentLoadCount14d ?? 0,
      recentLoadCount30d: recentLoadCount30d ?? 0,
    });
    return data.eligible
      ? { predictedLoadCount7d: data.predictedLoadCount7d, demandCategory: data.demandCategory, modelVersion: data.modelVersion }
      : null;
  } catch (err) {
    warnOnce(`Could not reach the ML microservice at ${ML_SERVICE_URL} (${err.message})`);
    return null;
  }
}

// ML Module 4 (Empty-Run Risk Prediction, Addendum 39) -- same optional/
// best-effort contract as every other function here; batched so a whole
// Fleet Owner's list of available trips costs one HTTP round trip. `items`
// is [{ id, vehicle, tripSource, tripDestination, availableFrom,
// compatibleLoadsNearbyCount }] -- compatibleLoadsNearbyCount is computed by
// the CALLER from real open Load documents (see routes/insights.js), the
// same radius-based query GET /api/loads/near already uses. Returns a Map
// of id -> { emptyRunRiskPct, riskLevel, modelVersion } (missing entries
// mean "no ML signal for this one").
async function getEmptyRunRiskBatch(items) {
  if (!items.length) return new Map();
  try {
    const data = await postJson('/predict-empty-run-risk-batch', {
      items: items.map((it) => ({
        id: it.id,
        vehicle: { vehicleType: it.vehicle.vehicleType, maxCapacityTonnes: it.vehicle.maxCapacityTonnes },
        tripSource: it.tripSource,
        tripDestination: it.tripDestination,
        availableFrom: it.availableFrom,
        compatibleLoadsNearbyCount: it.compatibleLoadsNearbyCount ?? 0,
      })),
    });
    const map = new Map();
    for (const pred of data.predictions || []) {
      if (pred.eligible) map.set(pred.id, { emptyRunRiskPct: pred.emptyRunRiskPct, riskLevel: pred.riskLevel, modelVersion: pred.modelVersion });
    }
    return map;
  } catch (err) {
    warnOnce(`Could not reach the ML microservice at ${ML_SERVICE_URL} (${err.message})`);
    return new Map();
  }
}

module.exports = {
  getMlCompatibility, getMlCompatibilityBatch,
  getMlProfitability, getMlProfitabilityBatch,
  getDemandForecast, getEmptyRunRiskBatch,
};
