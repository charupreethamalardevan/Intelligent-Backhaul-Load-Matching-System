// One-off data repair: backfills the `label` on any Route/Load location
// point that already has real lat/lng but an empty/missing label --
// these render as blank text everywhere (Payments, Overview, My Requests,
// Track Load) instead of the usual "undefined" because locationLabel.js
// guards against undefined but not an empty string.
//
// Root cause (fixed going forward in AddressInput.jsx/geocode.js, see
// those files' own comments): a "pick a point on the map" click, or an
// address-search result, could in rare cases resolve to a point with no
// usable Nominatim label and nothing filled the gap. Existing documents
// created before that fix still carry the blank label, so this backfills
// them the same way the live /api/geocode/reverse endpoint would, using
// each point's own stored lat/lng.
//
// Safe to re-run -- only touches documents where the field's label is
// still falsy; already-good labels are left untouched.
//
// Run once after deploying this fix:
//   node scripts/fixBlankLocationLabels.js
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const Route = require('../models/Route');
const Load = require('../models/Load');

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'IBLMS-backhaul-matching/1.0 (college mini-project; contact: gandhimathi.phy@gmail.com)';

let nextSlotAt = 0;
async function throttledFetch(url) {
  const wait = Math.max(0, nextSlotAt - Date.now());
  nextSlotAt = Math.max(Date.now(), nextSlotAt) + 1100;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return fetch(url, { headers: { 'User-Agent': USER_AGENT } });
}

async function reverseLabel(lat, lng) {
  const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try {
    const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const r = await throttledFetch(url);
    if (!r.ok) throw new Error(`Nominatim responded ${r.status}`);
    const data = await r.json();
    return data && data.display_name ? data.display_name : fallback;
  } catch (err) {
    console.warn(`  ! reverse geocode failed for ${lat},${lng} (${err.message}) -- using coordinates as the label`);
    return fallback;
  }
}

function isBlank(point) {
  return point && typeof point === 'object' && Number.isFinite(point.lat) && Number.isFinite(point.lng) && (!point.label || !String(point.label).trim());
}

async function fixCollection(Model, fields, name) {
  const docs = await Model.find({}).lean();
  let changed = 0;
  for (const doc of docs) {
    const update = {};
    for (const field of fields) {
      const point = doc[field];
      if (isBlank(point)) {
        const label = await reverseLabel(point.lat, point.lng);
        update[field] = { ...point, label };
        console.log(`  [fix] ${name} ${doc._id}.${field} -> "${label}"`);
      }
    }
    if (Object.keys(update).length > 0) {
      await Model.updateOne({ _id: doc._id }, { $set: update }, { strict: false });
      changed += 1;
    }
  }
  console.log(`[${name}] fixed ${changed} / ${docs.length} documents`);
}

async function main() {
  const ok = await connectDB();
  if (!ok) {
    console.error('Could not connect to MongoDB (check MONGO_URI in .env). Aborting.');
    process.exit(1);
  }
  await fixCollection(Route, ['source', 'destination'], 'routes');
  await fixCollection(Load, ['pickupLocation', 'deliveryLocation'], 'loads');
  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
