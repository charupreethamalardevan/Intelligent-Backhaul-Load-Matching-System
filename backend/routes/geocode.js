const express = require('express');

const { requireAuth } = require('../middleware/auth');

// Thin proxy over OpenStreetMap's free Nominatim geocoding API, so the
// frontend's address search / "pick on map" / "use my current location"
// input (AddressInput.jsx) never calls a third-party API directly from
// the browser (keeps the required User-Agent + rate-limit in one place,
// per Nominatim's usage policy: https://operations.osmfoundation.org/policies/nominatim/)
// and so a future swap to a different geocoder only touches this file.
// Same free, keyless OSM ecosystem the app already uses for map tiles
// (RoutePreviewMap.jsx/TripMap.jsx) and routing (routeGeometry.js).
const router = express.Router();
router.use(requireAuth);

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'IBLMS-backhaul-matching/1.0 (college mini-project; contact: gandhimathi.phy@gmail.com)';
const FETCH_TIMEOUT_MS = 6000;

// Nominatim's usage policy caps unauthenticated use at ~1 request/second.
// A simple module-level timestamp queues the next call rather than
// hammering it -- fine for one small backend serving one app's users.
let nextSlotAt = 0;
async function throttledFetch(url) {
  const wait = Math.max(0, nextSlotAt - Date.now());
  nextSlotAt = Math.max(Date.now(), nextSlotAt) + 1000;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    return await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller ? controller.signal : undefined });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// GET /api/geocode/search?q=<free text> -- address/place autocomplete.
// Biased to India (countrycodes=in) since that's this project's scope
// (SRS: "road freight in India"); drop that filter if the project ever
// needs addresses outside India.
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ results: [] });
  try {
    const url = `${NOMINATIM_BASE}/search?format=jsonv2&addressdetails=0&limit=6&countrycodes=in&q=${encodeURIComponent(q)}`;
    const r = await throttledFetch(url);
    if (!r.ok) throw new Error(`Nominatim responded ${r.status}`);
    const data = await r.json();
    const results = (Array.isArray(data) ? data : [])
      .map((d) => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) }))
      // A result with no display_name (rare, but seen from Nominatim on
      // sparse-data points) must never reach the frontend -- AddressInput.jsx
      // hands whatever label it gets straight to onChange, and a blank one
      // used to end up saved on the Route/Load as an empty location label
      // (rendered as "undefined"/blank everywhere downstream).
      .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng) && typeof d.label === 'string' && d.label.trim().length > 0);
    res.json({ results });
  } catch (err) {
    console.error('[geocode/search]', err.message);
    res.status(502).json({ error: 'Address search is temporarily unavailable. Try a quick-pick city or pick a point on the map instead.', results: [] });
  }
});

// GET /api/geocode/reverse?lat=&lng= -- turns a map click or a live GPS
// fix into a human-readable label. Never hard-fails: a reverse-geocode
// miss (rural point, Nominatim briefly down) still returns usable
// coordinates with a plain "lat, lng" label rather than blocking the pick.
router.get('/reverse', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng are required.' });
  }
  const fallbackLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try {
    const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const r = await throttledFetch(url);
    if (!r.ok) throw new Error(`Nominatim responded ${r.status}`);
    const data = await r.json();
    res.json({ label: data && data.display_name ? data.display_name : fallbackLabel, lat, lng });
  } catch (err) {
    console.error('[geocode/reverse]', err.message);
    res.json({ label: fallbackLabel, lat, lng });
  }
});

module.exports = router;
