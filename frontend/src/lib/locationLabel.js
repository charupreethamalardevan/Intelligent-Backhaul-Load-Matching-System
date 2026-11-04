// Renders a location value as display text regardless of shape -- the new
// {label, lat, lng} point every source/destination/pickup/delivery field
// now stores (AddressInput.jsx), or (for data created before this change,
// or a row the migration script hasn't reached yet) a legacy plain string
// -- so an old demo row shows its city name instead of crashing or
// printing "[object Object]".
export function locationLabel(loc) {
  if (!loc) return '';
  if (typeof loc === 'string') return loc;
  return loc.label || '';
}
