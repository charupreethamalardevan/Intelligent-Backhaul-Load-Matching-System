import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getLocationCoords } from '../lib/locationApi.js';
import { getRoutePath } from '../lib/routeGeometry.js';
import './TripMap.css';

function pinIcon(color, label) {
  return L.divIcon({
    className: 'trip-map-pin',
    html: `<span class="trip-map-pin-dot" style="background:${color}"></span><span class="trip-map-pin-label">${label}</span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// A lightweight, non-live route preview -- no GPS polling, no simulated
// marker, no "Track"/sharing controls, just "here's where this route
// actually goes" feedback the moment both ends of a location pair are
// picked. Deliberately renders nothing (not an error) while either field
// is still empty, or if a chosen city isn't in locationApi's coordinate
// table -- same "say nothing rather than something wrong" rule TripMap.jsx
// follows for its own "trip not found" case.
//
// Used everywhere a source/destination (or pickup/delivery) pair shows up:
// the 3 forms that collect one (FleetDashboard's "Plan a trip" form, its
// Route Insights demand-forecast form, PosterDashboard's "Post a load"
// form), plus, at a smaller `height`, every Trip/Load table row, every
// booking row (before "Track" is even clicked), and every match-result
// card -- none of these showed any map before this round; TripMap.jsx's
// full live/simulated map only ever appears after a booking already
// exists and is being actively tracked.
//
// Compact previews (height < 160) start non-interactive -- no drag, no
// zoom control -- so they don't fight page scroll/click inside a table
// row. Clicking one switches it into a fully interactive map in place
// (drag + zoom), per the user's "if I press any one trip I should be
// able to navigate the map" request. A full-size preview (height >= 160,
// the 3 planning forms) is already interactive on first render, so the
// click-to-activate affordance only shows for the small ones.
export default function RoutePreviewMap({ source, destination, height = 200 }) {
  const { t } = useTranslation();
  const [coords, setCoords] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [interactive, setInteractive] = useState(height >= 160);
  const [route, setRoute] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setCoords(null);
    setNotFound(false);
    setRoute(null);
    if (!source || !destination) return undefined;
    getLocationCoords()
      .then((map) => {
        if (cancelled) return;
        const s = map[String(source).toLowerCase()];
        const d = map[String(destination).toLowerCase()];
        if (s && d) setCoords({ source: s, destination: d });
        else setNotFound(true);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [source, destination]);

  // Once the two cities resolve to coordinates, ask for the real,
  // road-following path between them -- resolves to a straight-line
  // fallback on its own if OSRM can't be reached, so this never needs a
  // separate error state.
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

  if (!source || !destination || notFound) return null;
  if (!coords) {
    return <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '6px 0 0' }}>{t('map.loadingPreview', 'Loading map preview...')}</p>;
  }

  const primary = (typeof window !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()) || '#16A34A';
  const endpoints = [
    [coords.source.lat, coords.source.lng],
    [coords.destination.lat, coords.destination.lng],
  ];
  // While the real road path is still loading, fall back to the straight
  // two-point line so the preview isn't blank for the ~1s round trip.
  const routePoints = route && route.path.length > 1 ? route.path : endpoints;

  return (
    <div
      className="trip-map"
      style={{ marginTop: 4, position: 'relative', cursor: interactive ? 'default' : 'pointer' }}
      onClick={() => {
        if (!interactive) setInteractive(true);
      }}
    >
      {/* key forces a remount when the interactive mode flips, since
          react-leaflet only applies dragging/zoomControl as creation-time
          options on the underlying Leaflet map -- toggling the prop on a
          live instance wouldn't otherwise take effect. */}
      <MapContainer
        key={interactive ? 'interactive' : 'static'}
        bounds={routePoints}
        boundsOptions={{ padding: [32, 32] }}
        scrollWheelZoom={false}
        dragging={interactive}
        zoomControl={interactive}
        tap={interactive}
        style={{ height, width: '100%' }}
      >
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
      </MapContainer>
      {!interactive && (
        <span className="trip-map-tap-hint">{t('map.tapToNavigate', 'Tap to navigate')}</span>
      )}
    </div>
  );
}
