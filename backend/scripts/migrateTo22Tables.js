// One-off migration: backfills the 22 ER-diagram collections (models/*.js
// added for the full-normalization migration -- see each new route file's
// header comment) from the data that already exists in the old
// User/Vehicle/Trip/LoadRequest/InviteCode collections, so nothing already
// in the database is lost when the app switches over to reading/writing
// the new collections exclusively.
//
// Run once, from backend/, with MongoDB reachable at MONGO_URI:
//   node scripts/migrateTo22Tables.js
//
// Idempotent: every insert here first checks whether the target row
// already exists (by the shared _id this script deliberately reuses -- see
// below) and skips it if so, so running this script twice is harmless.
//
// Key design choice: every new row this script creates reuses the SAME
// _id as the old document it was migrated from (Truck._id = old
// Vehicle._id, Route._id = old Trip._id, Match._id = old LoadRequest._id,
// and every ISA-subtype row's _id = the parent User._id, per the Table
// Reduction doc's own rule #1). This means every existing foreign-key
// reference in the app's current data (a Trip.vehicleId pointing at a
// Vehicle, a LoadRequest.tripId pointing at a Trip) is ALREADY correct
// once read as the new field name (Route.truckId, Match.routeId) -- no
// id-remapping table is needed anywhere in this script.
require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const Trip = require('../models/Trip');
const LoadRequest = require('../models/LoadRequest');
const InviteCode = require('../models/InviteCode');

const TruckOwner = require('../models/TruckOwner');
const Driver = require('../models/Driver');
const LoadPoster = require('../models/LoadPoster');
const Truck = require('../models/Truck');
const Route = require('../models/Route');
const Match = require('../models/Match');
const MatchScorePrediction = require('../models/MatchScorePrediction');
const ProfitabilityPrediction = require('../models/ProfitabilityPrediction');
const RouteFeasibility = require('../models/RouteFeasibility');
const Document = require('../models/Document');
const UserPhone = require('../models/UserPhone');

const { dimensionsFromVehicleType } = require('../utils/truckTypeMapping');

async function migrateUsers() {
  const users = await User.find({});
  let truckOwners = 0, drivers = 0, posters = 0, phones = 0, docs = 0;

  for (const user of users) {
    if (user.role === 'fleet_owner' || user.role === 'owner_driver') {
      const exists = await TruckOwner.findById(user._id);
      if (!exists) {
        await TruckOwner.create({ _id: user._id, companyName: user.companyName, address: '' });
        truckOwners++;
      }
    }
    if (user.role === 'owner_driver') {
      const exists = await Driver.findById(user._id);
      if (!exists) {
        await Driver.create({ _id: user._id, truckOwnerId: user._id });
        drivers++;
      }
    }
    if (user.role === 'driver') {
      const exists = await Driver.findById(user._id);
      if (!exists) {
        await Driver.create({ _id: user._id, truckOwnerId: user.fleetOwnerId });
        drivers++;
      }
    }
    if (user.role === 'business_poster' || user.role === 'individual_poster') {
      const exists = await LoadPoster.findById(user._id);
      if (!exists) {
        await LoadPoster.create({
          _id: user._id,
          businessName: user.role === 'business_poster' ? user.companyName : undefined,
          businessType: user.businessType,
          purpose: user.purpose,
        });
        posters++;
      }
    }

    if (user.phone) {
      const exists = await UserPhone.findOne({ userId: user._id, phoneNumber: user.phone });
      if (!exists) {
        await UserPhone.create({ userId: user._id, phoneNumber: user.phone, phoneType: 'primary' });
        phones++;
      }
    }

    for (const d of user.documents || []) {
      const exists = await Document.findOne({ userId: user._id, path: d.path });
      if (!exists && d.path) {
        await Document.create({
          userId: user._id,
          documentType: ['ownership_doc', 'license_doc', 'rc_book', 'permit', 'gst', 'aadhaar'].includes(d.key) ? d.key : 'license_doc',
          filename: d.filename,
          path: d.path,
          mimeType: d.mimeType,
          uploadedAt: d.uploadedAt,
        });
        docs++;
      }
    }

    // A pre-existing Fleet Driver (migrated from before this script ran)
    // never uploaded their own document -- their license lives on the
    // InviteCode they redeemed. Copy it in now if it's not already there.
    if (user.role === 'driver' && user.inviteCodeId) {
      const invite = await InviteCode.findById(user.inviteCodeId);
      if (invite?.licenseDoc?.path) {
        const exists = await Document.findOne({ userId: user._id, path: invite.licenseDoc.path });
        if (!exists) {
          await Document.create({
            userId: user._id,
            documentType: 'license_doc',
            filename: invite.licenseDoc.filename,
            path: invite.licenseDoc.path,
            mimeType: invite.licenseDoc.mimeType,
          });
          docs++;
        }
      }
    }
  }

  console.log(`[migrate] Users -> TruckOwner:${truckOwners} Driver:${drivers} LoadPoster:${posters} UserPhone:${phones} Document:${docs}`);
}

async function migrateVehicles() {
  const vehicles = await Vehicle.find({});
  let created = 0;
  for (const v of vehicles) {
    const exists = await Truck.findById(v._id);
    if (exists) continue;
    const { capacityClass, bodyType } = dimensionsFromVehicleType(v.vehicleType);
    await Truck.create({
      _id: v._id,
      truckOwnerId: v.ownerId,
      vehicleNumber: v.vehicleNumber,
      vehicleType: v.vehicleType,
      capacityClass,
      bodyType,
      maxCapacityTonnes: v.maxCapacityTonnes,
      fuelType: v.fuelType,
      cargoCompatibility: v.cargoCompatibility,
      driverName: v.driverName,
      driverPhone: v.driverPhone,
      assignedDriverId: v.assignedDriverId,
      status: v.status,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    });
    created++;
  }
  console.log(`[migrate] Vehicle -> Truck: ${created} created (of ${vehicles.length})`);
}

async function migrateTrips() {
  const trips = await Trip.find({});
  let created = 0;
  for (const t of trips) {
    const exists = await Route.findById(t._id);
    if (exists) continue;
    await Route.create({
      _id: t._id,
      truckId: t.vehicleId,
      truckOwnerId: t.ownerId,
      source: t.source,
      destination: t.destination,
      availableFrom: t.availableFrom,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    });
    created++;
    // Mirror the forward link this round's Truck.routeId field expects,
    // same as routes/truckRoutes.js does for a newly-planned trip.
    if (t.status === 'available') {
      await Truck.findByIdAndUpdate(t.vehicleId, { routeId: t._id });
    }
  }
  console.log(`[migrate] Trip -> Route: ${created} created (of ${trips.length})`);
}

async function migrateRequests() {
  const requests = await LoadRequest.find({});
  let matches = 0, scores = 0, profits = 0, feas = 0;
  for (const r of requests) {
    const exists = await Match.findById(r._id);
    if (!exists) {
      await Match.create({
        _id: r._id,
        routeId: r.tripId,
        truckId: r.vehicleId,
        loadId: r.loadId,
        truckOwnerId: r.vehicleOwnerId,
        loadPosterId: r.loadPosterId,
        requestedBy: r.requestedBy,
        requestedByRole: r.requestedByRole,
        status: r.status,
        liveLocation: r.liveLocation,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
      matches++;
    }

    if (r.matchScore != null) {
      const scoreExists = await MatchScorePrediction.findOne({ matchId: r._id });
      if (!scoreExists) {
        await MatchScorePrediction.create({
          matchId: r._id,
          ruleBasedScore: r.matchScore,
          factors: r.scoreBreakdown?.factors,
          weights: r.scoreBreakdown?.weights,
        });
        scores++;
      }
      if (r.scoreBreakdown?.detourKm != null) {
        const feasExists = await RouteFeasibility.findOne({ matchId: r._id });
        if (!feasExists) {
          await RouteFeasibility.create({ matchId: r._id, detourKm: r.scoreBreakdown.detourKm, feasible: true });
          feas++;
        }
      }
    }

    if (r.profitability && !r.profitability.error) {
      const profitExists = await ProfitabilityPrediction.findOne({ matchId: r._id });
      if (!profitExists) {
        await ProfitabilityPrediction.create({
          matchId: r._id,
          estimatedRevenue: r.profitability.revenue,
          estimatedFuelCost: r.profitability.estimatedFuelCost,
          estimatedTollCost: r.profitability.estimatedTollCost,
          otherEstimatedCosts: r.profitability.estimatedOtherCost,
          estimatedOperatingCost: r.profitability.estimatedOperatingCost,
          predictedProfit: r.profitability.estimatedProfit,
        });
        profits++;
      }
    }
  }
  console.log(`[migrate] LoadRequest -> Match:${matches} MatchScorePrediction:${scores} ProfitabilityPrediction:${profits} RouteFeasibility:${feas}`);
}

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('[migrate] MONGO_URI is not set in backend/.env -- aborting.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('[migrate] Connected to MongoDB. Starting migration...');

  await migrateUsers();
  await migrateVehicles();
  await migrateTrips();
  await migrateRequests();

  console.log('[migrate] Done. The 22-table collections are now backfilled from your existing data.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[migrate] Migration failed:', err);
  process.exit(1);
});
