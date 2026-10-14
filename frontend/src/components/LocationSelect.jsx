import { useEffect, useState } from 'react';
import { listLocations } from '../lib/locationApi.js';

// A module-level cache -- the known-city list rarely changes and several
// LocationSelects can appear on one page at once (e.g. Plan a Trip's
// source + destination), so only the first one needs to actually fetch it.
let cache = null;

// A plain <select> of the backend's known-city list, used everywhere a
// location used to be free text (source/destination on a trip,
// pickup/delivery on a load, the Nearby Loads search). Free text let
// someone type a city the matching engine doesn't know about, which
// silently came back as "cannot score this pair" -- a dropdown makes that
// impossible and tells the user up front which places are supported.
export default function LocationSelect({ id, value, onChange, placeholder = 'Select a city', required, style, disabled }) {
  const [locations, setLocations] = useState(cache || []);

  useEffect(() => {
    if (cache) return;
    listLocations()
      .then((locs) => {
        cache = locs;
        setLocations(locs);
      })
      .catch(() => {});
  }, []);

  return (
    <select
      id={id}
      className="input"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      disabled={disabled}
      style={style}
    >
      <option value="">{placeholder}</option>
      {locations.map((loc) => (
        <option key={loc.id} value={loc.id}>
          {loc.label}
        </option>
      ))}
    </select>
  );
}
