/**
 * Wipes and rebuilds rich, demo-video-ready data for the 5 fixed demo
 * logins (backend/DEMO_ACCOUNTS.md) -- multiple trucks per owner, ~14
 * bookings spread one-per-day across the last 2 weeks (so the dashboard
 * "trend, last 14 days" line charts have real daily data instead of a
 * sparse handful of spikes), full lifecycle-status variety, cargo-type
 * variety, Tamil-Nadu-corridor-heavy city variety, every payment method
 * (including netbanking), ratings, notifications, and a simulated GPS
 * trail + live location for the trucks currently "on the road" so the
 * map/TripMap views have something to show immediately.
 *
 * This is a WIPE-THEN-RESEED script, unlike seedLiveDemoData.js (which is
 * purely additive/idempotent). It only ever touches data scoped to the 5
 * demo accounts (by truckOwnerId/postedBy/matchId/userId) -- it never
 * touches any other user's data.
 *
 * Usage (point MONGO_URI at the database you want this in, e.g.
 * production Atlas, for the duration of this one command):
 *   cd backend
 *   $env:MONGO_URI="...your Atlas string..."; npm run seed:reset-demo
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
const Payment = require('../models/Payment');
const Rating = require('../models/Rating');
const Notification = require('../models/Notification');
const TruckLocationLog = require('../models/TruckLocationLog');
const { scoreMatch } = require('../services/matching');
const { CITY_COORDS } = require('../utils/distance');

const DEMO_PASSWORD = 'Demo@12345';

function cityLoc(name) {
  const coords = CITY_COORDS[String(name).trim().toLowerCase()];
  if (!coords) throw new Error(`cityLoc: "${name}" is not in CITY_COORDS -- add it there first.`);
  return { label: name, lat: coords[0], lng: coords[1] };
}

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
  return daysAgo(-n);
}
// Mongoose's timestamps plugin re-sets createdAt/updatedAt on every save,
// so backdating (and setting liveLocation without bumping updatedAt) has
// to bypass it with an explicit updateOne + timestamps:false.
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
  const source = cityLoc(spec.source);
  const destination = cityLoc(spec.destination);
  let route = await Route.findOne({ truckId: truck._id, 'source.label': source.label, 'destination.label': destination.label, status: { $ne: 'cancelled' } });
  if (!route) {
    route = await Route.create({ truckId: truck._id, truckOwnerId: ownerId, ...spec, source, destination });
    if (spec.createdAtOverride) await backdate(Route, route._id, spec.createdAtOverride);
    console.log(`  [create] route ${spec.source} -> ${spec.destination} for truck ${truck.vehicleNumber}`);
  }
  return route;
}

async function ensureLoad(posterId, spec) {
  const pickupLocation = cityLoc(spec.pickupLocation);
  const deliveryLocation = cityLoc(spec.deliveryLocation);
  let load = await Load.findOne({ postedBy: posterId, 'pickupLocation.label': pickupLocation.label, 'deliveryLocation.label': deliveryLocation.label, cargoType: spec.cargoType, expectedPrice: spec.expectedPrice });
  if (!load) {
    load = await Load.create({ postedBy: posterId, ...spec, pickupLocation, deliveryLocation });
    if (spec.createdAtOverride) await backdate(Load, load._id, spec.createdAtOverride);
    console.log(`  [create] load ${spec.pickupLocation} -> ${spec.deliveryLocation} for poster ${posterId}`);
  }
  return load;
}

// Mirrors routes/matches.js's POST /api/requests exactly (same scoreMatch
// call, same 3 prediction tables), just invoked directly instead of over
// HTTP, so the data this produces is indistinguishable from a real booking.
async function ensureMatch(route, truck, load, { requestedBy, requestedByRole, finalStatus, createdAt, updatedAt }) {
  const existing = await Match.findOne({ routeId: route._id, loadId: load._id });
  if (existing) return existing;

  const result = scoreMatch({ vehicle: truck, trip: route, load, ownerRatingAvg: null });
  if (!result.eligible) {
    console.warn(`  [skip] ${route.source.label}->${route.destination.label} x ${load.pickupLocation.label}->${load.deliveryLocation.label} not eligible: ${result.reason}`);
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
  console.log(`  [create] match ${route.source.label}->${route.destination.label} x ${load.pickupLocation.label}->${load.deliveryLocation.label} (${finalStatus})`);
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

async function ensurePayment(matchId, { amount, method, transactionRef, paymentTime, createdAt }) {
  let payment = await Payment.findOne({ matchId });
  if (!payment) {
    payment = await Payment.create({ matchId, amount, method, status: 'completed', transactionRef, paymentTime });
    if (createdAt) await backdate(Payment, payment._id, createdAt, paymentTime || createdAt);
  }
  return payment;
}

async function notify(userId, type, title, message, relatedMatchId, createdAt) {
  const note = await Notification.create({ userId, type, title, message, relatedMatchId });
  if (createdAt) await backdate(Notification, note._id, createdAt, createdAt);
  return note;
}

// Lays down a short simulated GPS trail (3 points, 20 min apart, moving
// from source towards destination) and sets the match's liveLocation +
// the truck's currentLocation to the last of those points, so a match
// that's "on the road" (pickup/in_transit) already has a real, moving
// trail and a live map pin the moment the demo opens the page -- no need
// to run the live Simulate flow first just to see something on the map.
async function seedLiveTrail(truck, match, source, destination, progress) {
  const fracs = [progress - 0.1, progress, progress + 0.05].map((f) => Math.min(Math.max(f, 0.05), 0.95));
  const points = fracs.map((f) => ({
    lat: source.lat + (destination.lat - source.lat) * f,
    lng: source.lng + (destination.lng - source.lng) * f,
  }));
  for (let i = 0; i < points.length; i += 1) {
    const loggedAt = new Date(Date.now() - (points.length - i) * 20 * 60 * 1000);
    // eslint-disable-next-line no-await-in-loop
    await TruckLocationLog.create({ truckId: truck._id, matchId: match._id, lat: points[i].lat, lng: points[i].lng, source: 'simulated', loggedAt });
  }
  const last = points[points.length - 1];
  await Match.updateOne(
    { _id: match._id },
    { $set: { liveLocation: { lat: last.lat, lng: last.lng, updatedAt: new Date(), active: true } } },
    { timestamps: false },
  );
  await Truck.updateOne(
    { _id: truck._id },
    { $set: { currentLocation: { lat: last.lat, lng: last.lng, label: `En route: ${source.label} -> ${destination.label}` } } },
  );
}

async function wipeDemoData(userIds) {
  console.log('[reset-demo] Wiping existing demo data for the 5 demo accounts...');
  const trucks = await Truck.find({ truckOwnerId: { $in: userIds } }).select('_id');
  const truckIds = trucks.map((t) => t._id);
  const loads = await Load.find({ postedBy: { $in: userIds } }).select('_id');
  const loadIds = loads.map((l) => l._id);
  const matches = await Match.find({ $or: [{ truckId: { $in: truckIds } }, { loadId: { $in: loadIds } }] }).select('_id');
  const matchIds = matches.map((m) => m._id);

  await Promise.all([
    MatchScorePrediction.deleteMany({ matchId: { $in: matchIds } }),
    ProfitabilityPrediction.deleteMany({ matchId: { $in: matchIds } }),
    RouteFeasibility.deleteMany({ matchId: { $in: matchIds } }),
    Payment.deleteMany({ matchId: { $in: matchIds } }),
    Rating.deleteMany({ $or: [{ matchId: { $in: matchIds } }, { ratedBy: { $in: userIds } }, { ratedUser: { $in: userIds } }] }),
    Notification.deleteMany({ $or: [{ userId: { $in: userIds } }, { relatedMatchId: { $in: matchIds } }] }),
    TruckLocationLog.deleteMany({ truckId: { $in: truckIds } }),
  ]);
  await Match.deleteMany({ _id: { $in: matchIds } });
  await Route.deleteMany({ truckOwnerId: { $in: userIds } });
  await Load.deleteMany({ _id: { $in: loadIds } });
  await Truck.deleteMany({ _id: { $in: truckIds } });
  await User.updateMany({ _id: { $in: userIds } }, { $set: { ratingAvg: null } });
  console.log(`[reset-demo] Wiped ${truckIds.length} trucks, ${loadIds.length} loads, ${matchIds.length} matches and their related records.`);
}

// 14 scenarios, one per day for the last 14 days (today included), spread
// across the 5 trucks and both posters, covering every Match status in
// the real lifecycle, a cargo-type mix, a payment-method mix (every
// method, netbanking included now that Payment.js accepts it), and a
// Tamil-Nadu-corridor-heavy spread of cities (per the project spec) with
// a few longer-haul routes mixed in.
const SCENARIOS = [
  { dayOffset: 13, truckKey: 'A', source: 'Chennai', destination: 'Madurai', posterKey: 'business', requestedByKey: 'fleetOwner', cargoType: 'general', weight: 8, price: 34000, status: 'completed', payment: { method: 'upi' }, rating: { vehicle: 5, poster: 5 } },
  { dayOffset: 12, truckKey: 'D', source: 'Madurai', destination: 'Trichy', posterKey: 'individual', requestedByKey: 'ownerDriver', cargoType: 'household_goods', weight: 1, price: 7000, status: 'completed', payment: { method: 'cash' }, rating: { vehicle: 4, poster: 5 } },
  { dayOffset: 11, truckKey: 'B', source: 'Coimbatore', destination: 'Chennai', posterKey: 'business', requestedByKey: 'fleetOwner', cargoType: 'heavy_machinery', weight: 7, price: 48000, status: 'completed', payment: { method: 'bank_transfer' }, rating: { vehicle: 5, poster: 4 } },
  { dayOffset: 10, truckKey: 'E', source: 'Chennai', destination: 'Tirupati', posterKey: 'individual', requestedByKey: 'ownerDriver', cargoType: 'perishable', weight: 5, price: 26000, status: 'completed', payment: { method: 'card' }, rating: { vehicle: 5, poster: 5 } },
  { dayOffset: 9, truckKey: 'C', source: 'Chennai', destination: 'Kochi', posterKey: 'business', requestedByKey: 'fleetOwner', cargoType: 'perishable', weight: 6, price: 39000, status: 'completed', payment: { method: 'netbanking' }, rating: { vehicle: 4, poster: 4 } },
  { dayOffset: 8, truckKey: 'A', source: 'Trichy', destination: 'Chennai', posterKey: 'individual', requestedByKey: 'driver', cargoType: 'fragile', weight: 1, price: 9000, status: 'completed', payment: { method: 'upi' }, rating: { vehicle: 5, poster: 5 } },
  { dayOffset: 7, truckKey: 'D', source: 'Chennai', destination: 'Vellore', posterKey: 'business', requestedByKey: 'ownerDriver', cargoType: 'general', weight: 1, price: 5500, status: 'rejected' },
  { dayOffset: 6, truckKey: 'B', source: 'Bengaluru', destination: 'Chennai', posterKey: 'business', requestedByKey: 'fleetOwner', cargoType: 'heavy_machinery', weight: 8, price: 46000, status: 'cancelled' },
  { dayOffset: 5, truckKey: 'E', source: 'Kochi', destination: 'Chennai', posterKey: 'individual', requestedByKey: 'ownerDriver', cargoType: 'perishable', weight: 3, price: 21000, status: 'confirmed' },
  { dayOffset: 4, truckKey: 'C', source: 'Chennai', destination: 'Coimbatore', posterKey: 'business', requestedByKey: 'fleetOwner', cargoType: 'perishable', weight: 4, price: 27000, status: 'pickup', trailProgress: 0.1 },
  { dayOffset: 3, truckKey: 'A', source: 'Madurai', destination: 'Chennai', posterKey: 'individual', requestedByKey: 'driver', cargoType: 'household_goods', weight: 2, price: 11000, status: 'in_transit', trailProgress: 0.55 },
  { dayOffset: 2, truckKey: 'D', source: 'Chennai', destination: 'Trichy', posterKey: 'business', requestedByKey: 'ownerDriver', cargoType: 'fragile', weight: 0.8, price: 6500, status: 'accepted' },
  { dayOffset: 1, truckKey: 'B', source: 'Chennai', destination: 'Vellore', posterKey: 'individual', requestedByKey: 'fleetOwner', cargoType: 'general', weight: 3, price: 14000, status: 'requested' },
  { dayOffset: 0, truckKey: 'E', source: 'Tirupati', destination: 'Chennai', posterKey: 'business', requestedByKey: 'ownerDriver', cargoType: 'liquid', weight: 5, price: 30000, status: 'pending_fleet_approval' },
];

const STATUS_TITLES = {
  pending_fleet_approval: 'New booking request awaiting approval',
  requested: 'New booking request',
  accepted: 'Booking request accepted',
  confirmed: 'Booking confirmed',
  pickup: 'Truck is heading to pickup',
  in_transit: 'Shipment is in transit',
  rejected: 'Booking request rejected',
  cancelled: 'Booking cancelled',
};

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('[reset-demo] MONGO_URI is not set -- cannot connect.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('[reset-demo] Connected to MongoDB.');

  console.log('[reset-demo] Ensuring the 5 demo accounts exist...');
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
  const allUserIds = [fleetOwner._id, ownerDriver._id, driver._id, business._id, individual._id];

  await wipeDemoData(allUserIds);

  console.log('[reset-demo] Ensuring subtype rows (TruckOwner/Driver/LoadPoster)...');
  await ensureTruckOwner(fleetOwner);
  await ensureTruckOwner(ownerDriver);
  await ensureDriverRow(ownerDriver, ownerDriver._id);
  await User.updateOne({ _id: driver._id }, { $set: { fleetOwnerId: fleetOwner._id } });
  const driverUser = await User.findById(driver._id);
  await ensureDriverRow(driverUser, fleetOwner._id);
  await ensureLoadPoster(business);
  await ensureLoadPoster(individual);

  console.log('[reset-demo] Ensuring trucks (3 for the fleet owner, 2 for the owner-driver)...');
  const truckA = await ensureTruck(fleetOwner._id, {
    vehicleNumber: 'TN-09-DF-4521', vehicleType: 'container_truck', capacityClass: 'heavy', bodyType: 'closed_container',
    maxCapacityTonnes: 14, fuelType: 'diesel', cargoCompatibility: ['general', 'household_goods', 'fragile'],
    driverName: 'Demo Fleet Driver', driverPhone: '+91 90000 00000',
  });
  const truckB = await ensureTruck(fleetOwner._id, {
    vehicleNumber: 'TN-07-GH-7788', vehicleType: 'open_truck', capacityClass: 'medium', bodyType: 'open_body',
    maxCapacityTonnes: 9, fuelType: 'diesel', cargoCompatibility: ['general', 'heavy_machinery'],
  });
  const truckC = await ensureTruck(fleetOwner._id, {
    vehicleNumber: 'TN-11-RF-3344', vehicleType: 'refrigerated_truck', capacityClass: 'heavy', bodyType: 'reefer',
    maxCapacityTonnes: 10, fuelType: 'diesel', cargoCompatibility: ['perishable', 'general'],
  });
  const truckD = await ensureTruck(ownerDriver._id, {
    vehicleNumber: 'TN-37-KL-1190', vehicleType: 'mini_truck', capacityClass: 'mini', bodyType: 'open_body',
    maxCapacityTonnes: 1.5, fuelType: 'petrol', cargoCompatibility: ['general', 'fragile', 'household_goods'],
  });
  const truckE = await ensureTruck(ownerDriver._id, {
    vehicleNumber: 'TN-21-MN-5567', vehicleType: 'refrigerated_truck', capacityClass: 'medium', bodyType: 'reefer',
    maxCapacityTonnes: 8, fuelType: 'diesel', cargoCompatibility: ['perishable', 'liquid', 'general'],
  });

  if (!truckA.assignedDriverId) {
    truckA.assignedDriverId = driver._id;
    await truckA.save();
  }
  await TruckOwner.findByIdAndUpdate(fleetOwner._id, { fleetSize: await Truck.countDocuments({ truckOwnerId: fleetOwner._id }) });

  const trucks = { A: truckA, B: truckB, C: truckC, D: truckD, E: truckE };
  const owners = { A: fleetOwner, B: fleetOwner, C: fleetOwner, D: ownerDriver, E: ownerDriver };
  const posters = { business, individual };
  const requesters = {
    fleetOwner: { id: fleetOwner._id, role: 'fleet_owner' },
    ownerDriver: { id: ownerDriver._id, role: 'owner_driver' },
    driver: { id: driver._id, role: 'driver' },
  };

  console.log('[reset-demo] Ensuring 14 bookings spread one-per-day across the last 14 days...');
  const createdMatches = [];
  for (const sc of SCENARIOS) {
    const truck = trucks[sc.truckKey];
    const owner = owners[sc.truckKey];
    const poster = posters[sc.posterKey];
    const availableFrom = daysAgo(sc.dayOffset);
    const deliveryDeadline = daysAgo(sc.dayOffset - 3);

    // eslint-disable-next-line no-await-in-loop
    const route = await ensureRoute(truck, owner._id, {
      source: sc.source, destination: sc.destination, availableFrom, status: 'available', createdAtOverride: availableFrom,
    });
    // eslint-disable-next-line no-await-in-loop
    const load = await ensureLoad(poster._id, {
      pickupLocation: sc.source, deliveryLocation: sc.destination, cargoType: sc.cargoType, cargoWeightTonnes: sc.weight,
      requiredVehicleType: 'any', pickupDateTime: availableFrom, deliveryDeadline, expectedPrice: sc.price, createdAtOverride: availableFrom,
    });

    const requester = requesters[sc.requestedByKey];
    const createdAt = availableFrom;
    const updatedAt = sc.status === 'completed' ? daysAgo(Math.max(sc.dayOffset - 2, 0))
      : (sc.status === 'rejected' || sc.status === 'cancelled') ? availableFrom
      : sc.dayOffset === 0 ? new Date()
      : daysAgo(Math.max(sc.dayOffset - 1, 0));

    // eslint-disable-next-line no-await-in-loop
    const match = await ensureMatch(route, truck, load, {
      requestedBy: requester.id, requestedByRole: requester.role, finalStatus: sc.status, createdAt, updatedAt,
    });
    if (!match) continue;
    createdMatches.push(match);

    const vehicleSideUserId = sc.requestedByKey === 'driver' ? driver._id : owner._id;

    if (['completed', 'confirmed', 'pickup', 'in_transit'].includes(sc.status)) {
      // eslint-disable-next-line no-await-in-loop
      await Route.findByIdAndUpdate(route._id, { status: sc.status === 'completed' ? 'completed' : 'matched' });
      // eslint-disable-next-line no-await-in-loop
      await Load.findByIdAndUpdate(load._id, { status: sc.status === 'completed' ? 'completed' : 'matched' });
    }

    if (sc.status === 'completed') {
      // eslint-disable-next-line no-await-in-loop
      await ensurePayment(match._id, {
        amount: sc.price, method: sc.payment.method, transactionRef: `DEMO-${match._id.toString().slice(-8).toUpperCase()}`,
        paymentTime: updatedAt, createdAt: updatedAt,
      });
      // eslint-disable-next-line no-await-in-loop
      await ensureRating(match._id, vehicleSideUserId, poster._id, sc.rating.vehicle, 'Smooth booking, would work with them again.');
      // eslint-disable-next-line no-await-in-loop
      await ensureRating(match._id, poster._id, vehicleSideUserId, sc.rating.poster, 'Delivered on time, good communication throughout.');
      // eslint-disable-next-line no-await-in-loop
      await notify(poster._id, 'rating_received', 'New rating received', `You were rated ${sc.rating.vehicle}/5 for the ${sc.source} -> ${sc.destination} booking.`, match._id, updatedAt);
      // eslint-disable-next-line no-await-in-loop
      await notify(vehicleSideUserId, 'rating_received', 'New rating received', `You were rated ${sc.rating.poster}/5 for the ${sc.source} -> ${sc.destination} booking.`, match._id, updatedAt);
    } else if (STATUS_TITLES[sc.status]) {
      // eslint-disable-next-line no-await-in-loop
      await notify(poster._id, 'match_status_change', STATUS_TITLES[sc.status], `Your ${sc.source} -> ${sc.destination} booking is now "${sc.status.replace(/_/g, ' ')}".`, match._id, updatedAt);
    }

    if (['pickup', 'in_transit'].includes(sc.status)) {
      // eslint-disable-next-line no-await-in-loop
      await seedLiveTrail(truck, match, cityLoc(sc.source), cityLoc(sc.destination), sc.trailProgress || 0.3);
    }
  }

  await recomputeRatingAvg(business._id);
  await recomputeRatingAvg(individual._id);
  await recomputeRatingAvg(fleetOwner._id);
  await recomputeRatingAvg(ownerDriver._id);
  await recomputeRatingAvg(driver._id);

  console.log('[reset-demo] Ensuring a couple of open/unmatched routes & loads for browsing...');
  await ensureRoute(truckC, fleetOwner._id, { source: 'Chennai', destination: 'Tirupati', availableFrom: daysFromNow(3), status: 'available', createdAtOverride: daysFromNow(3) });
  await ensureLoad(individual._id, {
    pickupLocation: 'Chennai', deliveryLocation: 'Bengaluru', cargoType: 'fragile', cargoWeightTonnes: 2,
    requiredVehicleType: 'any', pickupDateTime: daysFromNow(2), deliveryDeadline: daysFromNow(6), expectedPrice: 8000, createdAtOverride: new Date(),
  });
  await ensureLoad(business._id, {
    pickupLocation: 'Madurai', deliveryLocation: 'Coimbatore', cargoType: 'general', cargoWeightTonnes: 5,
    requiredVehicleType: 'any', pickupDateTime: daysFromNow(4), deliveryDeadline: daysFromNow(8), expectedPrice: 20000, createdAtOverride: new Date(),
  });

  console.log('\n[reset-demo] Done. What each demo login will now see:');
  console.log('  demo.fleetowner@iblms.test   -- 3 trucks; 6 of the 14 bookings (completed/cancelled/confirmed/pickup/requested) across the last 2 weeks; earnings + completed-bookings trend charts full of daily data.');
  console.log('  demo.ownerdriver@iblms.test  -- 2 trucks; the other bookings (completed x2/rejected/confirmed/accepted/pending); one truck live "in transit" look-alike via Pickup.');
  console.log('  demo.driver@iblms.test       -- assigned to truck A; 1 completed delivery (rated) + 1 IN TRANSIT delivery right now (Current Trip, Simulate, live trail already seeded).');
  console.log('  demo.business@iblms.test     -- 8 loads posted across the lifecycle, all 5 payment methods seen in History, 1 open load to browse trucks against.');
  console.log('  demo.individual@iblms.test   -- 6 loads posted, ratings on completed ones, 1 open load to browse trucks against.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[reset-demo] Failed:', err);
  process.exit(1);
});
