/**
 * Gives the 5 fixed demo logins (backend/DEMO_ACCOUNTS.md) real, LIVE data
 * -- trucks, routes, loads, bookings at a few different lifecycle stages,
 * and a couple of real ratings -- so each account has something worth
 * showing the moment you log in, for a demo video or a live walkthrough.
 *
 * IMPORTANT CONTEXT: scripts/seedDemoAccounts.js and scripts/seedPastData.js
 * write to the Vehicle/Trip/LoadRequest collections. Those collections are
 * LEFTOVERS from before the ER-diagram migration -- the live app now reads
 * and writes Truck/Route/Match (see models/Truck.js, Route.js, Match.js and
 * routes/trucks.js, truckRoutes.js, matches.js). Running `npm run seed:demo`
 * creates the 5 user accounts correctly (User is unaffected by the
 * migration), but every vehicle/trip/request it "seeds" lands in those dead
 * collections and is invisible in the live app -- which is why the
 * dashboards still looked empty after seeding. THIS script writes directly
 * to the live collections instead, so what it creates actually shows up.
 *
 * Safe to re-run: every create below is guarded by a "does this already
 * exist" check first, so running it twice never duplicates data.
 *
 * Usage (same as seed:demo -- point MONGO_URI at the database you want
 * this in, e.g. production Atlas, for the duration of this one command):
 *   cd backend
 *   $env:MONGO_URI="...your Atlas string..."; npm run seed:live-demo
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const TruckOwner = require('../models/TruckOwner');
const Driver = require('../models/Driver');
const LoadPoster = require('../models/LoadPoster');
const Truck = require('../models/Truck');
const Route = require('../models/Route');
const Load = require('../models/Load');
const Match = require('../models/Match');
const MatchScorePrediction = require('../models/MatchScorePrediction');
const ProfitabilityPrediction = require('../models/ProfitabilityPrediction');
const RouteFeasibility = require('../models/RouteFeasibility');
const Rating = require('../models/Rating');
const { scoreMatch } = require('../services/matching');

const DEMO_PASSWORD = 'Demo@12345';

const DEMO_USER_SPECS = [
  { email: 'demo.fleetowner@iblms.test', role: 'fleet_owner', name: 'Demo Fleet Owner', companyName: 'Demo Fleet Logistics Pvt Ltd' },
  { email: 'demo.ownerdriver@iblms.test', role: 'owner_driver', name: 'Demo Individual Owner' },
  { email: 'demo.driver@iblms.test', role: 'driver', name: 'Demo Fleet Driver' },
  { email: 'demo.business@iblms.test', role: 'business_poster', name: 'Demo Business Poster', companyName: 'Demo Textiles Pvt Ltd', businessType: 'Manufacturing' },
  { email: 'demo.individual@iblms.test', role: 'individual_poster', name: 'Demo Individual Poster', purpose: 'Household shifting' },
];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}
// Mongoose's timestamps plugin re-sets createdAt/updatedAt on every save,
// so backdating has to bypass it with an explicit updateOne + timestamps:false.
async function backdate(Model, id, createdAt, updatedAt) {
  await Model.updateOne({ _id: id }, { $set: { createdAt, updatedAt: updatedAt || createdAt } }, { timestamps: false });
}

async function ensureUser(spec) {
  let user = await User.findOne({ email: spec.email });
  if (user) return user;
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  user = await User.create({
    role: spec.role,
    status: 'approved',
    name: spec.name,
    companyName: spec.companyName,
    businessType: spec.businessType,
    purpose: spec.purpose,
    email: spec.email,
    phone: '+91 90000 00000',
    passwordHash,
    documents: [],
  });
  console.log(`  [create] ${spec.email} (${spec.role})`);
  return user;
}

async function ensureTruckOwner(user) {
  let row = await TruckOwner.findById(user._id);
  if (!row) row = await TruckOwner.create({ _id: user._id, companyName: user.companyName || '', address: '' });
  return row;
}
async function ensureDriverRow(user, truckOwnerId) {
  let row = await Driver.findById(user._id);
  if (!row) {
    row = await Driver.create({ _id: user._id, truckOwnerId });
  } else if (String(row.truckOwnerId) !== String(truckOwnerId)) {
    row.truckOwnerId = truckOwnerId;
    await row.save();
  }
  return row;
}
async function ensureLoadPoster(user) {
  let row = await LoadPoster.findById(user._id);
  if (!row) {
    row = await LoadPoster.create({
      _id: user._id,
      businessName: user.role === 'business_poster' ? user.companyName : undefined,
      businessType: user.businessType,
      purpose: user.purpose,
    });
  }
  return row;
}

async function ensureTruck(ownerId, spec) {
  let truck = await Truck.findOne({ truckOwnerId: ownerId, vehicleNumber: spec.vehicleNumber });
  if (!truck) {
    truck = await Truck.create({ truckOwnerId: ownerId, ...spec });
    console.log(`  [create] truck ${spec.vehicleNumber} for owner ${ownerId}`);
  }
  return truck;
}

async function ensureRoute(truck, ownerId, spec) {
  let route = await Route.findOne({ truckId: truck._id, source: spec.source, destination: spec.destination, status: { $ne: 'cancelled' } });
  if (!route) {
    route = await Route.create({ truckId: truck._id, truckOwnerId: ownerId, ...spec });
    console.log(`  [create] route ${spec.source} -> ${spec.destination} for truck ${truck.vehicleNumber}`);
  }
  return route;
}

async function ensureLoad(posterId, spec) {
  let load = await Load.findOne({ postedBy: posterId, pickupLocation: spec.pickupLocation, deliveryLocation: spec.deliveryLocation, cargoType: spec.cargoType, expectedPrice: spec.expectedPrice });
  if (!load) {
    load = await Load.create({ postedBy: posterId, ...spec });
    if (spec.createdAtOverride) await backdate(Load, load._id, spec.createdAtOverride);
    console.log(`  [create] load ${spec.pickupLocation} -> ${spec.deliveryLocation} for poster ${posterId}`);
  }
  return load;
}

// Mirrors routes/matches.js's POST /api/requests exactly (same scoreMatch
// call, same 3 prediction tables), just invoked directly instead of over
// HTTP, so the data this produces is indistinguishable from a real booking.
async function ensureMatch(route, truck, load, { requestedBy, requestedByRole, finalStatus, createdAt, updatedAt }) {
  const existing = await Match.findOne({ routeId: route._id, loadId: load._id, status: { $nin: ['rejected', 'cancelled'] } });
  if (existing) return existing;

  const result = scoreMatch({ vehicle: truck, trip: route, load, ownerRatingAvg: null });
  if (!result.eligible) {
    console.warn(`  [skip] ${route.source}->${route.destination} x ${load.pickupLocation}->${load.deliveryLocation} not eligible: ${result.reason}`);
    return null;
  }

  const match = await Match.create({
    routeId: route._id,
    truckId: truck._id,
    loadId: load._id,
    truckOwnerId: route.truckOwnerId,
    loadPosterId: load.postedBy,
    requestedBy,
    requestedByRole,
    status: finalStatus,
  });
  await backdate(Match, match._id, createdAt, updatedAt);

  await Promise.all([
    MatchScorePrediction.create({ matchId: match._id, ruleBasedScore: result.matchScore, factors: result.factors, weights: result.weights }),
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
    RouteFeasibility.create({ matchId: match._id, detourKm: result.detourKm, feasible: true }),
  ]);
  console.log(`  [create] match ${route.source}->${route.destination} x ${load.pickupLocation}->${load.deliveryLocation} (${finalStatus})`);
  return match;
}

async function ensureRating(matchId, ratedBy, ratedUser, ratingValue, comment) {
  const existing = await Rating.findOne({ matchId, ratedBy });
  if (existing) return existing;
  return Rating.create({ matchId, ratedBy, ratedUser, ratingValue, comment });
}

async function recomputeRatingAvg(userId) {
  const ratings = await Rating.find({ ratedUser: userId }).select('ratingValue');
  if (!ratings.length) return;
  const avg = ratings.reduce((sum, r) => sum + r.ratingValue, 0) / ratings.length;
  await User.findByIdAndUpdate(userId, { ratingAvg: Math.round(avg * 10) / 10 });
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('[seed:live-demo] MONGO_URI is not set -- cannot connect.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('[seed:live-demo] Connected to MongoDB.');

  console.log('[seed:live-demo] Ensuring the 5 demo accounts exist...');
  const users = {};
  for (const spec of DEMO_USER_SPECS) {
    // eslint-disable-next-line no-await-in-loop
    users[spec.role === 'owner_driver' ? 'ownerDriver' : spec.role] = await ensureUser(spec);
  }
  const fleetOwner = users.fleet_owner;
  const ownerDriver = users.ownerDriver;
  const driver = users.driver;
  const business = users.business_poster;
  const individual = users.individual_poster;

  console.log('[seed:live-demo] Ensuring subtype rows (TruckOwner/Driver/LoadPoster)...');
  await ensureTruckOwner(fleetOwner);
  await ensureTruckOwner(ownerDriver);
  await ensureDriverRow(ownerDriver, ownerDriver._id);
  await User.updateOne({ _id: driver._id, fleetOwnerId: { $exists: false } }, { $set: { fleetOwnerId: fleetOwner._id } });
  await User.updateOne({ _id: driver._id, fleetOwnerId: null }, { $set: { fleetOwnerId: fleetOwner._id } });
  const driverUser = await User.findById(driver._id);
  await ensureDriverRow(driverUser, fleetOwner._id);
  await ensureLoadPoster(business);
  await ensureLoadPoster(individual);

  console.log('[seed:live-demo] Ensuring trucks...');
  const truckA = await ensureTruck(fleetOwner._id, {
    vehicleNumber: 'TN-09-DF-4521',
    vehicleType: 'container_truck',
    capacityClass: 'heavy',
    bodyType: 'closed_container',
    maxCapacityTonnes: 14,
    fuelType: 'diesel',
    cargoCompatibility: ['general', 'household_goods', 'fragile'],
    driverName: 'Demo Fleet Driver',
    driverPhone: '+91 90000 00000',
  });
  const truckB = await ensureTruck(fleetOwner._id, {
    vehicleNumber: 'TN-07-GH-7788',
    vehicleType: 'open_truck',
    capacityClass: 'medium',
    bodyType: 'open_body',
    maxCapacityTonnes: 9,
    fuelType: 'diesel',
    cargoCompatibility: ['general', 'heavy_machinery'],
  });
  const truckC = await ensureTruck(ownerDriver._id, {
    vehicleNumber: 'TN-37-KL-1190',
    vehicleType: 'mini_truck',
    capacityClass: 'mini',
    bodyType: 'open_body',
    maxCapacityTonnes: 1.5,
    fuelType: 'petrol',
    cargoCompatibility: ['general', 'fragile', 'household_goods'],
  });

  console.log('[seed:live-demo] Linking the demo driver to truck A...');
  if (!truckA.assignedDriverId) {
    truckA.assignedDriverId = driver._id;
    await truckA.save();
  }
  await TruckOwner.findByIdAndUpdate(fleetOwner._id, { fleetSize: await Truck.countDocuments({ truckOwnerId: fleetOwner._id }) });

  console.log('[seed:live-demo] Ensuring routes...');
  const routeA = await ensureRoute(truckA, fleetOwner._id, { source: 'Kolkata', destination: 'Pune', availableFrom: daysAgo(4), status: 'available' });
  const routeB = await ensureRoute(truckB, fleetOwner._id, { source: 'Chennai', destination: 'Bengaluru', availableFrom: daysAgo(1), status: 'available' });
  const routeC = await ensureRoute(truckC, ownerDriver._id, { source: 'Kolkata', destination: 'Pune', availableFrom: daysFromNow(2), status: 'available' });
  const routeA2 = await ensureRoute(truckA, fleetOwner._id, { source: 'Hyderabad', destination: 'Vijayawada', availableFrom: daysAgo(9), status: 'available' });
  // 2nd route for the Individual Owner's truck -- routeC above is a
  // pending request, which never shows the "Track Live Location" button
  // (only Pickup/In Transit do). This one gives that account an in-transit
  // booking too, the same way routeB does for the Fleet Owner.
  const routeD = await ensureRoute(truckC, ownerDriver._id, { source: 'Chennai', destination: 'Madurai', availableFrom: daysAgo(1), status: 'available' });

  console.log('[seed:live-demo] Ensuring loads...');
  const load1 = await ensureLoad(business._id, {
    pickupLocation: 'Kolkata', deliveryLocation: 'Pune', cargoType: 'general', cargoWeightTonnes: 8,
    requiredVehicleType: 'any', pickupDateTime: daysAgo(4), deliveryDeadline: daysAgo(1), expectedPrice: 42000,
    createdAtOverride: daysAgo(4),
  });
  const load2 = await ensureLoad(business._id, {
    pickupLocation: 'Kolkata', deliveryLocation: 'Pune', cargoType: 'household_goods', cargoWeightTonnes: 1.2,
    requiredVehicleType: 'any', pickupDateTime: daysFromNow(2), deliveryDeadline: daysFromNow(6), expectedPrice: 9000,
    createdAtOverride: new Date(),
  });
  const load3 = await ensureLoad(business._id, {
    pickupLocation: 'Chennai', deliveryLocation: 'Bengaluru', cargoType: 'heavy_machinery', cargoWeightTonnes: 7,
    requiredVehicleType: 'any', pickupDateTime: daysAgo(1), deliveryDeadline: daysFromNow(2), expectedPrice: 35000,
    createdAtOverride: daysAgo(1),
  });
  const load4 = await ensureLoad(individual._id, {
    pickupLocation: 'Mumbai', deliveryLocation: 'Delhi', cargoType: 'household_goods', cargoWeightTonnes: 1,
    requiredVehicleType: 'any', pickupDateTime: daysFromNow(3), deliveryDeadline: daysFromNow(7), expectedPrice: 15000,
    createdAtOverride: new Date(),
  });
  const load6 = await ensureLoad(individual._id, {
    pickupLocation: 'Hyderabad', deliveryLocation: 'Vijayawada', cargoType: 'general', cargoWeightTonnes: 2,
    requiredVehicleType: 'any', pickupDateTime: daysAgo(9), deliveryDeadline: daysAgo(6), expectedPrice: 11000,
    createdAtOverride: daysAgo(9),
  });
  const load7 = await ensureLoad(business._id, {
    pickupLocation: 'Chennai', deliveryLocation: 'Madurai', cargoType: 'fragile', cargoWeightTonnes: 1,
    requiredVehicleType: 'any', pickupDateTime: daysAgo(1), deliveryDeadline: daysFromNow(2), expectedPrice: 6000,
    createdAtOverride: daysAgo(1),
  });

  console.log('[seed:live-demo] Ensuring bookings across the lifecycle...');
  const m1 = await ensureMatch(routeA, truckA, load1, { requestedBy: fleetOwner._id, requestedByRole: 'fleet_owner', finalStatus: 'completed', createdAt: daysAgo(4), updatedAt: daysAgo(2) });
  const m2 = await ensureMatch(routeB, truckB, load3, { requestedBy: fleetOwner._id, requestedByRole: 'fleet_owner', finalStatus: 'in_transit', createdAt: daysAgo(1), updatedAt: new Date() });
  const m3 = await ensureMatch(routeC, truckC, load2, { requestedBy: ownerDriver._id, requestedByRole: 'owner_driver', finalStatus: 'requested', createdAt: new Date(), updatedAt: new Date() });
  const m4 = await ensureMatch(routeA2, truckA, load6, { requestedBy: driver._id, requestedByRole: 'driver', finalStatus: 'completed', createdAt: daysAgo(9), updatedAt: daysAgo(7) });
  const m5 = await ensureMatch(routeD, truckC, load7, { requestedBy: ownerDriver._id, requestedByRole: 'owner_driver', finalStatus: 'in_transit', createdAt: daysAgo(1), updatedAt: new Date() });

  if (m1) {
    await Route.findByIdAndUpdate(routeA._id, { status: 'completed' });
    await Load.findByIdAndUpdate(load1._id, { status: 'completed' });
  }
  if (m2) {
    await Route.findByIdAndUpdate(routeB._id, { status: 'matched' });
    await Load.findByIdAndUpdate(load3._id, { status: 'matched' });
  }
  if (m4) {
    await Route.findByIdAndUpdate(routeA2._id, { status: 'completed' });
    await Load.findByIdAndUpdate(load6._id, { status: 'completed' });
  }
  if (m5) {
    await Route.findByIdAndUpdate(routeD._id, { status: 'matched' });
    await Load.findByIdAndUpdate(load7._id, { status: 'matched' });
  }

  console.log('[seed:live-demo] Seeding ratings for the 2 completed bookings...');
  if (m1) {
    await ensureRating(m1._id, fleetOwner._id, business._id, 5, 'Paid on time, clear instructions.');
    await ensureRating(m1._id, business._id, fleetOwner._id, 5, 'Delivered early, truck was in great condition.');
    await recomputeRatingAvg(business._id);
    await recomputeRatingAvg(fleetOwner._id);
  }
  if (m4) {
    await ensureRating(m4._id, driver._id, individual._id, 5, 'Easy pickup, no issues.');
    await ensureRating(m4._id, individual._id, driver._id, 5, 'Careful with the cargo, great communication.');
    await recomputeRatingAvg(individual._id);
    await recomputeRatingAvg(driver._id);
  }

  console.log('\n[seed:live-demo] Done. What each demo login will now see:');
  console.log('  demo.fleetowner@iblms.test   -- 2 trucks; Kolkata->Pune COMPLETED (rated, in History/Payments); Chennai->Bengaluru IN TRANSIT (Current Trip, Simulate).');
  console.log('  demo.ownerdriver@iblms.test  -- 1 truck; Kolkata->Pune REQUESTED (pending); Chennai->Madurai IN TRANSIT (Current Trip, Simulate, Track Live Location); try Demand Forecast for Kolkata->Pune.');
  console.log('  demo.driver@iblms.test       -- assigned to the fleet owner\'s truck A; 1 completed delivery of their own (rated).');
  console.log('  demo.business@iblms.test     -- 3 loads posted (1 completed, 1 matched/in-transit, 1 open) across 2 routes.');
  console.log('  demo.individual@iblms.test   -- 2 loads posted (1 completed/rated, 1 open).');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[seed:live-demo] Failed:', err);
  process.exit(1);
});
