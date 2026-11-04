// One-off migration: converts any existing Route/Load documents whose
// source/destination/pickupLocation/deliveryLocation are still a plain
// city-name STRING (the old schema, before locationSchema.js) into the
// new {label, lat, lng} shape, using the same CITY_COORDS table those
// strings were always resolved against. Safe to re-run -- it only
// touches documents where the field is still a string; documents already
// migrated (an object) are left untouched.
//
// Run once after deploying the Route/Load schema change:
//   node scripts/migrateLocationsToCoords.js
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const { CITY_COORDS } = require('../utils/distance');
const Route = require('../models/Route');
const Load = require('../models/Load');

const LABELS = {
  chennai: 'Chennai', madurai: 'Madurai', coimbatore: 'Coimbatore', bengaluru: 'Bengaluru',
  trichy: 'Trichy', salem: 'Salem', hyderabad: 'Hyderabad', mumbai: 'Mumbai', delhi: 'Delhi',
  kolkata: 'Kolkata', vijayawada: 'Vijayawada', kochi: 'Kochi', pune: 'Pune', vellore: 'Vellore',
  tirupati: 'Tirupati', tirunelveli: 'Tirunelveli',
};

function toLocation(value) {
  if (typeof value !== 'string') return null; // already migrated (or missing)
  const key = value.trim().toLowerCase();
  const coords = CITY_COORDS[key];
  if (!coords) {
    console.warn(`  ! unknown city "${value}" -- leaving as-is, fix manually`);
    return null;
  }
  return { label: LABELS[key] || value, lat: coords[0], lng: coords[1] };
}

async function migrateCollection(Model, fields, name) {
  const docs = await Model.find({}).lean();
  let changed = 0;
  for (const doc of docs) {
    const update = {};
    for (const field of fields) {
      const next = toLocation(doc[field]);
      if (next) update[field] = next;
    }
    if (Object.keys(update).length > 0) {
      await Model.updateOne({ _id: doc._id }, { $set: update }, { strict: false });
      changed += 1;
    }
  }
  console.log(`[${name}] migrated ${changed} / ${docs.length} documents`);
}

async function main() {
  const ok = await connectDB();
  if (!ok) {
    console.error('Could not connect to MongoDB (check MONGO_URI in .env). Aborting.');
    process.exit(1);
  }
  await migrateCollection(Route, ['source', 'destination'], 'routes');
  await migrateCollection(Load, ['pickupLocation', 'deliveryLocation'], 'loads');
  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
