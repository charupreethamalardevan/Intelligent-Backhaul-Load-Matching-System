/**
 * Seeds realistic PAST activity -- vehicles, trips, loads, and booking
 * requests spread across the last ~30 days -- so the dashboards' Overview
 * charts and stat cards have real history to show instead of being empty.
 *
 * This does NOT invent accounts. It only adds data for approved users
 * ALREADY in your database: for each approved Fleet Owner / Individual
 * Owner it adds vehicles + trips (only if they have none yet), for each
 * approved Business/Individual Poster it adds loads (only if they have
 * none yet), and it then books some of those freshly-seeded trips against
 * those freshly-seeded loads as LoadRequests, running them through the
 * REAL scoreMatch()/estimateProfitability() services (services/matching.js,
 * services/profitability.js) so the match scores and profit estimates are
 * exactly what the app would have produced for a real request -- not
 * fabricated numbers -- at a spread of lifecycle statuses (completed,
 * rejected, cancelled, and a few still mid-flow).
 *
 * Safe to re-run: an owner/poster who already has vehicles/loads is
 * skipped entirely (so re-running never duplicates their data), and
 * request creation reuses the same "no duplicate active request between
 * this trip and this load" rule the real POST /api/requests route uses.
 *
 * Usage:
 *   cd backend
 *   npm run seed
 *   (or: node scripts/seedPastData.js)
 *
 * Requires MONGO_URI in backend/.env, same as the server itself.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const Trip = require('../models/Trip');
const Load = require('../models/Load');
const LoadRequest = require('../models/LoadRequest');
const { scoreMatch } = require('../services/matching');

const KNOWN_CITIES = [
  'chennai', 'madurai', 'coimbatore', 'bengaluru', 'trichy', 'salem',
  'hyderabad', 'mumbai', 'delhi', 'kolkata', 'vijayawada', 'kochi',
  'pune', 'vellore', 'tirupati', 'tirunelveli',
];

// Mirrors frontend/src/lib/catalog.js's VEHICLE_TYPE_INFO -- kept as a
// separate copy here (not imported) since this script runs standalone on
// the backend side and the frontend file isn't reachable from it; both
// describe the same soft, UI-only vocabulary (see Vehicle.js's own comment
// on cargoCompatibility being a soft signal, not a hard constraint).
const VEHICLE_TYPE_INFO = {
  mini_truck: { capacity: 1.5, cargo: ['general', 'fragile', 'household_goods'] },
  open_truck: { capacity: 9, cargo: ['general', 'heavy_machinery', 'household_goods'] },
  container_truck: { capacity: 16, cargo: ['general', 'fragile', 'household_goods'] },
  refrigerated_truck: { capacity: 10, cargo: ['perishable'] },
  tanker: { capacity: 12, cargo: ['liquid'] },
  trailer: { capacity: 25, cargo: ['heavy_machinery', 'general'] },
};
const VEHICLE_TYPES = Object.keys(VEHICLE_TYPE_INFO);
const CARGO_TYPES = ['general', 'perishable', 'liquid', 'fragile', 'heavy_machinery', 'household_goods'];
const VEHICLE_NUMBER_PREFIXES = ['TN-07', 'TN-09', 'TN-37', 'KA-05'];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomBetween(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10;
}
function randomCityPair() {
  const a = pick(KNOWN_CITIES);
  let b = pick(KNOWN_CITIES);
  while (b === a) b = pick(KNOWN_CITIES);
  return [a, b];
}
// Mongoose's timestamps plugin re-sets createdAt/updatedAt on every save;
// to backdate a doc we create it normally, then overwrite its timestamps
// directly with { timestamps: false } so this update doesn't re-stamp
// updatedAt back to "now".
async function backdate(Model, id, date) {
  await Model.updateOne({ _id: id }, { $set: { createdAt: date, updatedAt: date } }, { timestamps: false });
}

async function seedVehiclesAndTrips(owner) {
  const existingCount = await Vehicle.countDocuments({ ownerId: owner._id });
  if (existingCount > 0) {
    console.log(`  [skip] ${owner.email} already has ${existingCount} vehicle(s) -- not adding more.`);
    return { vehicles: [], trips: [] };
  }

  // An Individual Owner can only ever have one vehicle (the app enforces
  // this on POST /api/vehicles); a Fleet Owner gets 2-3.
  const vehicleCount = owner.role === 'owner_driver' ? 1 : 2 + Math.floor(Math.random() * 2);
  const vehicles = [];
  const trips = [];

  for (let i = 0; i < vehicleCount; i++) {
    const type = pick(VEHICLE_TYPES);
    const info = VEHICLE_TYPE_INFO[type];
    const vehicle = await Vehicle.create({
      ownerId: owner._id,
      vehicleNumber: `${pick(VEHICLE_NUMBER_PREFIXES)}-${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}-${1000 + Math.floor(Math.random() * 9000)}`,
      vehicleType: type,
      maxCapacityTonnes: info.capacity,
      fuelType: pick(['diesel', 'diesel', 'diesel', 'cng', 'electric']),
      cargoCompatibility: info.cargo,
      driverName: owner.role === 'owner_driver' ? owner.name : undefined,
      driverPhone: owner.phone,
    });
    const vehicleCreatedAt = daysAgo(20 + Math.floor(Math.random() * 25));
    await backdate(Vehicle, vehicle._id, vehicleCreatedAt);
    vehicles.push(vehicle);

    // 2-4 trips per vehicle, spread across the last ~30 days -- a mix of
    // older (mostly completed) and recent (mostly still available) so
    // both the stat cards and the "last 14 days" chart show real shape.
    const tripCount = 2 + Math.floor(Math.random() * 3);
    for (let t = 0; t < tripCount; t++) {
      const [source, destination] = randomCityPair();
      const ageDays = Math.floor(Math.random() * 30);
      const availableFrom = daysAgo(Math.max(ageDays - 3, 0));
      const status = ageDays > 10 ? pick(['completed', 'completed', 'available']) : pick(['available', 'available', 'matched']);
      const trip = await Trip.create({ vehicleId: vehicle._id, ownerId: owner._id, source, destination, availableFrom, status });
      await backdate(Trip, trip._id, daysAgo(ageDays));
      trips.push(trip);
    }
  }

  console.log(`  [seed] ${owner.email}: ${vehicles.length} vehicle(s), ${trips.length} trip(s) created.`);
  return { vehicles, trips };
}

async function seedLoads(poster) {
  const existingCount = await Load.countDocuments({ postedBy: poster._id });
  if (existingCount > 0) {
    console.log(`  [skip] ${poster.email} already has ${existingCount} load(s) -- not adding more.`);
    return [];
  }

  const loadCount = 3 + Math.floor(Math.random() * 3);
  const loads = [];
  for (let i = 0; i < loadCount; i++) {
    const [pickupLocation, deliveryLocation] = randomCityPair();
    const cargoType = pick(CARGO_TYPES);
    const cargoWeightTonnes = randomBetween(0.5, 8);
    const ageDays = Math.floor(Math.random() * 30);
    const pickupDateTime = daysAgo(ageDays);
    const deliveryDeadline = new Date(pickupDateTime.getTime() + (1 + Math.random() * 3) * 86400000);
    const expectedPrice = Math.round(500 + cargoWeightTonnes * 300 + Math.random() * 4000);
    const status = ageDays > 10 ? pick(['completed', 'completed', 'cancelled']) : pick(['open', 'open', 'matched']);

    const load = await Load.create({
      postedBy: poster._id,
      pickupLocation,
      deliveryLocation,
      cargoType,
      cargoWeightTonnes,
      requiredVehicleType: 'any',
      pickupDateTime,
      deliveryDeadline,
      expectedPrice,
      status,
    });
    await backdate(Load, load._id, daysAgo(ageDays));
    loads.push(load);
  }

  console.log(`  [seed] ${poster.email}: ${loads.length} load(s) created.`);
  return loads;
}

// Weighted so most requests land on a believable terminal state, with a
// few still mid-lifecycle -- a real-looking spread for the "requests by
// status" chart rather than everything bunched in one bucket.
const OUTCOME_POOL = ['completed', 'completed', 'completed', 'rejected', 'cancelled', 'accepted', 'confirmed', 'in_transit'];

async function seedRequests(allTrips, allLoads) {
  const maxRequests = Math.min(allTrips.length, allLoads.length, 15);
  const shuffledLoads = [...allLoads].sort(() => Math.random() - 0.5);
  let loadCursor = 0;
  let created = 0;

  for (const trip of allTrips) {
    if (created >= maxRequests) break;

    const vehicle = await Vehicle.findById(trip.vehicleId);
    if (!vehicle) continue;

    for (let attempt = 0; attempt < allLoads.length; attempt++) {
      const load = shuffledLoads[loadCursor % shuffledLoads.length];
      loadCursor++;

      const result = scoreMatch({ vehicle, trip, load });
      if (!result.eligible) continue;

      // Mirrors the real POST /api/requests route's own duplicate guard.
      // eslint-disable-next-line no-await-in-loop
      const existing = await LoadRequest.findOne({ tripId: trip._id, loadId: load._id, status: { $nin: ['rejected', 'cancelled'] } });
      if (existing) continue;

      const owner = await User.findById(trip.ownerId);
      if (!owner) continue;

      const status = pick(OUTCOME_POOL);
      const ageDays = Math.floor(Math.random() * 21);

      const request = await LoadRequest.create({
        tripId: trip._id,
        vehicleId: vehicle._id,
        loadId: load._id,
        vehicleOwnerId: trip.ownerId,
        loadPosterId: load.postedBy,
        requestedBy: trip.ownerId,
        requestedByRole: owner.role,
        status,
        matchScore: result.matchScore,
        scoreBreakdown: { factors: result.factors, weights: result.weights, detourKm: result.detourKm },
        profitability: result.profitability,
      });
      await backdate(LoadRequest, request._id, daysAgo(ageDays));

      // Keep the linked Trip/Load status roughly consistent with the
      // request's outcome, same as PATCH /api/requests/:id/status does.
      if (status === 'completed') {
        await Trip.updateOne({ _id: trip._id }, { $set: { status: 'completed' } });
        await Load.updateOne({ _id: load._id }, { $set: { status: 'completed' } });
      } else if (['accepted', 'confirmed', 'pickup', 'in_transit', 'delivered'].includes(status)) {
        await Trip.updateOne({ _id: trip._id }, { $set: { status: 'matched' } });
        await Load.updateOne({ _id: load._id }, { $set: { status: 'matched' } });
      } else if (['rejected', 'cancelled'].includes(status)) {
        await Trip.updateOne({ _id: trip._id }, { $set: { status: 'available' } });
        await Load.updateOne({ _id: load._id }, { $set: { status: 'open' } });
      }

      created++;
      break;
    }
  }

  console.log(`  [seed] ${created} booking request(s) created across the lifecycle.`);
}

// Exported so scripts/seedDemoAccounts.js can reuse the exact same
// vehicle/trip/load/request-generation logic (including the real
// scoreMatch() call and the duplicate-request guard) against its own
// fixed demo accounts, instead of a second, drift-prone copy of it.
module.exports = {
  seedVehiclesAndTrips,
  seedLoads,
  seedRequests,
  backdate,
  daysAgo,
  pick,
  randomBetween,
  randomCityPair,
  KNOWN_CITIES,
  VEHICLE_TYPE_INFO,
  VEHICLE_TYPES,
  CARGO_TYPES,
  OUTCOME_POOL,
};

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('[seed] MONGO_URI is not set in backend/.env -- cannot connect.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('[seed] Connected to MongoDB.');

  const fleetOwners = await User.find({ role: { $in: ['fleet_owner', 'owner_driver'] }, status: 'approved' });
  const posters = await User.find({ role: { $in: ['business_poster', 'individual_poster'] }, status: 'approved' });

  if (fleetOwners.length === 0) {
    console.log('[seed] No approved Fleet Owner / Individual Owner accounts found -- nothing to seed on the vehicle side.');
  }
  if (posters.length === 0) {
    console.log('[seed] No approved Business/Individual Poster accounts found -- nothing to seed on the load side.');
  }

  console.log('[seed] Seeding vehicles + trips...');
  let allTrips = [];
  for (const owner of fleetOwners) {
    // eslint-disable-next-line no-await-in-loop
    const { trips } = await seedVehiclesAndTrips(owner);
    allTrips = allTrips.concat(trips);
  }

  console.log('[seed] Seeding loads...');
  let allLoads = [];
  for (const poster of posters) {
    // eslint-disable-next-line no-await-in-loop
    const loads = await seedLoads(poster);
    allLoads = allLoads.concat(loads);
  }

  if (allTrips.length > 0 && allLoads.length > 0) {
    console.log('[seed] Seeding booking requests...');
    await seedRequests(allTrips, allLoads);
  } else {
    console.log('[seed] Skipping booking-request seeding -- need at least one newly-seeded trip and one newly-seeded load (everyone already had data, or one side has no accounts yet).');
  }

  console.log('[seed] Done. Refresh your dashboards to see the new history.');
  await mongoose.disconnect();
}

// Only auto-run when this file is executed directly (`node
// scripts/seedPastData.js` / `npm run seed`) -- not when
// scripts/seedDemoAccounts.js requires it just for the helpers above.
if (require.main === module) {
  main().catch((err) => {
    console.error('[seed] Failed:', err);
    process.exit(1);
  });
}
