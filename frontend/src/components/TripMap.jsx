import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getLocationCoords } from '../lib/locationApi.js';
import { getRequest, updateRequestLocation } from '../lib/requestApi.js';
import { getRoutePath, positionAtFraction } from '../lib/routeGeometry.js';
import './TripMap.css';

// Only these two statuses are "actively on the road" -- matches the same
// gate the backend enforces in routes/requests.js's PATCH /:id/location,
// and is also when a real liveLocation is worth polling for.
export const ACTIVE_STATUSES = ['pickup', 'in_transit'];
// Wider set of statuses worth showing *some* movement for, even before a
// real GPS point exists -- e.g. so a freshly-confirmed booking's map
// isn't just two static pins with nothing happening.
const SIM_ELIGIBLE_STATUSES = ['confirmed', 'pickup', 'in_transit', 'delivered', 'completed'];
const POLL_MS = 8000;
const SIM_DURATION_MS = 16000;
const SIM_STEP_MS = 200;

// Re-centers the map on a real GPS fix as it comes in, zoomed in close
// (street level) instead of staying at the whole-route zoom the map opens
// at -- at city-to-route zoom, walking a few dozen metres for a "show it
// moving" demo wouldn't even move the dot by a visible pixel. First fix
// snaps the view in; every fix after that pans without resetting zoom, so
// it doesn't fight a reviewer who's manually zoomed in/out to look closer.
function LiveFollow({ lat, lng, zoom = 17 }) {
  const map = useMap();
  const centeredRef = useRef(false);
  useEffect(() => {
    if (!centeredRef.current) {
      map.setView([lat, lng], zoom, { animate: true });
      centeredRef.current = true;
    } else {
      map.panTo([lat, lng], { animate: true });
    }
  }, [lat, lng, map, zoom]);
  return null;
}

function pinIcon(color, label) {
  return L.divIcon({
    className: 'trip-map-pin',
    html: `<span class="trip-map-pin-dot" style="background:${color}"></span><span class="trip-map-pin-label">${label}</span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// Rendered inside TripMapModal.jsx when the user clicks "Start Navigation"
// on a RequestsPanel card (Addendum 32). Draws the trip's real
// source->destination route, resolved from
// OSRM's free routing API to an actual road-following path (routeGeometry.js)
// rather than a straight line between two pins -- falling back to that
// straight line on its own if OSRM can't be reached, so this never breaks
// the map, just makes the line less accurate for a moment. On top of that:
//   - while the booking is pickup/in_transit AND the vehicle side has
//     shared a real GPS point (LoadRequest.liveLocation), polls and shows
//     that as a genuine "Live" marker;
//   - otherwise, for any status worth visualizing movement for, animates a
//     marker travelling along that same road path (not just drifting in a
//     straight line between the two pins) as a clearly-labelled
//     "Simulated preview" -- this is what makes the demo accounts' (and
//     any already-completed booking's) map show real navigation-along-
//     the-route movement, without ever presenting invented data as real
//     telemetry.
//
// `height`/`scrollWheelZoom` let the same component serve two very
// different places: RequestsPanel's compact row embed (small fixed
// height, scroll-wheel zoom off so the page itself still scrolls normally
// with the mouse wheel) and TripMapModal's full "Start Navigation" popup
// (fills the dialog, scroll-wheel zoom on, since there the map -- not the
// page -- should own the wheel).
export default function TripMap({ request, canShareLocation, height = 260, scrollWheelZoom = false, simOnce = false, simDurationMs = SIM_DURATION_MS, autoShare = false }) {
  const { t } = useTranslation();
  const [coords, setCoords] = useState(null);
  const [route, setRoute] = useState(null);
  const [liveLocation, setLiveLocation] = useState(request.liveLocation || null);
  const [simPos, setSimPos] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState(null);
  const [simLogged, setSimLogged] = useState(false);
  const watchIdRef = useRef(null);
  const lastSentRef = useRef(0);
  const simLogRef = useRef(0);
  // Only used when simOnce -- Date.now() the ONE-SHOT animation below
  // started at, so re-renders (the status ticking forward every couple
  // seconds while SimulateModal is running) don't reset it back to the
  // source every time. Cleared whenever this becomes a different booking.
  const simOnceStartRef = useRef(null);
  // Guards the auto-share effect below so it only ever calls
  // startSharing() once per mount, even though its dependencies
  // (status/sharing) change as the booking moves through pickup ->
  // in_transit -- without this it would re-fire watchPosition() on every
  // status tick, stacking up geolocation watches.
  const autoShareStartedRef = useRef(false);

  const trip = request.tripId;
  const status = request.status;
  const hasLive = !!(liveLocation && liveLocation.lat != null && liveLocation.lng != null);

  useEffect(() => {
    simOnceStartRef.current = null;
  }, [request._id]);

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

  // Resolve the real, road-following path between the two cities -- this
  // is what the polyline is drawn from and what the simulated marker
  // below travels along. Resolves to a straight-line fallback on its own
  // if OSRM is unreachable, so there's no separate error branch here.
  useEffect(() => {
    let cancelled = false;
    if (!coords) return undefined;
    getRoutePath(coords.source, coords.destination).then((r) => {
      if (!cancelled) setRoute(r);
    });
    return () => {
      cancelled = true;
    };
  }, [coords]);

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

  // Simulated navigation -- only runs when there's no real position to
  // show. Moves at constant speed along the actual resolved road path
  // (route.distances is cumulative km per path point), not along the
  // straight line between the two pins, so this genuinely looks like the
  // vehicle is following the route rather than drifting through fields.
  useEffect(() => {
    if (!route || hasLive || !SIM_ELIGIBLE_STATUSES.includes(status)) {
      setSimPos(null);
      return undefined;
    }

    const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setSimPos(positionAtFraction(route, simOnce ? 1 : 0.5));
      return undefined;
    }

    // simOnce (SimulateModal's embed): travel source -> destination ONE
    // time over simDurationMs and then hold at the destination, instead
    // of looping forever. The status keeps advancing every couple of
    // seconds while Simulate runs, which would otherwise re-trigger this
    // effect (status is a dependency, so we know when to START) and reset
    // the clock back to 0 on every single step -- simOnceStartRef is what
    // keeps the clock running across those re-triggers instead of
    // restarting it, which is why the marker used to never make it past
    // the source pin.
    if (simOnce) {
      if (simOnceStartRef.current == null) simOnceStartRef.current = Date.now();
      const id = setInterval(() => {
        const elapsed = Date.now() - simOnceStartRef.current;
        const frac = Math.min(1, elapsed / simDurationMs);
        setSimPos(positionAtFraction(route, frac));
        if (frac >= 1) clearInterval(id);
      }, SIM_STEP_MS);
      return () => clearInterval(id);
    }

    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = (Date.now() - start) % simDurationMs;
      const frac = elapsed / simDurationMs;
      setSimPos(positionAtFraction(route, frac));
    }, SIM_STEP_MS);
    return () => clearInterval(id);
  }, [route, hasLive, status, simOnce, simDurationMs]);

  // Report the simulated preview's position too (tagged source:
  // 'simulated'), so the backend sees every position this card produces,
  // not just real GPS ones. Deliberately scoped to exactly the backend's
  // own gate for this endpoint (vehicle side, status pickup/in_transit --
  // see routes/requests.js's PATCH /:id/location) so this never fires a
  // call that would just 403/400. Throttled to POLL_MS, not every
  // animation frame. Crucially, the backend only writes
  // request.liveLocation for a source: 'real_gps' point (the default when
  // source is omitted, as startSharing() below does) -- a 'simulated'
  // point is acknowledged but never written there, so this never turns
  // into a fake "Live" (red) marker for the other party watching the same
  // booking. Only a real GPS reading does that.
  useEffect(() => {
    if (!canShareLocation || hasLive || !ACTIVE_STATUSES.includes(status) || !simPos) {
      return undefined;
    }
    const now = Date.now();
    if (now - simLogRef.current < POLL_MS) return undefined;
    simLogRef.current = now;
    updateRequestLocation(request._id, simPos.lat, simPos.lng, 'simulated')
      .then(() => setSimLogged(true))
      .catch(() => {});
    return undefined;
  }, [simPos, canShareLocation, hasLive, status, request._id]);

  // "Track Live Location" (RequestsPanel's dedicated button, separate
  // from "Start Navigation") opens this same map with autoShare -- start
  // the browser's real GPS watch immediately instead of making the user
  // find and click "Share my location" themselves, so it genuinely works
  // like "find my current location and start as I move" the moment this
  // opens. Still only when eligible (vehicle side, pickup/in_transit) --
  // same rule the manual button and the backend both enforce.
  useEffect(() => {
    if (!autoShare || autoShareStartedRef.current || sharing) return;
    if (!canShareLocation || !ACTIVE_STATUSES.includes(status)) return;
    autoShareStartedRef.current = true;
    startSharing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoShare, canShareLocation, status, sharing]);

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
  const endpoints = [
    [coords.source.lat, coords.source.lng],
    [coords.destination.lat, coords.destination.lng],
  ];
  // While the real road path is still resolving, fall back to the
  // straight two-point line so the map isn't blank for the ~1s round trip.
  const routePoints = route && route.path.length > 1 ? route.path : endpoints;
  const markerPos = hasLive ? liveLocation : simPos;

  return (
    <div className="trip-map">
      <MapContainer bounds={routePoints} boundsOptions={{ padding: [32, 32] }} scrollWheelZoom={scrollWheelZoom} style={{ height, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {route && route.path.length > 1 ? (
          <Polyline positions={routePoints} pathOptions={{ color: primary, weight: 4, opacity: 0.85 }} />
        ) : (
          <Polyline positions={routePoints} pathOptions={{ color: primary, weight: 3, dashArray: '2 10', opacity: 0.85 }} />
        )}
        <Marker position={endpoints[0]} icon={pinIcon(primary, t('map.source'))} />
        <Marker position={endpoints[1]} icon={pinIcon('#6B7280', t('map.destination'))} />
        {markerPos && (
          <Marker
            position={[markerPos.lat, markerPos.lng]}
            icon={pinIcon(hasLive ? '#DC2626' : '#D97706', hasLive ? t('map.live') : t('map.simulatedPreview'))}
          />
        )}
        {hasLive && markerPos && <LiveFollow lat={markerPos.lat} lng={markerPos.lng} />}
      </MapContainer>
      <div className="trip-map-footer">
        <span className={`trip-map-badge${hasLive ? ' trip-map-badge-live' : ''}`}>{hasLive ? t('map.live') : t('map.simulatedPreview')}</span>
        {ACTIVE_STATUSES.includes(status) && !hasLive && <span className="trip-map-hint">{t('map.noLiveLocationYet')}</span>}
        {canShareLocation && simLogged && !hasLive && ACTIVE_STATUSES.includes(status) && (
          <span className="trip-map-hint">{t('map.simulatedLogged', 'Simulated trail is being logged')}</span>
        )}
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
