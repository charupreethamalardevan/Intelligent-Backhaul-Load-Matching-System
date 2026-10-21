const express = require('express');

const Route = require('../models/Route');
const Truck = require('../models/Truck');
const { requireAuth } = require('../middleware/auth');
const { scopeOwnerId } = require('./trucks');

// ER-diagram migration: REPLACES the old routes/trips.js. The collection
// behind it is now `routes` (the ER diagram's ROUTE entity, models/Route.js)
// instead of `trips` -- this also closes the Design Consistency Review's
// finding #5 ("no truck<->route link"): a Route now links back to its Truck
// via truckId, which Truck.js's own `routeId` field mirrors once planned.
// Mounted at the SAME /api/trips path with the SAME response field names
// (vehicleId, ownerId, source, destination, availableFrom, status) as the
// old trips.js, so lib/tripApi.js and every component that reads a
// trip.vehicleId keeps working unmodified.
const router = express.Router();
router.use(requireAuth);

const OWNER_ROLES = ['fleet_owner', 'owner_driver'];

function requireOwnerRole(req, res, next) {
  if (!OWNER_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only Fleet Owners and Individual Owners can plan trips.' });
  }
  next();
}

function toLegacyTripShape(route) {
  const obj = route.toObject ? route.toObject() : route;
  return {
    _id: obj._id,
    vehicleId: obj.truckId,
    ownerId: obj.truckOwnerId,
    source: obj.source,
    destination: obj.destination,
    waypoints: obj.waypoints,
    availableFrom: obj.availableFrom,
    status: obj.status,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

// POST /api/trips -- "this truck will be driving source -> destination
// from this time, find it a backhaul load" (SRS Section 4, Step 1).
router.post('/', requireOwnerRole, async (req, res) => {
  try {
    const { vehicleId, source, destination, availableFrom, waypoints } = req.body;
    if (!vehicleId || !source || !destination || !availableFrom) {
      return res.status(400).json({ error: 'vehicleId, source, destination and availableFrom are required.' });
    }
    const truck = await Truck.findById(vehicleId);
    if (!truck) return res.status(404).json({ error: 'Vehicle not found.' });
    if (String(truck.truckOwnerId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only plan trips for your own vehicles.' });
    }
    const route = await Route.create({
      truckId: vehicleId,
      truckOwnerId: req.user.sub,
      source,
      destination,
      waypoints: Array.isArray(waypoints) ? waypoints : [],
      availableFrom,
    });
    // Closes Design Consistency Review finding #5: the truck now also
    // points forward to its currently-planned route.
    truck.routeId = route._id;
    await truck.save();
    res.status(201).json({ trip: toLegacyTripShape(route) });
  } catch (err) {
    console.error('[truckRoutes/create]', err);
    res.status(500).json({ error: 'Could not create the trip. Please check the details and try again.' });
  }
});

// GET /api/trips -- "my trips" (or, for a driver, their Fleet Owner's trips).
router.get('/', async (req, res) => {
  try {
    const ownerId = await scopeOwnerId(req);
    if (!ownerId) return res.json({ trips: [] });
    const routes = await Route.find({ truckOwnerId: ownerId }).populate('truckId').sort({ availableFrom: -1 });
    res.json({
      trips: routes.map((r) => ({ ...toLegacyTripShape(r), vehicleId: r.truckId })),
    });
  } catch (err) {
    console.error('[truckRoutes/list]', err);
    res.status(500).json({ error: 'Could not load trips.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const route = await Route.findById(req.params.id).populate('truckId');
    if (!route) return res.status(404).json({ error: 'Trip not found.' });
    const ownerId = await scopeOwnerId(req);
    if (String(route.truckOwnerId) !== String(ownerId)) {
      return res.status(403).json({ error: 'You do not have access to this trip.' });
    }
    res.json({ trip: { ...toLegacyTripShape(route), vehicleId: route.truckId } });
  } catch (err) {
    console.error('[truckRoutes/get]', err);
    res.status(500).json({ error: 'Could not load the trip.' });
  }
});

router.put('/:id', requireOwnerRole, async (req, res) => {
  try {
    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ error: 'Trip not found.' });
    if (String(route.truckOwnerId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only edit your own trips.' });
    }
    const { source, destination, availableFrom, status, waypoints } = req.body;
    if (source !== undefined) route.source = source;
    if (destination !== undefined) route.destination = destination;
    if (availableFrom !== undefined) route.availableFrom = availableFrom;
    if (status !== undefined) route.status = status;
    if (waypoints !== undefined) route.waypoints = waypoints;
    await route.save();
    res.json({ trip: toLegacyTripShape(route) });
  } catch (err) {
    console.error('[truckRoutes/update]', err);
    res.status(500).json({ error: 'Could not update the trip.' });
  }
});

router.delete('/:id', requireOwnerRole, async (req, res) => {
  try {
    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ error: 'Trip not found.' });
    if (String(route.truckOwnerId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only remove your own trips.' });
    }
    await route.deleteOne();
    await Truck.updateMany({ routeId: route._id }, { $set: { routeId: null } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[truckRoutes/delete]', err);
    res.status(500).json({ error: 'Could not remove the trip.' });
  }
});

module.exports = router;
