const express = require('express');

const Load = require('../models/Load');
const Route = require('../models/Route');
const DemandForecast = require('../models/DemandForecast');
const { requireAuth } = require('../middleware/auth');
const { isKnownCity, cityDistanceKm } = require('../utils/distance');
const { getDemandForecast, getEmptyRunRiskBatch } = require('../services/mlClient');
const { scopeOwnerId } = require('./trucks');

// "Route Insights" -- the UI home for ML Modules 3 (Demand Forecasting)
// and 4 (Empty-Run Risk Prediction). ER-diagram migration: reads the
// caller's available trips from the `routes` collection (ER diagram's
// ROUTE entity) instead of the old `trips` one, and now logs every demand
// forecast actually computed into DemandForecast (ER-diagram
// DEMAND_FORECAST) as a real row, giving "which route has more loads" a
// queryable history instead of a one-off response that's gone once the
// panel closes.
const router = express.Router();
router.use(requireAuth);

const NEARBY_RADIUS_KM = 150;
const RECENT_WINDOW_14D_MS = 14 * 24 * 60 * 60 * 1000;
const RECENT_WINDOW_30D_MS = 30 * 24 * 60 * 60 * 1000;

// GET /api/insights/demand-forecast?origin=&destination= -- ML Module 3.
router.get('/demand-forecast', async (req, res) => {
  try {
    const { origin, destination } = req.query;
    if (!origin || !destination) {
      return res.status(400).json({ error: 'origin and destination are required.' });
    }
    if (!isKnownCity(origin) || !isKnownCity(destination)) {
      return res.json({ eligible: false, reason: "Origin/destination must be one of IBLMS's known cities." });
    }

    const now = Date.now();
    const originRe = new RegExp(`^${origin.trim()}$`, 'i');
    const destinationRe = new RegExp(`^${destination.trim()}$`, 'i');
    const [recentLoadCount14d, recentLoadCount30d] = await Promise.all([
      Load.countDocuments({
        pickupLocation: originRe,
        deliveryLocation: destinationRe,
        createdAt: { $gte: new Date(now - RECENT_WINDOW_14D_MS) },
      }),
      Load.countDocuments({
        pickupLocation: originRe,
        deliveryLocation: destinationRe,
        createdAt: { $gte: new Date(now - RECENT_WINDOW_30D_MS) },
      }),
    ]);

    const forecast = await getDemandForecast({
      origin,
      destination,
      anchorDate: new Date(now).toISOString(),
      recentLoadCount14d,
      recentLoadCount30d,
    });

    if (!forecast) {
      return res.json({ eligible: false, reason: 'The demand forecasting model is unavailable right now.' });
    }

    // ER-diagram DEMAND_FORECAST: log this call as a real row (not
    // awaited-and-blocking the response -- a logging failure should never
    // stop the user from seeing their forecast).
    DemandForecast.create({
      origin,
      destination,
      anchorDate: new Date(now),
      recentLoadCount14d,
      recentLoadCount30d,
      predictedLoadCount7d: forecast.predictedLoadCount7d,
      demandCategory: forecast.demandCategory,
      modelVersion: forecast.modelVersion,
      requestedBy: req.user.sub,
    }).catch((err) => console.error('[insights/demand-forecast] could not log DemandForecast row:', err.message));

    res.json({
      eligible: true,
      origin,
      destination,
      recentLoadCount14d,
      recentLoadCount30d,
      predictedLoadCount7d: forecast.predictedLoadCount7d,
      demandCategory: forecast.demandCategory,
      modelVersion: forecast.modelVersion,
    });
  } catch (err) {
    console.error('[insights/demand-forecast]', err);
    res.status(500).json({ error: 'Could not compute a demand forecast for that route.' });
  }
});

// GET /api/insights/empty-run-risk -- ML Module 4.
router.get('/empty-run-risk', async (req, res) => {
  try {
    const ownerId = await scopeOwnerId(req);
    if (!ownerId) return res.json({ trips: [] });

    const routes = await Route.find({ truckOwnerId: ownerId, status: 'available' }).populate('truckId').sort({ availableFrom: 1 });
    const scorable = routes.filter((route) => route.truckId);

    const openLoads = await Load.find({ status: 'open' });

    const items = scorable.map((route) => {
      const vehicle = route.truckId;
      const compatibleLoadsNearbyCount = openLoads.filter((load) => {
        if (load.cargoWeightTonnes > vehicle.maxCapacityTonnes) return false;
        if (load.requiredVehicleType !== 'any' && load.requiredVehicleType !== vehicle.vehicleType) return false;
        const distanceKm = cityDistanceKm(route.destination, load.pickupLocation);
        return distanceKm != null && distanceKm <= NEARBY_RADIUS_KM;
      }).length;

      return {
        id: String(route._id),
        vehicle: { vehicleType: vehicle.vehicleType, maxCapacityTonnes: vehicle.maxCapacityTonnes },
        tripSource: route.source,
        tripDestination: route.destination,
        availableFrom: route.availableFrom,
        compatibleLoadsNearbyCount,
      };
    });

    const riskById = await getEmptyRunRiskBatch(items);

    const results = scorable.map((route, i) => {
      const risk = riskById.get(items[i].id);
      return {
        trip: { ...route.toObject(), vehicleId: route.truckId },
        compatibleLoadsNearbyCount: items[i].compatibleLoadsNearbyCount,
        emptyRunRiskPct: risk ? risk.emptyRunRiskPct : null,
        riskLevel: risk ? risk.riskLevel : null,
        modelVersion: risk ? risk.modelVersion : null,
      };
    });

    res.json({ trips: results });
  } catch (err) {
    console.error('[insights/empty-run-risk]', err);
    res.status(500).json({ error: 'Could not compute empty-run risk for your trips.' });
  }
});

module.exports = router;
