const express = require('express');

const Trip = require('../models/Trip');
const Load = require('../models/Load');
const { requireAuth } = require('../middleware/auth');
const { scoreMatch } = require('../services/matching');
const { findBestChainForTrip } = require('../services/chainFinder');
const { getMlCompatibilityBatch, getMlProfitabilityBatch } = require('../services/mlClient');
const { scopeOwnerId } = require('./vehicles');

const router = express.Router();
router.use(requireAuth);

const MAX_RESULTS = 15;

// Attaches an optional `mlCompatibility` (0-1 probability, from ML Module 1
// -- see ml-service/) to each already-ranked match, one batched HTTP call
// per page of results. This NEVER changes ranking or eligibility: the
// existing rule-based matchScore is still what the list is sorted on (SRS
// Development Rule 6: recommendations must be explainable). If the ML
// microservice is unavailable, getMlCompatibilityBatch resolves to an empty
// map and every match simply has no mlCompatibility field -- the rest of
// the response is unaffected.
async function attachMlCompatibility(topMatches, pairFor) {
  const items = topMatches.map((m, idx) => ({ id: idx, ...pairFor(m) }));
  const probabilities = await getMlCompatibilityBatch(items);
  topMatches.forEach((m, idx) => {
    const p = probabilities.get(idx);
    if (p != null) m.mlCompatibility = p;
  });
}

// Same pattern as attachMlCompatibility above, for ML Module 2
// (Profitability Prediction, Addendum 36): attaches an optional
// `mlProfitability: { predictedMarginPct, predictedProfit }` to each
// already-ranked match. Never changes ranking -- the existing rule-based
// profitability estimate (already in m.profitability, from
// services/profitability.js) is untouched and still what's shown first.
async function attachMlProfitability(topMatches, pairFor) {
  const items = topMatches.map((m, idx) => ({ id: idx, ...pairFor(m) }));
  const predictions = await getMlProfitabilityBatch(items);
  topMatches.forEach((m, idx) => {
    const p = predictions.get(idx);
    if (p != null) m.mlProfitability = p;
  });
}

// GET /api/matching/for-trip/:tripId -- for a vehicle's planned trip
// (SRS Section 4, Step 2: "find candidate backhaul loads for this trip"),
// rank every open Load against it using the weighted scoring engine.
// Hard-rejected pairings are left out entirely, never shown as a low score.
router.get('/for-trip/:tripId', async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.tripId).populate('vehicleId');
    if (!trip || !trip.vehicleId) return res.status(404).json({ error: 'Trip not found.' });

    const ownerId = await scopeOwnerId(req);
    if (String(trip.ownerId) !== String(ownerId)) {
      return res.status(403).json({ error: 'You do not have access to this trip.' });
    }

    const vehicle = trip.vehicleId;
    const loads = await Load.find({ status: 'open' });

    const matches = [];
    for (const load of loads) {
      const result = scoreMatch({ vehicle, trip, load });
      if (result.eligible) {
        matches.push({ load, ...result });
      }
    }
    matches.sort((a, b) => b.matchScore - a.matchScore);

    const top = matches.slice(0, MAX_RESULTS);
    await Promise.all([
      attachMlCompatibility(top, (m) => ({ vehicle, trip, load: m.load })),
      attachMlProfitability(top, (m) => ({ vehicle, trip, load: m.load })),
    ]);

    res.json({ trip, vehicle, matches: top });
  } catch (err) {
    console.error('[matching/for-trip]', err);
    res.status(500).json({ error: 'Could not compute matches for this trip.' });
  }
});

// GET /api/matching/chain-for-trip/:tripId -- compares the single best
// direct backhaul load for this trip against the single best 2-leg chain
// (load1, then a second load from wherever load1 ends) found among a
// bounded set of candidates (services/chainFinder.js). Additive only:
// this never changes what /for-trip returns, and a caller who never
// requests this endpoint sees no difference in behaviour at all.
router.get('/chain-for-trip/:tripId', async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.tripId).populate('vehicleId');
    if (!trip || !trip.vehicleId) return res.status(404).json({ error: 'Trip not found.' });

    const ownerId = await scopeOwnerId(req);
    if (String(trip.ownerId) !== String(ownerId)) {
      return res.status(403).json({ error: 'You do not have access to this trip.' });
    }

    const vehicle = trip.vehicleId;
    const openLoads = await Load.find({ status: 'open' });

    const result = findBestChainForTrip({ vehicle, trip, openLoads });
    res.json({ trip, vehicle, ...result });
  } catch (err) {
    console.error('[matching/chain-for-trip]', err);
    res.status(500).json({ error: 'Could not compute a chain comparison for this trip.' });
  }
});

// GET /api/matching/for-load/:loadId -- for a posted Load, rank every
// available vehicle/trip pairing against it (the mirror-image lookup:
// a shipper browsing which trucks could carry their load).
router.get('/for-load/:loadId', async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found.' });

    if (String(load.postedBy) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You do not have access to this load.' });
    }

    const trips = await Trip.find({ status: 'available' }).populate('vehicleId');

    const matches = [];
    for (const trip of trips) {
      const vehicle = trip.vehicleId;
      if (!vehicle || vehicle.status !== 'active') continue;
      const result = scoreMatch({ vehicle, trip, load });
      if (result.eligible) {
        matches.push({ trip, vehicle, ...result });
      }
    }
    matches.sort((a, b) => b.matchScore - a.matchScore);

    const top = matches.slice(0, MAX_RESULTS);
    await Promise.all([
      attachMlCompatibility(top, (m) => ({ vehicle: m.vehicle, trip: m.trip, load })),
      attachMlProfitability(top, (m) => ({ vehicle: m.vehicle, trip: m.trip, load })),
    ]);

    res.json({ load, matches: top });
  } catch (err) {
    console.error('[matching/for-load]', err);
    res.status(500).json({ error: 'Could not compute matches for this load.' });
  }
});

module.exports = router;
