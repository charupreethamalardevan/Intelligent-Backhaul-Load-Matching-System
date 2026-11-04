const express = require('express');

const Load = require('../models/Load');
const LoadItem = require('../models/LoadItem');
const LoadLandmark = require('../models/LoadLandmark');
const Truck = require('../models/Truck');
const { requireAuth } = require('../middleware/auth');
const { distanceKm } = require('../utils/distance');
const { estimateProfitability } = require('../services/profitability');
const { scoreLeg2Candidates } = require('../services/chainFinder');
const { scopeOwnerId } = require('./trucks');

const router = express.Router();
router.use(requireAuth);

const MAX_NEARBY_RESULTS = 20;
const MAX_DISCOVER_RESULTS = 15;
const DEFAULT_RADIUS_KM = 150;

const POSTER_ROLES = ['business_poster', 'individual_poster'];

function requirePosterRole(req, res, next) {
  if (!POSTER_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only Business and Individual posters can post loads.' });
  }
  next();
}

// POST /api/loads -- a shipper's transportation requirement (SRS Section 11).
// ER-diagram migration: also writes the ER-diagram's LOAD_ITEM (a single
// cargo line, itemNumber 1, matching this Load's own cargoType/
// cargoWeightTonnes -- the schema supports more than one line, this app's
// posting form still collects exactly one) and LOAD_LANDMARK (pickup +
// delivery points, so the Map and Route Module has real landmark rows to
// read instead of only the free-text location strings) as real rows
// alongside the Load itself.
router.post('/', requirePosterRole, async (req, res) => {
  try {
    const {
      pickupLocation,
      deliveryLocation,
      cargoType,
      cargoWeightTonnes,
      requiredVehicleType,
      pickupDateTime,
      deliveryDeadline,
      specialRequirements,
      expectedPrice,
    } = req.body;

    if (!pickupLocation || !deliveryLocation || !cargoType || !cargoWeightTonnes || !pickupDateTime || !deliveryDeadline || !expectedPrice) {
      return res.status(400).json({
        error: 'pickupLocation, deliveryLocation, cargoType, cargoWeightTonnes, pickupDateTime, deliveryDeadline and expectedPrice are required.',
      });
    }
    // pickupLocation/deliveryLocation are now {label, lat, lng} points
    // (an address search result, a map click, or live GPS), not a plain
    // known-city string -- reject anything that didn't resolve to real
    // coordinates before it ever reaches the matching/profitability
    // engines, same guarantee the old city dropdown gave for free.
    const hasCoords = (loc) => loc && typeof loc.lat === 'number' && typeof loc.lng === 'number' && loc.label;
    if (!hasCoords(pickupLocation) || !hasCoords(deliveryLocation)) {
      return res.status(400).json({ error: 'pickupLocation and deliveryLocation must be a selected address, map point or current location, not free text.' });
    }
    if (new Date(pickupDateTime) > new Date(deliveryDeadline)) {
      return res.status(400).json({ error: 'The delivery deadline must be after the pickup time.' });
    }

    const load = await Load.create({
      postedBy: req.user.sub,
      pickupLocation,
      deliveryLocation,
      cargoType,
      cargoWeightTonnes,
      requiredVehicleType: requiredVehicleType || 'any',
      pickupDateTime,
      deliveryDeadline,
      specialRequirements,
      expectedPrice,
    });

    await Promise.all([
      LoadItem.create({ loadId: load._id, itemNumber: 1, cargoType, weightTonnes: cargoWeightTonnes, description: specialRequirements }),
      LoadLandmark.create({ loadId: load._id, landmarkNumber: 1, label: pickupLocation.label, lat: pickupLocation.lat, lng: pickupLocation.lng, kind: 'pickup_point' }),
      LoadLandmark.create({ loadId: load._id, landmarkNumber: 2, label: deliveryLocation.label, lat: deliveryLocation.lat, lng: deliveryLocation.lng, kind: 'delivery_point' }),
    ]).catch((err) => console.error('[loads/create] could not write LoadItem/LoadLandmark rows:', err.message));

    res.status(201).json({ load });
  } catch (err) {
    console.error('[loads/create]', err);
    res.status(500).json({ error: 'Could not post the load. Please check the details and try again.' });
  }
});

// GET /api/loads -- "my posted loads".
router.get('/', requirePosterRole, async (req, res) => {
  try {
    const loads = await Load.find({ postedBy: req.user.sub }).sort({ createdAt: -1 });
    res.json({ loads });
  } catch (err) {
    console.error('[loads/list]', err);
    res.status(500).json({ error: 'Could not load your loads.' });
  }
});

// GET /api/loads/near?lat=&lng=&label=&radiusKm=150 -- `lat`/`lng` are now a
// real point (any address, map click or live-GPS fix), not a known-city
// id, so this works for anywhere the user actually is, not just the ~16
// hardcoded cities. `label` is only echoed back for display.
router.get('/near', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng are required.' });
    }
    const origin = { lat, lng };
    const label = req.query.label ? String(req.query.label) : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const radiusKm = Number(req.query.radiusKm) > 0 ? Number(req.query.radiusKm) : DEFAULT_RADIUS_KM;

    const openLoads = await Load.find({ status: 'open' });
    const nearby = openLoads
      .map((load) => ({ load, distanceKm: distanceKm(origin, load.pickupLocation) }))
      .filter((entry) => entry.distanceKm != null && entry.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, MAX_NEARBY_RESULTS);

    res.json({ location: label, radiusKm, loads: nearby });
  } catch (err) {
    console.error('[loads/near]', err);
    res.status(500).json({ error: 'Could not search for loads near that location.' });
  }
});

// GET /api/loads/discover?vehicleId=&lat=&lng=&label=&availableFrom=&radiusKm=150
//
// For a driver/owner who has NOT planned a trip yet: "what open loads
// exist near me right now that my vehicle could actually carry?" -- the
// entry point the user asked for after pointing out that Plan-a-Trip's
// own required destination makes no sense before you've seen any loads.
// Hard-filters by this vehicle's real capacity/type/availability -- the
// SAME constraints scoreMatch() checks later (routes/matches.js), so
// nothing returned here would be rejected once the frontend turns it
// into an actual trip+request. Profitability is estimated via the
// existing estimateProfitability() with the trip framed as
// (here -> this load's own delivery point) -- i.e. exactly the trip this
// load WOULD become if picked, not a new formula.
router.get('/discover', async (req, res) => {
  try {
    const { vehicleId } = req.query;
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!vehicleId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'vehicleId, lat and lng are required.' });
    }
    const availableFrom = req.query.availableFrom ? new Date(req.query.availableFrom) : new Date();
    const radiusKm = Number(req.query.radiusKm) > 0 ? Number(req.query.radiusKm) : DEFAULT_RADIUS_KM;
    const origin = { lat, lng };
    const label = req.query.label ? String(req.query.label) : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    const truck = await Truck.findById(vehicleId);
    if (!truck) return res.status(404).json({ error: 'Vehicle not found.' });
    const ownerId = await scopeOwnerId(req);
    if (!ownerId || String(truck.truckOwnerId) !== String(ownerId)) {
      return res.status(403).json({ error: 'You do not have access to this vehicle.' });
    }
    if (req.user.role === 'driver' && String(truck.assignedDriverId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'This vehicle is not assigned to you.' });
    }

    const openLoads = await Load.find({ status: 'open' });
    const candidates = [];
    for (const load of openLoads) {
      if (load.cargoWeightTonnes > truck.maxCapacityTonnes) continue;
      if (load.requiredVehicleType !== 'any' && load.requiredVehicleType !== truck.vehicleType) continue;
      if (availableFrom > new Date(load.deliveryDeadline)) continue;

      const distanceToPickupKm = distanceKm(origin, load.pickupLocation);
      if (distanceToPickupKm == null || distanceToPickupKm > radiusKm) continue;

      const profitability = estimateProfitability({
        tripSource: origin,
        tripDestination: load.deliveryLocation,
        pickupLocation: load.pickupLocation,
        deliveryLocation: load.deliveryLocation,
        expectedPrice: load.expectedPrice,
      });

      candidates.push({ load, distanceToPickupKm, profitability });
    }

    candidates.sort((a, b) => a.distanceToPickupKm - b.distanceToPickupKm);
    const topCandidates = candidates.slice(0, MAX_DISCOVER_RESULTS);

    // For each candidate, also suggest the best backhaul load waiting on
    // the OTHER side of it -- the user's own point: a driver picking a
    // load here has no return leg either, so show one alongside it
    // rather than making them discover the empty-run problem later.
    // Reuses services/chainFinder.js's existing leg-2 scoring UNCHANGED
    // (the same function that already powers the Find Loads tab's Chain
    // Comparison for a planned trip) -- this candidate load simply plays
    // the role chainFinder calls "load1": the vehicle drops it at
    // load1.deliveryLocation, then scoreLeg2Candidates finds the best
    // next load from there among the same openLoads list already
    // fetched above. No new scoring formula.
    const withBackhauls = topCandidates.map((entry) => {
      const leg2 = scoreLeg2Candidates({ vehicle: truck, load1: entry.load, loads: openLoads });
      return { ...entry, suggestedBackhaul: leg2[0] || null };
    });

    res.json({ location: label, radiusKm, availableFrom, loads: withBackhauls });
  } catch (err) {
    console.error('[loads/discover]', err);
    res.status(500).json({ error: 'Could not discover loads near that location.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const load = await Load.findById(req.params.id);
    if (!load) return res.status(404).json({ error: 'Load not found.' });
    res.json({ load });
  } catch (err) {
    console.error('[loads/get]', err);
    res.status(500).json({ error: 'Could not load the load.' });
  }
});

router.put('/:id', requirePosterRole, async (req, res) => {
  try {
    const load = await Load.findById(req.params.id);
    if (!load) return res.status(404).json({ error: 'Load not found.' });
    if (String(load.postedBy) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only edit your own loads.' });
    }
    const fields = [
      'pickupLocation',
      'deliveryLocation',
      'cargoType',
      'cargoWeightTonnes',
      'requiredVehicleType',
      'pickupDateTime',
      'deliveryDeadline',
      'specialRequirements',
      'expectedPrice',
      'status',
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) load[f] = req.body[f];
    }
    await load.save();
    res.json({ load });
  } catch (err) {
    console.error('[loads/update]', err);
    res.status(500).json({ error: 'Could not update the load.' });
  }
});

router.delete('/:id', requirePosterRole, async (req, res) => {
  try {
    const load = await Load.findById(req.params.id);
    if (!load) return res.status(404).json({ error: 'Load not found.' });
    if (String(load.postedBy) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only remove your own loads.' });
    }
    await load.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error('[loads/delete]', err);
    res.status(500).json({ error: 'Could not remove the load.' });
  }
});

module.exports = router;
