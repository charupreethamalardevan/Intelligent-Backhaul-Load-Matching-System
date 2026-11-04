const Match = require('../models/Match');
const Load = require('../models/Load');

// Statuses where the truck is genuinely free again -- everything else
// ('recommended' is never actually written by anything, see Match.js,
// but is included for safety) means the truck is still committed to that
// load's pickup->delivery window.
const FREE_STATUSES = ['rejected', 'cancelled', 'completed'];

function windowsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Single-truck check used at booking time (routes/matches.js): is there
// an existing active Match on this truck whose load's
// [pickupDateTime, deliveryDeadline] window overlaps the one being
// requested? Returns the conflicting Load, or null if the truck is free.
// excludeLoadId lets a caller re-check the same load (e.g. re-requesting
// after a rejection) without the load conflicting with itself.
async function findOverlappingLoad(truckId, { pickupDateTime, deliveryDeadline, excludeLoadId }) {
  const activeMatches = await Match.find({
    truckId,
    ...(excludeLoadId ? { loadId: { $ne: excludeLoadId } } : {}),
    status: { $nin: FREE_STATUSES },
  }).select('loadId');
  if (!activeMatches.length) return null;
  return Load.findOne({
    _id: { $in: activeMatches.map((m) => m.loadId) },
    pickupDateTime: { $lt: deliveryDeadline },
    deliveryDeadline: { $gt: pickupDateTime },
  });
}

// Batch version for ranking/recommendation lists with many candidate
// trucks at once (routes/matching.js): one query covers every truck's
// active matches instead of one query per candidate. Returns
// truckId(string) -> [{start,end}] of every window that truck is already
// committed to.
async function getBusyWindowsByTruck(truckIds) {
  const map = new Map();
  if (!truckIds.length) return map;
  const activeMatches = await Match.find({
    truckId: { $in: truckIds },
    status: { $nin: FREE_STATUSES },
  }).select('truckId loadId');
  if (!activeMatches.length) return map;
  const loadIds = [...new Set(activeMatches.map((m) => String(m.loadId)))];
  const loads = await Load.find({ _id: { $in: loadIds } }).select('pickupDateTime deliveryDeadline');
  const loadById = new Map(loads.map((l) => [String(l._id), l]));
  for (const m of activeMatches) {
    const load = loadById.get(String(m.loadId));
    if (!load) continue;
    const key = String(m.truckId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ start: load.pickupDateTime, end: load.deliveryDeadline });
  }
  return map;
}

module.exports = { findOverlappingLoad, getBusyWindowsByTruck, windowsOverlap };
