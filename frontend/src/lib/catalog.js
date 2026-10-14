// Shared UI vocabulary for cargo types and vehicle types. Not enforced by
// the backend -- Vehicle.cargoCompatibility and Load.cargoType are
// free-form strings there (the SRS treats cargo type as a SOFT signal in
// match scoring; only vehicleType vs Load.requiredVehicleType is a hard
// constraint, see backend/services/matching.js's checkHardConstraints).
// Kept here so every form offers the same consistent choices instead of
// everyone typing their own free-text spelling, and so the vehicle
// registration form can suggest sensible defaults when a vehicle type is
// picked.
export const CARGO_TYPES = [
  { id: 'general', label: 'General cargo' },
  { id: 'perishable', label: 'Perishable (needs refrigeration)' },
  { id: 'liquid', label: 'Liquid / bulk' },
  { id: 'fragile', label: 'Fragile' },
  { id: 'heavy_machinery', label: 'Heavy machinery' },
  { id: 'household_goods', label: 'Household goods' },
];

export const CARGO_TYPE_LABELS = Object.fromEntries(CARGO_TYPES.map((c) => [c.id, c.label]));

// typicalCapacityTonnes / cargo here are SUGGESTIONS the vehicle form uses
// to auto-fill capacity and pre-check compatible cargo types when a
// vehicle type is picked -- the user can still change either; nothing here
// is sent to the backend as-is or enforced by it.
export const VEHICLE_TYPE_INFO = {
  mini_truck: {
    label: 'Mini truck',
    typicalCapacityTonnes: 1.5,
    cargo: ['general', 'fragile', 'household_goods'],
    hint: 'Small loads, city / local deliveries.',
  },
  open_truck: {
    label: 'Open truck',
    typicalCapacityTonnes: 9,
    cargo: ['general', 'heavy_machinery', 'household_goods'],
    hint: 'General cargo, open bed.',
  },
  container_truck: {
    label: 'Container truck',
    typicalCapacityTonnes: 16,
    cargo: ['general', 'fragile', 'household_goods'],
    hint: 'Boxed / palletized cargo, weather-protected.',
  },
  refrigerated_truck: {
    label: 'Refrigerated truck',
    typicalCapacityTonnes: 10,
    cargo: ['perishable'],
    hint: 'Temperature-controlled -- perishable cargo only.',
  },
  tanker: {
    label: 'Tanker',
    typicalCapacityTonnes: 12,
    cargo: ['liquid'],
    hint: 'Liquid / bulk cargo only.',
  },
  trailer: {
    label: 'Trailer',
    typicalCapacityTonnes: 25,
    cargo: ['heavy_machinery', 'general'],
    hint: 'Heavy machinery, long-haul bulk cargo.',
  },
};
