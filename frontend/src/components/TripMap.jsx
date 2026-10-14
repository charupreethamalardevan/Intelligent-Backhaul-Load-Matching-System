import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getLocationCoords } from '../lib/locationApi.js';
import { getRequest, updateRequestLocation } from '../lib/requestApi.js';
import './TripMap.css';

// Only these two statuses are "actively on the road" -- matches the same
// gate the backend enforces in routes/requests.js's PATCH /:id/location,
// and is also when a real liveLocation is worth polling for.
const ACTIVE_STATUSES = ['pickup', 'in_transit'];
// Wider set of statuses worth showing *some* movement for, even before a
// real GPS point exists -- e.g. so a freshly-confirmed booking's map
// isn't just two static pins with nothing happening.
const SIM_ELIGIBLE_STATUSES = ['confirmed', 'pickup', 'in_transit', 'delivered', 'completed'];
const POLL_MS = 8000;
const SIM_DURATION_MS = 16000;
const SIM_STEP_MS = 200;

function lerp(a, b, frac) {
  return a + (b - a) * frac;
}

function pinIcon(color, label) {
  return L.divIcon({
    className: 'trip-map-pin',
    html: `<span class="trip-map-pin-dot" style="background:${color}"></span><span class="trip-map-pin-label">${label}</span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// Embedded in a RequestsPanel card (Addendum 32) when the user clicks
// "Track". Always draws the trip's real source->destination route (same
// straight-line estimate utils/distance.js already uses -- no routing API,
// no API key, consistent with the rest of this project). On top of that:
//   - while the booking is pickup/in_transit AND the vehicle side has
//     shared a real GPS point (LoadRequest.liveLocation), polls and shows
//     that as a genuine "Live" marker;
//   - otherwise, for any status worth visualizing movement for, animates a
//     marker drifting source->destination as a clearly-labelled
//     "Simulated preview" -- this is what makes the demo accounts' (and
//     any already-completed booking's) map show something moving at all,
//     without ever presenting invented data as real telemetry.
export default function TripMap({ request, canShareLocation }) {
  const { t } = useTranslation();
  const [coords, setCoords] = useState(null);
  const [liveLocation, setLiveLocation] = useState(request.liveLocation || null);
  const [simPos, setSimPos] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState(null);
  const watchIdRef = useRef(null);
  const lastSentRef = useRef(0);

  const trip = request.tripId;
  const status = request.status;
  const hasLive = !!(liveLocation && liveLocation.lat != null && liveLocation.lng != null);

  useEffect(() => {
    let cancelled = false;
    if (!trip) return undefined;
    getLocationCoords()
      .then((map) => {
        if (cancelled) return;
        const s = map[String(trip.source || '').toLowerCase()];
        const d = map[String(trip.destination || '').toLowerCase()];
        if (s && d) setCoords({ source: s, destination: d });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [trip]);

  // Poll for a real live position while this booking is actively moving.
  useEffect(() => {
    if (!ACTIVE_STATUSES.includes(status)) return undefined;
    let cancelled = false;
    const poll = () => {
      getRequest(request._id)
        .then((r) => {
          if (!cancelled) setLiveLocation(r.liveLocation || null);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [request._id, status]);

  // Simulated drift -- only runs when there's no real position to show.
  useEffect(() => {
    if (!coords || hasLive || !SIM_ELIGIBLE_STATUSES.includes(status)) {
      setSimPos(null);
      return undefined;
    }

    const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setSimPos({ lat: lerp(coords.source.lat, coords.destination.lat, 0.5), lng: lerp(coords.source.lng, coords.destination.lng, 0.5) });
      return undefined;
    }

    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = (Date.now() - start) % SIM_DURATION_MS;
      const frac = elapsed / SIM_DURATION_MS;
      setSimPos({
        lat: lerp(coords.source.lat, coords.destination.lat, frac),
        lng: lerp(coords.source.lng, coords.destination.lng, frac),
      });
    }, SIM_STEP_MS);
    return () => clearInterval(id);
  }, [coords, hasLive, status]);

  // Clean up any live geolocation watch on unmount (e.g. the card gets
  // collapsed again) so a background tab doesn't keep reporting position.
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation?.clearWatch(watchIdRef.current);
    };
  }, []);

  function startSharing() {
    if (!navigator.geolocation) {
      setShareError(t('map.locationUnsupported'));
      return;
    }
    setShareError(null);
    lastSentRef.current = 0;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSentRef.current < POLL_MS) return;
        lastSentRef.current = now;
        updateRequestLocation(request._id, pos.coords.latitude, pos.coords.longitude)
          .then(setLiveLocation)
          .catch((err) => setShareError(err.message));
      },
      () => setShareError(t('map.locationDenied')),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    watchIdRef.current = id;
    setSharing(true);
  }

  function stopSharing() {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    setSharing(false);
  }

  if (!trip || !coords) {
    return <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 10 }}>{t('map.unavailable')}</p>;
  }

  const primary = (typeof window !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()) || '#16A34A';
  const bounds = [
    [coords.source.lat, coords.source.lng],
    [coords.destination.lat, coords.destination.lng],
  ];
  const markerPos = hasLive ? liveLocation : simPos;

  return (
    <div className="trip-map">
      <MapContainer bounds={bounds} boundsOptions={{ padding: [32, 32] }} scrollWheelZoom={false} style={{ height: 260, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={bounds} pathOptions={{ color: primary, weight: 3, dashArray: '2 10', opacity: 0.85 }} />
        <Marker position={bounds[0]} icon={pinIcon(primary, t('map.source'))} />
        <Marker position={bounds[1]} icon={pinIcon('#6B7280', t('map.destination'))} />
        {markerPos && (
          <Marker
            position={[markerPos.lat, markerPos.lng]}
            icon={pinIcon(hasLive ? '#DC2626' : '#D97706', hasLive ? t('map.live') : t('map.simulatedPreview'))}
          />
        )}
      </MapContainer>
      <div className="trip-map-footer">
        <span className={`trip-map-badge${hasLive ? ' trip-map-badge-live' : ''}`}>{hasLive ? t('map.live') : t('map.simulatedPreview')}</span>
        {ACTIVE_STATUSES.includes(status) && !hasLive && <span className="trip-map-hint">{t('map.noLiveLocationYet')}</span>}
        {canShareLocation && ACTIVE_STATUSES.includes(status) && (
          <button type="button" className="btn btn-outline" style={{ fontSize: 11.5, padding: '5px 10px' }} onClick={sharing ? stopSharing : startSharing}>
            {sharing ? t('map.stopSharing') : t('map.shareLocation')}
          </button>
        )}
      </div>
      {shareError && <p style={{ color: '#DC2626', fontSize: 11.5, marginTop: 4 }}>{shareError}</p>}
    </div>
  );
}
