const express = require('express');

const Match = require('../models/Match');
const MatchScorePrediction = require('../models/MatchScorePrediction');
const ProfitabilityPrediction = require('../models/ProfitabilityPrediction');
const RouteFeasibility = require('../models/RouteFeasibility');
const TruckLocationLog = require('../models/TruckLocationLog');
const Notification = require('../models/Notification');
const Route = require('../models/Route');
const Load = require('../models/Load');
const Truck = require('../models/Truck');
const { requireAuth } = require('../middleware/auth');
const { scoreMatch } = require('../services/matching');
const { scopeOwnerId } = require('./trucks');

// ER-diagram migration: REPLACES the old routes/requests.js. The booking
// lifecycle now lives in the `matches` collection (ER diagram's MATCH
// entity, models/Match.js) instead of `loadrequests` -- and, per the
// user's explicit choice to FULLY normalize rather than keep the old
// embedded fields, the match score / profitability / route-feasibility
// breakdown that used to live inline on LoadRequest are now written out to
// their own 1:1 tables (MatchScorePrediction, ProfitabilityPrediction,
// RouteFeasibility) at creation time, same "frozen snapshot, explainable
// later" guarantee as before, just as real separate rows a mentor can
// inspect in Compass instead of a nested object. Mounted at the SAME
// /api/requests path with the SAME response field names (tripId, vehicleId,
// matchScore, scoreBreakdown, profitability, liveLocation, ...) as the old
// requests.js, so lib/requestApi.js, RequestsPanel.jsx, MatchResults.jsx and
// TripMap.jsx keep working unmodified.
const router = express.Router();
router.use(requireAuth);

const ALLOWED_TRANSITIONS = {
  pending_fleet_approval: ['requested', 'rejected', 'cancelled'],
  requested: ['accepted', 'rejected', 'cancelled'],
  accepted: ['confirmed', 'cancelled'],
  confirmed: ['pickup', 'cancelled'],
  pickup: ['in_transit'],
  in_transit: ['delivered'],
  delivered: ['completed'],
};

function driverOwnsThisVehicle(req, truck) {
  return req.user.role !== 'driver' || (truck.assignedDriverId && String(truck.assignedDriverId) === String(req.user.sub));
}

async function sideOfCaller(req, match) {
  const ownerId = await scopeOwnerId(req);
  if (ownerId && String(ownerId) === String(match.truckOwnerId)) {
    if (req.user.role === 'driver') {
      const truck = await Truck.findById(match.truckId).select('assignedDriverId');
      if (!truck || String(truck.assignedDriverId) !== String(req.user.sub)) return null;
    }
    return 'vehicle';
  }
  if (String(req.user.sub) === String(match.loadPosterId)) return 'poster';
  return null;
}

// Shapes a Match (+ its populated route/truck/load) into the exact JSON
// shape the old LoadRequest collection used to return, with matchScore/
// scoreBreakdown/profitability read back from the 3 prediction tables
// instead of embedded fields.
async function toLegacyRequestShape(match, { route, truck, load } = {}) {
  const obj = match.toObject ? match.toObject() : match;
  const [scorePred, profitPred, routeFeas] = await Promise.all([
    MatchScorePrediction.findOne({ matchId: match._id }),
    ProfitabilityPrediction.findOne({ matchId: match._id }),
    RouteFeasibility.findOne({ matchId: match._id }),
  ]);
  return {
    _id: obj._id,
    tripId: route !== undefined ? route : obj.routeId,
    vehicleId: truck !== undefined ? truck : obj.truckId,
    loadId: load !== undefined ? load : obj.loadId,
    vehicleOwnerId: obj.truckOwnerId,
    loadPosterId: obj.loadPosterId,
    requestedBy: obj.requestedBy,
    requestedByRole: obj.requestedByRole,
    status: obj.status,
    matchScore: scorePred ? scorePred.ruleBasedScore : null,
    scoreBreakdown: scorePred ? { factors: scorePred.factors, weights: scorePred.weights, detourKm: routeFeas?.detourKm ?? null } : null,
    profitability: profitPred
      ? {
          revenue: profitPred.estimatedRevenue,
          estimatedFuelCost: profitPred.estimatedFuelCost,
          estimatedTollCost: profitPred.estimatedTollCost,
          estimatedOtherCost: profitPred.otherEstimatedCosts,
          estimatedOperatingCost: profitPred.estimatedOperatingCost,
          estimatedProfit: profitPred.predictedProfit,
        }
      : null,
    liveLocation: obj.liveLocation,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

// POST /api/requests -- book a specific route<->load pairing.
router.post('/', async (req, res) => {
  try {
    const { tripId, loadId } = req.body;
    if (!tripId || !loadId) {
      return res.status(400).json({ error: 'tripId and loadId are required.' });
    }

    const route = await Route.findById(tripId).populate('truckId');
    if (!route || !route.truckId) return res.status(404).json({ error: 'Trip not found.' });
    const load = await Load.findById(loadId);
    if (!load) return res.status(404).json({ error: 'Load not found.' });

    const ownerId = await scopeOwnerId(req);
    const isVehicleSide = ownerId && String(ownerId) === String(route.truckOwnerId);
    const isPosterSide = String(req.user.sub) === String(load.postedBy);
    if (!isVehicleSide && !isPosterSide) {
      return res.status(403).json({ error: 'You must be the owner of this trip or this load to request a booking.' });
    }
    if (isVehicleSide && !driverOwnsThisVehicle(req, route.truckId)) {
      return res.status(403).json({
        error: 'You do not have a vehicle assigned to you yet. Ask your Fleet Owner to assign you one before requesting a load.',
      });
    }

    const existing = await Match.findOne({
      routeId: tripId,
      loadId,
      status: { $nin: ['rejected', 'cancelled'] },
    });
    if (existing) {
      return res.status(409).json({ error: 'There is already an active request between this trip and this load.' });
    }

    const truck = route.truckId;
    const result = scoreMatch({ vehicle: truck, trip: route, load });
    if (!result.eligible) {
      return res.status(400).json({ error: result.reason });
    }

    const initialStatus = isVehicleSide && req.user.role === 'driver' ? 'pending_fleet_approval' : 'requested';

    const match = await Match.create({
      routeId: route._id,
      truckId: truck._id,
      loadId: load._id,
      truckOwnerId: route.truckOwnerId,
      loadPosterId: load.postedBy,
      requestedBy: req.user.sub,
      requestedByRole: req.user.role,
      status: initialStatus,
    });

    // Full normalization: the score/profitability/feasibility snapshot
    // this match was recommended on is written out to its own 1:1 tables
    // instead of staying embedded, so each is a real, independently
    // queryable row (ER-diagram MATCH_SCORE_PREDICTION /
    // PROFITABILITY_PREDICTION / ROUTE_FEASIBILITY).
    await Promise.all([
      MatchScorePrediction.create({
        matchId: match._id,
        ruleBasedScore: result.matchScore,
        factors: result.factors,
        weights: result.weights,
      }),
      result.profitability && !result.profitability.error
        ? ProfitabilityPrediction.create({
            matchId: match._id,
            estimatedRevenue: result.profitability.revenue,
            estimatedFuelCost: result.profitability.estimatedFuelCost,
            estimatedTollCost: result.profitability.estimatedTollCost,
            otherEstimatedCosts: result.profitability.estimatedOtherCost,
            estimatedOperatingCost: result.profitability.estimatedOperatingCost,
            predictedProfit: result.profitability.estimatedProfit,
          })
        : null,
      RouteFeasibility.create({
        matchId: match._id,
        detourKm: result.detourKm,
        feasible: true,
      }),
    ]);

    res.status(201).json({ request: await toLegacyRequestShape(match, { route, truck, load }) });
  } catch (err) {
    console.error('[matches/create]', err);
    res.status(500).json({ error: 'Could not create the booking request.' });
  }
});

// GET /api/requests -- "my requests", from either side.
router.get('/', async (req, res) => {
  try {
    const or = [{ loadPosterId: req.user.sub, status: { $ne: 'pending_fleet_approval' } }];

    if (req.user.role === 'driver') {
      const myTrucks = await Truck.find({ assignedDriverId: req.user.sub }).select('_id');
      if (myTrucks.length) {
        or.push({ truckId: { $in: myTrucks.map((v) => v._id) } });
      }
    } else {
      const ownerId = await scopeOwnerId(req);
      if (ownerId) or.push({ truckOwnerId: ownerId });
    }

    const matches = await Match.find({ $or: or })
      .populate('routeId')
      .populate('truckId')
      .populate('loadId')
      .sort({ createdAt: -1 });

    const requests = await Promise.all(
      matches.map((m) => toLegacyRequestShape(m, { route: m.routeId, truck: m.truckId, load: m.loadId })),
    );

    res.json({ requests });
  } catch (err) {
    console.error('[matches/list]', err);
    res.status(500).json({ error: 'Could not load your requests.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const match = await Match.findById(req.params.id).populate('routeId').populate('truckId').populate('loadId');
    if (!match) return res.status(404).json({ error: 'Request not found.' });
    const side = await sideOfCaller(req, match);
    if (!side) return res.status(403).json({ error: 'You do not have access to this request.' });
    if (side === 'poster' && match.status === 'pending_fleet_approval') {
      return res.status(403).json({ error: 'This request has not been approved by the Fleet Owner yet.' });
    }
    res.json({ request: await toLegacyRequestShape(match, { route: match.routeId, truck: match.truckId, load: match.loadId }) });
  } catch (err) {
    console.error('[matches/get]', err);
    res.status(500).json({ error: 'Could not load the request.' });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { status: nextStatus } = req.body;
    if (!nextStatus) return res.status(400).json({ error: 'status is required.' });

    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Request not found.' });

    const side = await sideOfCaller(req, match);
    if (!side) return res.status(403).json({ error: 'You do not have access to this request.' });

    if (nextStatus === 'cancelled') {
      if (!['pending_fleet_approval', 'requested', 'accepted', 'confirmed'].includes(match.status)) {
        return res.status(400).json({ error: `A request in status "${match.status}" can no longer be cancelled.` });
      }
    } else {
      const allowed = ALLOWED_TRANSITIONS[match.status] || [];
      if (!allowed.includes(nextStatus)) {
        return res.status(400).json({ error: `Cannot move from "${match.status}" to "${nextStatus}".` });
      }
    }

    if (match.status === 'pending_fleet_approval' && ['requested', 'rejected'].includes(nextStatus)) {
      if (req.user.role !== 'fleet_owner' || String(req.user.sub) !== String(match.truckOwnerId)) {
        return res.status(403).json({ error: 'Only your Fleet Owner can approve or reject this request.' });
      }
    }

    if (['accepted', 'rejected'].includes(nextStatus) && String(match.requestedBy) === String(req.user.sub)) {
      return res.status(403).json({ error: 'You cannot accept or reject your own request -- that is up to the other party.' });
    }

    match.status = nextStatus;
    if (nextStatus === 'confirmed' && !match.matchedAt) match.matchedAt = new Date();
    if (nextStatus === 'pickup') match.pickupConfirmedTime = new Date();
    if (nextStatus === 'delivered') match.deliveryConfirmedTime = new Date();
    await match.save();

    if (nextStatus === 'confirmed') {
      await Route.findByIdAndUpdate(match.routeId, { status: 'matched' });
      await Load.findByIdAndUpdate(match.loadId, { status: 'matched' });
    } else if (nextStatus === 'completed') {
      await Route.findByIdAndUpdate(match.routeId, { status: 'completed' });
      await Load.findByIdAndUpdate(match.loadId, { status: 'completed' });
    } else if (nextStatus === 'cancelled' || nextStatus === 'rejected') {
      await Route.findByIdAndUpdate(match.routeId, { status: 'available' });
      await Load.findByIdAndUpdate(match.loadId, { status: 'open' });
    }

    // ER-diagram NOTIFICATION: a real row for the other party whenever a
    // match's status changes, instead of only showing up to whoever
    // happens to be looking at this request right now.
    const otherPartyUserId =
      String(req.user.sub) === String(match.requestedBy)
        ? null // the actor already knows; notify whoever they just acted on
        : match.requestedBy;
    if (otherPartyUserId) {
      await Notification.create({
        userId: otherPartyUserId,
        type: 'match_status_change',
        title: 'Booking update',
        message: `Your request is now "${nextStatus.replace(/_/g, ' ')}".`,
        relatedMatchId: match._id,
      });
    }

    const populated = await Match.findById(match._id).populate('routeId').populate('truckId').populate('loadId');
    res.json({ request: await toLegacyRequestShape(populated, { route: populated.routeId, truck: populated.truckId, load: populated.loadId }) });
  } catch (err) {
    console.error('[matches/update-status]', err);
    res.status(500).json({ error: 'Could not update the request status.' });
  }
});

// PATCH /api/requests/:id/location -- real GPS, and every reading (real or
// the frontend's clearly-labelled simulated preview) is also appended to
// TruckLocationLog as a real, queryable trail (ER-diagram
// TRUCK_LOCATION_LOG), not just overwritten in place.
router.patch('/:id/location', async (req, res) => {
  try {
    const { lat, lng, source } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng must both be numbers.' });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'lat/lng is out of range.' });
    }

    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Request not found.' });

    const side = await sideOfCaller(req, match);
    if (side !== 'vehicle') {
      return res.status(403).json({ error: 'Only the vehicle side of this booking can report its location.' });
    }
    if (!['pickup', 'in_transit'].includes(match.status)) {
      return res.status(400).json({ error: `Location sharing is only available while a booking is in pickup or in transit (this one is "${match.status}").` });
    }

    // A simulated point (TripMap's client-side drift preview, persisted so
    // it's a real TruckLocationLog trail rather than purely decorative) is
    // deliberately NEVER written into match.liveLocation -- that field is
    // what makes the other party's map show a red "Live" marker, and this
    // app's own design promise (see TripMap.jsx's header comment) is to
    // never present invented data as real telemetry. Only a genuine GPS
    // reading (source omitted or 'real_gps') updates it.
    const isSimulated = source === 'simulated';
    if (!isSimulated) {
      match.liveLocation = { lat, lng, updatedAt: new Date() };
      await match.save();
    }
    await TruckLocationLog.create({
      truckId: match.truckId,
      matchId: match._id,
      lat,
      lng,
      source: isSimulated ? 'simulated' : 'real_gps',
    });
    res.json({ liveLocation: match.liveLocation, logged: true });
  } catch (err) {
    console.error('[matches/update-location]', err);
    res.status(500).json({ error: 'Could not update the live location.' });
  }
});

module.exports = router;
