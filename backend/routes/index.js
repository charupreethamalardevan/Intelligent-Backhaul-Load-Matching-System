const express = require('express');
const mongoose = require('mongoose');

const { CITY_COORDS } = require('../utils/distance');

const router = express.Router();

// Simple health check: confirms the API process is up and reports whether
// it currently has a live MongoDB connection. This is the one endpoint we
// use right now to prove backend + DB can talk to each other -- everything
// else (real routes/models) gets added module by module from here.
router.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState; // 1 = connected
  res.json({
    status: 'ok',
    service: 'iblms-learn-backend',
    db: dbState === 1 ? 'connected' : 'disconnected',
  });
});

// Display labels for utils/distance.js's known-city keys. Any key missing
// here (e.g. a new city added to CITY_COORDS later) still shows up, just
// using its raw id as the label, so this list never silently drops a city.
const LOCATION_LABELS = {
  chennai: 'Chennai',
  madurai: 'Madurai',
  coimbatore: 'Coimbatore',
  bengaluru: 'Bengaluru',
  trichy: 'Trichy',
  salem: 'Salem',
  hyderabad: 'Hyderabad',
  mumbai: 'Mumbai',
  delhi: 'Delhi',
  kolkata: 'Kolkata',
  vijayawada: 'Vijayawada',
  kochi: 'Kochi',
  pune: 'Pune',
  vellore: 'Vellore',
  tirupati: 'Tirupati',
  tirunelveli: 'Tirunelveli',
};

// GET /api/locations -- the canonical known-city list, public (no auth
// needed -- it's just a picklist, same as /vehicles/types-style constants
// would be). Added so every pickup/delivery/source/destination field in the
// UI can be a dropdown instead of free text: the matching/profitability
// engines (services/matching.js, services/profitability.js) can only
// estimate distance between cities that exist in distance.js's CITY_COORDS,
// so a free-text field silently produced "cannot score this pair" for any
// misspelled or unknown city. Built from CITY_COORDS itself (not a separate
// hand-kept list) so it can never drift out of sync with what the matching
// engine actually supports.
//
// lat/lng are included (not just id/label) so the frontend's TripMap can
// place a source/destination pin and draw a route line without keeping a
// second, hand-copied coordinate table in sync on its own -- CITY_COORDS
// stays the single source of truth for every city's position, same as it
// already is for distance.js's haversine estimate.
router.get('/locations', (req, res) => {
  const locations = Object.keys(CITY_COORDS)
    .map((id) => ({ id, label: LOCATION_LABELS[id] || id, lat: CITY_COORDS[id][0], lng: CITY_COORDS[id][1] }))
    .sort((a, b) => a.label.localeCompare(b.label));
  res.json({ locations });
});

module.exports = router;
