import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { searchAddress, reverseGeocode, listLocations } from '../lib/locationApi.js';
import { IconMapPin, IconNavigation, IconSpinner, IconX } from './icons.jsx';
import './AddressInput.css';

const DEBOUNCE_MS = 350;
const DEFAULT_CENTER = [20.5937, 78.9629]; // roughly the centre of India -- only used before any point is picked

function pinIcon(color) {
  return L.divIcon({
    className: 'trip-map-pin',
    html: `<span class="trip-map-pin-dot" style="background:${color}"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// Must live inside the MapContainer tree -- react-leaflet's useMapEvents
// hook only works there. Reports every click up as raw lat/lng; the
// parent reverse-geocodes it into a label.
function ClickToPick({ onPick }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Replaces LocationSelect.jsx's plain known-city dropdown with a real
// address input for every source/destination/pickup/delivery field:
// type-ahead search (OpenStreetMap Nominatim, proxied through
// backend/routes/geocode.js so the browser never calls it directly),
// quick-pick chips for the existing known-city list (handy when
// Nominatim is briefly unreachable, and a nice one-click jump to a major
// hub either way), a "pick a point on the map" toggle, and -- when
// `allowLiveLocation` is set -- a "use my current location" button.
//
// Whatever the user ends up choosing, onChange always receives a full
// { label, lat, lng } object (or null while nothing is resolved yet) --
// never a bare string -- so every consumer (the Trip/Load forms here,
// and ultimately the backend's matching/profitability engine) can keep
// relying on a location always carrying real coordinates, the same
// guarantee the old city dropdown existed to give (see that file's own
// comment for the free-text story this is deliberately not reopening).
export default function AddressInput({
  id,
  value,
  onChange,
  placeholder = 'Search for an address or place',
  required,
  disabled,
  allowLiveLocation = false,
  style,
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(value?.label || '');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [error, setError] = useState(null);
  const [cities, setCities] = useState([]);
  const debounceRef = useRef(null);
  const blurTimerRef = useRef(null);

  // Keep the text box in sync if the parent resets/replaces `value`
  // itself (e.g. the form is cleared after a successful submit).
  useEffect(() => {
    setQuery(value?.label || '');
  }, [value?.label]);

  useEffect(() => {
    listLocations().then(setCities).catch(() => {});
  }, []);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    },
    [],
  );

  function handleType(text) {
    setQuery(text);
    setError(null);
    // Typing again un-selects whatever was picked before -- never let a
    // resolved point silently stay attached to different, unreviewed text.
    if (value) onChange(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const results = await searchAddress(text.trim());
      setSearching(false);
      setSuggestions(results);
      setOpen(true);
    }, DEBOUNCE_MS);
  }

  function pick(loc) {
    setQuery(loc.label);
    setSuggestions([]);
    setOpen(false);
    setError(null);
    onChange(loc);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError(t('location.unsupported', 'Live location is not supported on this device/browser.'));
      return;
    }
    setError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const resolved = await reverseGeocode(lat, lng);
        setLocating(false);
        pick({ label: resolved.label || t('location.myLocation', 'My current location'), lat, lng });
      },
      () => {
        setLocating(false);
        setError(t('location.denied', 'Could not get your location -- check location permission and try again.'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }

  function handleMapClick(lat, lng) {
    // Belt-and-suspenders fallback -- reverseGeocode()/the backend's own
    // /geocode/reverse already guarantee a non-empty label (a plain
    // "lat, lng" string when Nominatim has no address for the point), but
    // this file's own contract promises callers a full {label,lat,lng}
    // object, never one with a blank label, so guard here too rather than
    // trust every caller up the chain to never regress that.
    reverseGeocode(lat, lng).then((resolved) => pick({ label: resolved.label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }));
  }

  function clear() {
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    setError(null);
    onChange(null);
  }

  const needsSelection = required && query.trim().length > 0 && !value;

  return (
    <div className="addr-input-wrap" style={style}>
      <div className="addr-input-anchor">
      <div className="addr-input-row">
        <input
          id={id}
          className="input"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => handleType(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => {
            // Delayed close so a click on a suggestion/chip still
            // registers first -- blur fires before that click's handler.
            blurTimerRef.current = setTimeout(() => setOpen(false), 150);
          }}
        />
        {value && !disabled && (
          <button type="button" className="addr-input-iconbtn" title={t('location.clear', 'Clear')} onClick={clear}>
            <IconX size={16} />
          </button>
        )}
        {allowLiveLocation && !disabled && (
          <button
            type="button"
            className="addr-input-iconbtn"
            title={t('location.useMyLocation', 'Use my current location')}
            onClick={useMyLocation}
            disabled={locating}
          >
            {locating ? <IconSpinner size={16} className="spin" /> : <IconNavigation size={16} />}
          </button>
        )}
        <button
          type="button"
          className={`addr-input-iconbtn${showMap ? ' active' : ''}`}
          title={t('location.pickOnMap', 'Pick a point on the map')}
          onClick={() => setShowMap((s) => !s)}
          disabled={disabled}
        >
          <IconMapPin size={16} />
        </button>
      </div>

      {open && !disabled && (
        <div className="addr-input-suggestions">
          {searching && <div className="addr-input-suggestion-muted">{t('location.searching', 'Searching...')}</div>}
          {!searching && suggestions.length === 0 && (
            <div className="addr-input-suggestion-muted">
              {t('location.noResults', 'No matches -- try a quick-pick city or the map instead.')}
            </div>
          )}
          {!searching &&
            suggestions.map((s, i) => (
              <button key={`${s.lat},${s.lng},${i}`} type="button" className="addr-input-suggestion" onClick={() => pick(s)}>
                {s.label}
              </button>
            ))}
        </div>
      )}
      </div>

      {cities.length > 0 && !disabled && (
        <div className="addr-input-chips">
          {cities.slice(0, 8).map((c) => (
            <button key={c.id} type="button" className="addr-input-chip" onClick={() => pick({ label: c.label, lat: c.lat, lng: c.lng })}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {showMap && (
        <div className="addr-input-map" style={{ height: 220 }}>
          {/* key forces a remount (so center/zoom re-apply) whenever the
              resolved point changes while the map is open -- react-leaflet
              only honors center/zoom as creation-time options. */}
          <MapContainer
            key={value ? `${value.lat.toFixed(3)},${value.lng.toFixed(3)}` : 'none'}
            center={value ? [value.lat, value.lng] : DEFAULT_CENTER}
            zoom={value ? 12 : 5}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickToPick onPick={handleMapClick} />
            {value && <Marker position={[value.lat, value.lng]} icon={pinIcon('#16A34A')} />}
          </MapContainer>
          <span className="addr-input-map-hint">{t('location.tapMapToPick', 'Tap the map to drop a pin')}</span>
        </div>
      )}

      {error && <p className="addr-input-status is-error">{error}</p>}
      {needsSelection && !error && (
        <p className="addr-input-status">{t('location.selectHint', 'Pick a suggestion, a quick city, your location, or a map point.')}</p>
      )}
    </div>
  );
}
