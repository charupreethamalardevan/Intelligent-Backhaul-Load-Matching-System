const express = require('express');

const Route = require('../models/Route');
const Load = require('../models/Load');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { scoreMatch } = require('../services/matching');
const { findBestChainForTrip } = require('../services/chainFinder');
const { getMlCompatibilityBatch, getMlProfitabilityBatch } = require('../services/mlClient');
const { scopeOwnerId } = require('./trucks');

// ER-diagram migration: reads from the `routes`/Truck collections instead
// of the old `trips`/Vehicle ones. Every exported endpoint, URL path, and
// response field name is unchanged -- services/matching.js's scoreMatch()
// and services/chainFinder.js's findBestChainForTrip() both take a
// `{ vehicle, trip, load }`-shaped object and only read .source/
// .destination/.vehicleType/.maxCapacityTonnes/.cargoCompatibility/
// .availableFrom off of it, every one of which Truck.js/Route.js still
// carry (Truck.js kept the legacy vehicleType field specifically so this
// and every ML call below keeps working unmodified).
const router = express.Router();
router.use(requireAuth);

const MAX_RESULTS = 15;

async function attachMlCompatibility(topMatches, pairFor) {
  const items = topMatches.map((m, idx) => ({ id: idx, ...pairFor(m) }));
  const probabilities = await getMlCompatibilityBatch(items);
  topMatches.forEach((m, idx) => {
    const p = probabilities.get(idx);
    if (p != null) m.mlCompatibility = p;
  });
}

async function attachMlProfitability(topMatches, pairFor) {
  const items = topMatches.map((m, idx) => ({ id: idx, ...pairFor(m) }));
  const predictions = await getMlProfitabilityBatch(items);
  topMatches.forEach((m, idx) => {
    const p = predictions.get(idx);
    if (p != null) m.mlProfitability = p;
  });
}

// GET /api/matching/for-trip/:tripId
router.get('/for-trip/:tripId', async (req, res) => {
  try {
    const route = await Route.findById(req.params.tripId).populate('truckId');
    if (!route || !route.truckId) return res.status(404).json({ error: 'Trip not found.' });

    const ownerId = await scopeOwnerId(req);
    if (String(route.truckOwnerId) !== String(ownerId)) {
      return res.status(403).json({ error: 'You do not have access to this trip.' });
    }

    const vehicle = route.truckId;
    const loads = await Load.find({ status: 'open' });

    // Reliability factor (SRS Section 6) -- this truck owner's cached
    // average rating (Rating.js/routes/ratings.js recompute and cache it
    // onto users.ratingAvg whenever a completed booking is rated). One
    // lookup covers every candidate below, since they all share this same
    // truck/owner. null (no ratings yet) is handled by scoreReliability()
    // itself, which falls back to a neutral score rather than fabricating
    // a good or bad track record.
    const ownerUser = await User.findById(route.truckOwnerId).select('ratingAvg');
    const ownerRatingAvg = ownerUser?.ratingAvg ?? null;

    const matches = [];
    for (const load of loads) {
      const result = scoreMatch({ vehicle, trip: route, load, ownerRatingAvg });
      if (result.eligible) {
        matches.push({ load, ...result });
      }
    }
    matches.sort((a, b) => b.matchScore - a.matchScore);

    const top = matches.slice(0, MAX_RESULTS);
    await Promise.all([
      attachMlCompatibility(top, (m) => ({ vehicle, trip: route, load: m.load, ownerRatingAvg })),
      attachMlProfitability(top, (m) => ({ vehicle, trip: route, load: m.load })),
    ]);

    res.json({ trip: route, vehicle, matches: top });
  } catch (err) {
    console.error('[matching/for-trip]', err);
    res.status(500).json({ error: 'Could not compute matches for this trip.' });
  }
});

// GET /api/matching/chain-for-trip/:tripId
router.get('/chain-for-trip/:tripId', async (req, res) => {
  try {
    const route = await Route.findById(req.params.tripId).populate('truckId');
    if (!route || !route.truckId) return res.status(404).json({ error: 'Trip not found.' });

    const ownerId = await scopeOwnerId(req);
    if (String(route.truckOwnerId) !== String(ownerId)) {
      return res.status(403).json({ error: 'You do not have access to this trip.' });
    }

    const vehicle = route.truckId;
    const openLoads = await Load.find({ status: 'open' });

    const result = findBestChainForTrip({ vehicle, trip: route, openLoads });
    res.json({ trip: route, vehicle, ...result });
  } catch (err) {
    console.error('[matching/chain-for-trip]', err);
    res.status(500).json({ error: 'Could not compute a chain comparison for this trip.' });
  }
});

// GET /api/matching/for-load/:loadId
router.get('/for-load/:loadId', async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found.' });

    if (String(load.postedBy) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You do not have access to this load.' });
    }

    const routes = await Route.find({ status: 'available' }).populate('truckId');

    // Reliability factor (SRS Section 6), mirror of /for-trip above -- here
    // the candidates span many different truck owners, so batch-fetch
    // every distinct owner's cached ratingAvg in one query instead of one
    // per candidate.
    const ownerIds = [...new Set(routes.map((r) => String(r.truckOwnerId)).filter(Boolean))];
    const ownerUsers = await User.find({ _id: { $in: ownerIds } }).select('ratingAvg');
    const ratingByOwnerId = new Map(ownerUsers.map((u) => [String(u._id), u.ratingAvg ?? null]));

    const matches = [];
    for (const route of routes) {
      const vehicle = route.truckId;
      if (!vehicle || vehicle.status !== 'active') continue;
      const ownerRatingAvg = ratingByOwnerId.get(String(route.truckOwnerId)) ?? null;
      const result = scoreMatch({ vehicle, trip: route, load, ownerRatingAvg });
      if (result.eligible) {
        matches.push({ trip: route, vehicle, ownerRatingAvg, ...result });
      }
    }
    matches.sort((a, b) => b.matchScore - a.matchScore);

    const top = matches.slice(0, MAX_RESULTS);
    await Promise.all([
      attachMlCompatibility(top, (m) => ({ vehicle: m.vehicle, trip: m.trip, load, ownerRatingAvg: m.ownerRatingAvg })),
      attachMlProfitability(top, (m) => ({ vehicle: m.vehicle, trip: m.trip, load })),
    ]);

    res.json({ load, matches: top });
  } catch (err) {
    console.error('[matching/for-load]', err);
    res.status(500).json({ error: 'Could not compute matches for this load.' });
  }
});

module.exports = router;
