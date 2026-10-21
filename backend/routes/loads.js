const express = require('express');

const Load = require('../models/Load');
const LoadItem = require('../models/LoadItem');
const LoadLandmark = require('../models/LoadLandmark');
const { requireAuth } = require('../middleware/auth');
const { cityDistanceKm } = require('../utils/distance');

const router = express.Router();
router.use(requireAuth);

const MAX_NEARBY_RESULTS = 20;
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
      LoadLandmark.create({ loadId: load._id, landmarkNumber: 1, label: pickupLocation, kind: 'pickup_point' }),
      LoadLandmark.create({ loadId: load._id, landmarkNumber: 2, label: deliveryLocation, kind: 'delivery_point' }),
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

// GET /api/loads/near?location=<city>&radiusKm=150
router.get('/near', async (req, res) => {
  try {
    const { location } = req.query;
    if (!location) return res.status(400).json({ error: 'location is required.' });
    const radiusKm = Number(req.query.radiusKm) > 0 ? Number(req.query.radiusKm) : DEFAULT_RADIUS_KM;

    const openLoads = await Load.find({ status: 'open' });
    const nearby = openLoads
      .map((load) => ({ load, distanceKm: cityDistanceKm(location, load.pickupLocation) }))
      .filter((entry) => entry.distanceKm != null && entry.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, MAX_NEARBY_RESULTS);

    res.json({ location, radiusKm, loads: nearby });
  } catch (err) {
    console.error('[loads/near]', err);
    res.status(500).json({ error: 'Could not search for loads near that location.' });
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
