/**
 * Creates 5 ready-to-use DEMO LOGINS -- one per role -- and gives them
 * real, completed-looking history (vehicles, trips, posted loads, and
 * booking requests at a realistic spread of lifecycle stages), so you can
 * log in immediately and see a populated dashboard without first signing
 * up and waiting on admin approval yourself.
 *
 * This is different from scripts/seedPastData.js: that script only adds
 * history to accounts YOU already created and had approved. This script
 * additionally creates the 5 accounts themselves, with fixed, known
 * credentials, specifically so you have *something* to log in with right
 * away. It reuses seedPastData.js's own vehicle/trip/load/request
 * generation helpers (including the real scoreMatch() call and the
 * duplicate-request guard) rather than a second copy of that logic, so
 * the data these accounts get is produced exactly the same way as any
 * other seeded history in this project.
 *
 * Safe to re-run: an account with one of the 5 fixed demo emails below is
 * reused if it already exists (never duplicated), and each account's
 * vehicles/loads/requests are only added once (same "skip if they already
 * have some" rule as seedPastData.js).
 *
 * Usage:
 *   cd backend
 *   npm run seed:demo
 *   (or: node scripts/seedDemoAccounts.js)
 *
 * Requires MONGO_URI in backend/.env, same as the server itself.
 *
 * NOTE: this intentionally bypasses the real signup/invite-redemption
 * flow (POST /api/auth/register, POST /api/invites/redeem) and the
 * fleet_owner/owner_driver admin-approval step -- these are inserted
 * directly as already-`approved` accounts and the demo driver is linked
 * to the demo fleet owner directly, since the whole point is to skip
 * straight to "already set up and already has history" for demo/testing
 * purposes. Nothing about the real signup flow is changed by this.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const Trip = require('../models/Trip');
const Load = require('../models/Load');
const LoadRequest = require('../models/LoadRequest');
const { scoreMatch } = require('../services/matching');
const { seedVehiclesAndTrips, seedLoads, seedRequests, backdate, daysAgo } = require('./seedPastData');

const DEMO_PASSWORD = 'Demo@12345';

// One fixed account per real role in this project (backend/utils/roles.js).
// Emails use a .test TLD on purpose -- reserved for documentation/example
// use (RFC 2606), so these can never collide with, or accidentally email,
// a real address.
const DEMO_USERS = [
  {
    email: 'demo.fleetowner@iblms.test',
    role: 'fleet_owner',
    name: 'Demo Fleet Owner',
    companyName: 'Demo Fleet Logistics Pvt Ltd',
    documents: [{ key: 'ownership_doc', filename: 'demo-ownership-doc.pdf', mimeType: 'application/pdf' }],
  },
  {
    email: 'demo.ownerdriver@iblms.test',
    role: 'owner_driver',
    name: 'Demo Individual Owner',
    documents: [{ key: 'license_doc', filename: 'demo-license.pdf', mimeType: 'application/pdf' }],
  },
  {
    email: 'demo.driver@iblms.test',
    role: 'driver',
    name: 'Demo Fleet Driver',
    // Linked to the fleet_owner account above once both exist -- see
    // linkDemoDriver() below. Fleet Drivers upload no document at signup
    // (backend/utils/roles.js), same rule applies here.
  },
  {
    email: 'demo.business@iblms.test',
    role: 'business_poster',
    name: 'Demo Business Poster',
    companyName: 'Demo Textiles Pvt Ltd',
    businessType: 'Manufacturing',
  },
  {
    email: 'demo.individual@iblms.test',
    role: 'individual_poster',
    name: 'Demo Individual Poster',
    purpose: 'Household shifting',
  },
];

async function ensureUser(spec) {
  let user = await User.findOne({ email: spec.email });
  if (user) {
    console.log(`  [skip] ${spec.email} already exists -- reusing it.`);
    return user;
  }

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
    documents: spec.documents || [],
  });
  console.log(`  [create] ${spec.email} (${spec.role}), password: ${DEMO_PASSWORD}`);
  return user;
}

// Links the demo driver to the demo fleet owner (fleetOwnerId) and assigns
// the fleet owner's first vehicle to that driver (Vehicle.assignedDriverId)
// -- mirrors the real invite-code + PATCH /api/vehicles/:id/assign-driver
// flow from Addendum 28, just done directly since there's no real invite
// code to redeem here.
async function linkDemoDriver(driver, fleetOwner, fleetVehicles) {
  if (!driver.fleetOwnerId) {
    await User.updateOne({ _id: driver._id }, { $set: { fleetOwnerId: fleetOwner._id } });
    console.log(`  [link] ${driver.email} linked to ${fleetOwner.email} as their Fleet Driver.`);
  }
  if (fleetVehicles.length === 0) return null;
  const already = await Vehicle.findOne({ ownerId: fleetOwner._id, assignedDriverId: driver._id });
  if (already) return already;
  const target = fleetVehicles[0];
  await Vehicle.updateOne({ _id: target._id }, { $set: { assignedDriverId: driver._id } });
  console.log(`  [link] Vehicle ${target.vehicleNumber} assigned to ${driver.email}.`);
  return target;
}

// Gives the demo Driver their own "completed" history -- separate from
// seedRequests() above, which always records the request as made by the
// vehicle's owner. This is what makes "log in as the demo driver and see
// something I already delivered" literally true, not just true of the
// fleet owner that owns the vehicle.
async function seedDriverCompletedRequest(driver, assignedVehicle, driverTrips, allLoads) {
  if (!assignedVehicle || driverTrips.length === 0 || allLoads.length === 0) return;

  const existing = await LoadRequest.findOne({ requestedBy: driver._id });
  if (existing) {
    console.log(`  [skip] ${driver.email} already has request history.`);
    return;
  }

  for (const trip of driverTrips) {
    for (const load of allLoads) {
      const result = scoreMatch({ vehicle: assignedVehicle, trip, load });
      if (!result.eligible) continue;

      // eslint-disable-next-line no-await-in-loop
      const duplicate = await LoadRequest.findOne({
        tripId: trip._id,
        loadId: load._id,
        status: { $nin: ['rejected', 'cancelled'] },
      });
      if (duplicate) continue;

      const ageDays = 2 + Math.floor(Math.random() * 12);
      const request = await LoadRequest.create({
        tripId: trip._id,
        vehicleId: assignedVehicle._id,
        loadId: load._id,
        vehicleOwnerId: assignedVehicle.ownerId,
        loadPosterId: load.postedBy,
        requestedBy: driver._id,
        requestedByRole: 'driver',
        status: 'completed',
        matchScore: result.matchScore,
        scoreBreakdown: { factors: result.factors, weights: result.weights, detourKm: result.detourKm },
        profitability: result.profitability,
      });
      await backdate(LoadRequest, request._id, daysAgo(ageDays));
      console.log(`  [seed] ${driver.email}: 1 completed delivery request created.`);
      return;
    }
  }
  console.log(`  [skip] ${driver.email}: no eligible trip/load pairing found for a demo request.`);
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('[seed:demo] MONGO_URI is not set in backend/.env -- cannot connect.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('[seed:demo] Connected to MongoDB.');

  console.log('[seed:demo] Creating/finding the 5 demo accounts...');
  const users = {};
  for (const spec of DEMO_USERS) {
    // eslint-disable-next-line no-await-in-loop
    users[spec.role === 'owner_driver' ? 'ownerDriver' : spec.role] = await ensureUser(spec);
  }
  const { fleet_owner: fleetOwner, ownerDriver, driver, business_poster: business, individual_poster: individual } = users;

  console.log('[seed:demo] Seeding vehicles + trips...');
  const { vehicles: fleetVehicles, trips: fleetTrips } = await seedVehiclesAndTrips(fleetOwner);
  const { trips: ownerTrips } = await seedVehiclesAndTrips(ownerDriver);
  let allTrips = [...fleetTrips, ...ownerTrips];
  // On a re-run, everyone already has data so the above comes back empty --
  // fall back to what's actually in the database so request-seeding and
  // the driver's own completed delivery below still have something to work
  // with, instead of silently skipping every time after the first run.
  if (allTrips.length === 0) {
    allTrips = await Trip.find({ ownerId: { $in: [fleetOwner._id, ownerDriver._id] } });
  }

  console.log('[seed:demo] Seeding posted loads...');
  const businessLoads = await seedLoads(business);
  const individualLoads = await seedLoads(individual);
  let allLoads = [...businessLoads, ...individualLoads];
  if (allLoads.length === 0) {
    allLoads = await Load.find({ postedBy: { $in: [business._id, individual._id] } });
  }

  console.log('[seed:demo] Linking the demo driver to the demo fleet...');
  // Need the fleet owner's full current vehicle list, not just the ones
  // created just now -- re-run skips creation but we still need a vehicle
  // to assign the driver to.
  const fleetOwnerVehicles = fleetVehicles.length > 0 ? fleetVehicles : await Vehicle.find({ ownerId: fleetOwner._id });
  const assignedVehicle = await linkDemoDriver(driver, fleetOwner, fleetOwnerVehicles);

  if (allTrips.length > 0 && allLoads.length > 0) {
    console.log('[seed:demo] Seeding booking requests across the lifecycle...');
    await seedRequests(allTrips, allLoads);
  } else {
    console.log('[seed:demo] Skipping lifecycle request-seeding -- everyone already had data from an earlier run.');
  }

  if (assignedVehicle) {
    let driverTrips = allTrips.filter((t) => String(t.vehicleId) === String(assignedVehicle._id));
    if (driverTrips.length === 0) {
      driverTrips = await Trip.find({ vehicleId: assignedVehicle._id });
    }
    console.log("[seed:demo] Seeding the demo driver's own completed delivery...");
    await seedDriverCompletedRequest(driver, assignedVehicle, driverTrips, allLoads);
  }

  console.log('\n[seed:demo] Done. Demo logins (also saved in backend/DEMO_ACCOUNTS.md):');
  console.log(`  Password for all 5: ${DEMO_PASSWORD}`);
  for (const spec of DEMO_USERS) {
    console.log(`  ${spec.role.padEnd(16)} ${spec.email}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[seed:demo] Failed:', err);
  process.exit(1);
});
