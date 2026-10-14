const express = require('express');

const LoadRequest = require('../models/LoadRequest');
const Trip = require('../models/Trip');
const Load = require('../models/Load');
const { requireAuth } = require('../middleware/auth');
const { scoreMatch } = require('../services/matching');
const { scopeOwnerId } = require('./vehicles');

const router = express.Router();
router.use(requireAuth);

// The booking lifecycle (SRS Section 13, extended with the Fleet-Owner
// approval gate). Each key lists the statuses it may move to next;
// anything not listed here is a terminal state. From
// pending_fleet_approval, 'requested' IS the approval (see the
// fleet-owner-only guard in PATCH /:id/status below) and 'rejected' is
// the denial.
const ALLOWED_TRANSITIONS = {
  pending_fleet_approval: ['requested', 'rejected', 'cancelled'],
  requested: ['accepted', 'rejected', 'cancelled'],
  accepted: ['confirmed', 'cancelled'],
  confirmed: ['pickup', 'cancelled'],
  pickup: ['in_transit'],
  in_transit: ['delivered'],
  delivered: ['completed'],
};

// A Fleet Driver may request a load only for the one vehicle their Fleet
// Owner has assigned to them (SRS-evolution) -- never any other vehicle
// in the fleet, even though they can see the whole fleet's trips.
function driverOwnsThisVehicle(req, vehicle) {
  return req.user.role !== 'driver' || (vehicle.assignedDriverId && String(vehicle.assignedDriverId) === String(req.user.sub));
}

async function sideOfCaller(req, request) {
  const ownerId = await scopeOwnerId(req);
  if (ownerId && String(ownerId) === String(request.vehicleOwnerId)) return 'vehicle';
  if (String(req.user.sub) === String(request.loadPosterId)) return 'poster';
  return null;
}

// POST /api/requests -- book a specific trip<->load pairing. Either side
// can initiate (a Fleet Owner offering their trip to a load, or a poster
// requesting a trip for their load); the match score and profitability
// estimate are computed ONCE here and frozen as a snapshot (SRS Section 13:
// the record should explain why this pairing was recommended at the time).
router.post('/', async (req, res) => {
  try {
    const { tripId, loadId } = req.body;
    if (!tripId || !loadId) {
      return res.status(400).json({ error: 'tripId and loadId are required.' });
    }

    const trip = await Trip.findById(tripId).populate('vehicleId');
    if (!trip || !trip.vehicleId) return res.status(404).json({ error: 'Trip not found.' });
    const load = await Load.findById(loadId);
    if (!load) return res.status(404).json({ error: 'Load not found.' });

    const ownerId = await scopeOwnerId(req);
    const isVehicleSide = ownerId && String(ownerId) === String(trip.ownerId);
    const isPosterSide = String(req.user.sub) === String(load.postedBy);
    if (!isVehicleSide && !isPosterSide) {
      return res.status(403).json({ error: 'You must be the owner of this trip or this load to request a booking.' });
    }

    // A Fleet Driver can see their whole fleet's trips, but may only
    // request a load for the specific vehicle assigned to them.
    if (isVehicleSide && !driverOwnsThisVehicle(req, trip.vehicleId)) {
      return res.status(403).json({
        error: 'You do not have a vehicle assigned to you yet. Ask your Fleet Owner to assign you one before requesting a load.',
      });
    }

    const existing = await LoadRequest.findOne({
      tripId,
      loadId,
      status: { $nin: ['rejected', 'cancelled'] },
    });
    if (existing) {
      return res.status(409).json({ error: 'There is already an active request between this trip and this load.' });
    }

    const result = scoreMatch({ vehicle: trip.vehicleId, trip, load });
    if (!result.eligible) {
      return res.status(400).json({ error: result.reason });
    }

    // A request a Fleet Driver initiates must clear their own Fleet
    // Owner before the Load Poster ever sees it -- everyone else's
    // request starts 'requested' as before.
    const initialStatus = isVehicleSide && req.user.role === 'driver' ? 'pending_fleet_approval' : 'requested';

    const request = await LoadRequest.create({
      tripId: trip._id,
      vehicleId: trip.vehicleId._id,
      loadId: load._id,
      vehicleOwnerId: trip.ownerId,
      loadPosterId: load.postedBy,
      requestedBy: req.user.sub,
      requestedByRole: req.user.role,
      status: initialStatus,
      matchScore: result.matchScore,
      scoreBreakdown: { factors: result.factors, weights: result.weights, detourKm: result.detourKm },
      profitability: result.profitability,
    });

    res.status(201).json({ request });
  } catch (err) {
    console.error('[requests/create]', err);
    res.status(500).json({ error: 'Could not create the booking request.' });
  }
});

// GET /api/requests -- "my requests", from either side (vehicle or poster).
// A request still pending_fleet_approval is invisible to the Load Poster
// -- it hasn't been sent to them yet -- but fully visible on the vehicle
// side (the requesting Driver and their Fleet Owner).
router.get('/', async (req, res) => {
  try {
    const ownerId = await scopeOwnerId(req);
    const or = [{ loadPosterId: req.user.sub, status: { $ne: 'pending_fleet_approval' } }];
    if (ownerId) or.push({ vehicleOwnerId: ownerId });

    const requests = await LoadRequest.find({ $or: or })
      .populate('tripId')
      .populate('vehicleId')
      .populate('loadId')
      .sort({ createdAt: -1 });

    res.json({ requests });
  } catch (err) {
    console.error('[requests/list]', err);
    res.status(500).json({ error: 'Could not load your requests.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const request = await LoadRequest.findById(req.params.id).populate('tripId').populate('vehicleId').populate('loadId');
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    const side = await sideOfCaller(req, request);
    if (!side) return res.status(403).json({ error: 'You do not have access to this request.' });
    if (side === 'poster' && request.status === 'pending_fleet_approval') {
      return res.status(403).json({ error: 'This request has not been approved by the Fleet Owner yet.' });
    }
    res.json({ request });
  } catch (err) {
    console.error('[requests/get]', err);
    res.status(500).json({ error: 'Could not load the request.' });
  }
});

// PATCH /api/requests/:id/status -- move the booking through its lifecycle.
// A caller may never accept/reject their own request -- that decision
// belongs to the other party.
router.patch('/:id/status', async (req, res) => {
  try {
    const { status: nextStatus } = req.body;
    if (!nextStatus) return res.status(400).json({ error: 'status is required.' });

    const request = await LoadRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found.' });

    const side = await sideOfCaller(req, request);
    if (!side) return res.status(403).json({ error: 'You do not have access to this request.' });

    if (nextStatus === 'cancelled') {
      if (!['pending_fleet_approval', 'requested', 'accepted', 'confirmed'].includes(request.status)) {
        return res.status(400).json({ error: `A request in status "${request.status}" can no longer be cancelled.` });
      }
    } else {
      const allowed = ALLOWED_TRANSITIONS[request.status] || [];
      if (!allowed.includes(nextStatus)) {
        return res.status(400).json({ error: `Cannot move from "${request.status}" to "${nextStatus}".` });
      }
    }

    // Approving ('requested') or denying ('rejected') a request that's
    // still pending_fleet_approval is the Fleet Owner's call alone -- not
    // the requesting Driver's, even though the Driver is also "vehicle
    // side" and can see this request.
    if (request.status === 'pending_fleet_approval' && ['requested', 'rejected'].includes(nextStatus)) {
      if (req.user.role !== 'fleet_owner' || String(req.user.sub) !== String(request.vehicleOwnerId)) {
        return res.status(403).json({ error: "Only your Fleet Owner can approve or reject this request." });
      }
    }

    if (['accepted', 'rejected'].includes(nextStatus) && String(request.requestedBy) === String(req.user.sub)) {
      return res.status(403).json({ error: 'You cannot accept or reject your own request -- that is up to the other party.' });
    }

    request.status = nextStatus;
    await request.save();

    // Lock the Trip/Load out of further matching once a booking is
    // confirmed, and release them again if it falls through or completes.
    if (nextStatus === 'confirmed') {
      await Trip.findByIdAndUpdate(request.tripId, { status: 'matched' });
      await Load.findByIdAndUpdate(request.loadId, { status: 'matched' });
    } else if (nextStatus === 'completed') {
      await Trip.findByIdAndUpdate(request.tripId, { status: 'completed' });
      await Load.findByIdAndUpdate(request.loadId, { status: 'completed' });
    } else if (nextStatus === 'cancelled' || nextStatus === 'rejected') {
      await Trip.findByIdAndUpdate(request.tripId, { status: 'available' });
      await Load.findByIdAndUpdate(request.loadId, { status: 'open' });
    }

    res.json({ request });
  } catch (err) {
    console.error('[requests/update-status]', err);
    res.status(500).json({ error: 'Could not update the request status.' });
  }
});

// PATCH /api/requests/:id/location -- the vehicle side reports its real,
// live GPS position (from the browser's Geolocation API) while the
// booking is actively on the road. Deliberately narrow: only the
// vehicle-side caller may post a position (never the Load Poster, who
// has nothing to report), and only while status is 'pickup' or
// 'in_transit' -- reporting a position before pickup or after delivery
// wouldn't mean anything, so it's rejected rather than silently stored.
// The frontend polls GET /api/requests/:id to read this back; there is no
// separate GET endpoint for it to keep the lifecycle single-sourced.
router.patch('/:id/location', async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng must both be numbers.' });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'lat/lng is out of range.' });
    }

    const request = await LoadRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found.' });

    const side = await sideOfCaller(req, request);
    if (side !== 'vehicle') {
      return res.status(403).json({ error: 'Only the vehicle side of this booking can report its location.' });
    }
    if (!['pickup', 'in_transit'].includes(request.status)) {
      return res.status(400).json({ error: `Location sharing is only available while a booking is in pickup or in transit (this one is "${request.status}").` });
    }

    request.liveLocation = { lat, lng, updatedAt: new Date() };
    await request.save();
    res.json({ liveLocation: request.liveLocation });
  } catch (err) {
    console.error('[requests/update-location]', err);
    res.status(500).json({ error: 'Could not update the live location.' });
  }
});

module.exports = router;
