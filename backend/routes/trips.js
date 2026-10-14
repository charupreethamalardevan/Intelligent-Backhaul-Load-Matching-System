const express = require('express');

const Trip = require('../models/Trip');
const Vehicle = require('../models/Vehicle');
const { requireAuth } = require('../middleware/auth');
const { scopeOwnerId } = require('./vehicles');

const router = express.Router();
router.use(requireAuth);

const OWNER_ROLES = ['fleet_owner', 'owner_driver'];

function requireOwnerRole(req, res, next) {
  if (!OWNER_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only Fleet Owners and Individual Owners can plan trips.' });
  }
  next();
}

// POST /api/trips -- "this vehicle will be driving source -> destination
// from this time, find it a backhaul load" (SRS Section 4, Step 1).
router.post('/', requireOwnerRole, async (req, res) => {
  try {
    const { vehicleId, source, destination, availableFrom } = req.body;
    if (!vehicleId || !source || !destination || !availableFrom) {
      return res.status(400).json({ error: 'vehicleId, source, destination and availableFrom are required.' });
    }
    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
    if (String(vehicle.ownerId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only plan trips for your own vehicles.' });
    }
    const trip = await Trip.create({ vehicleId, ownerId: req.user.sub, source, destination, availableFrom });
    res.status(201).json({ trip });
  } catch (err) {
    console.error('[trips/create]', err);
    res.status(500).json({ error: 'Could not create the trip. Please check the details and try again.' });
  }
});

// GET /api/trips -- "my trips" (or, for a driver, their Fleet Owner's trips).
router.get('/', async (req, res) => {
  try {
    const ownerId = await scopeOwnerId(req);
    if (!ownerId) return res.json({ trips: [] });
    const trips = await Trip.find({ ownerId }).populate('vehicleId').sort({ availableFrom: -1 });
    res.json({ trips });
  } catch (err) {
    console.error('[trips/list]', err);
    res.status(500).json({ error: 'Could not load trips.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id).populate('vehicleId');
    if (!trip) return res.status(404).json({ error: 'Trip not found.' });
    const ownerId = await scopeOwnerId(req);
    if (String(trip.ownerId) !== String(ownerId)) {
      return res.status(403).json({ error: 'You do not have access to this trip.' });
    }
    res.json({ trip });
  } catch (err) {
    console.error('[trips/get]', err);
    res.status(500).json({ error: 'Could not load the trip.' });
  }
});

router.put('/:id', requireOwnerRole, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found.' });
    if (String(trip.ownerId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only edit your own trips.' });
    }
    const { source, destination, availableFrom, status } = req.body;
    if (source !== undefined) trip.source = source;
    if (destination !== undefined) trip.destination = destination;
    if (availableFrom !== undefined) trip.availableFrom = availableFrom;
    if (status !== undefined) trip.status = status;
    await trip.save();
    res.json({ trip });
  } catch (err) {
    console.error('[trips/update]', err);
    res.status(500).json({ error: 'Could not update the trip.' });
  }
});

router.delete('/:id', requireOwnerRole, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found.' });
    if (String(trip.ownerId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only remove your own trips.' });
    }
    await trip.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error('[trips/delete]', err);
    res.status(500).json({ error: 'Could not remove the trip.' });
  }
});

module.exports = router;
