import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listVehicles, createVehicle, deleteVehicle, listFleetDrivers, assignDriver, VEHICLE_TYPES } from '../lib/vehicleApi.js';
import { listTrips, createTrip, deleteTrip } from '../lib/tripApi.js';
import { matchesForTrip } from '../lib/matchingApi.js';
import { createRequest, listRequests, STATUS_LABELS } from '../lib/requestApi.js';
import { loadsNear } from '../lib/loadApi.js';
import { timeAgo, bucketByDay } from '../lib/time.js';
import MatchResults from '../components/MatchResults.jsx';
import ChainComparison from '../components/ChainComparison.jsx';
import RequestsPanel from '../components/RequestsPanel.jsx';
import InviteManager from '../components/InviteManager.jsx';
import DashboardShell from '../components/DashboardShell.jsx';
import StatCard from '../components/StatCard.jsx';
import { MiniLineChart, MiniBarChart } from '../components/MiniCharts.jsx';
import ActivityList from '../components/ActivityList.jsx';
import LocationSelect from '../components/LocationSelect.jsx';
import { CARGO_TYPES, VEHICLE_TYPE_INFO } from '../lib/catalog.js';
import {
  IconGrid,
  IconTruck,
  IconRoute,
  IconBox,
  IconMapPin,
  IconClipboard,
  IconUsers,
  IconClock,
  IconCheckCircle,
} from '../components/icons.jsx';

const ACTIVE_STATUSES = ['requested', 'accepted', 'confirmed', 'pickup', 'in_transit', 'delivered'];

function VehiclesTab({ canManage, isFleetOwner, vehicles, drivers, reload, reloadDrivers }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ vehicleNumber: '', vehicleType: VEHICLE_TYPES[0], maxCapacityTonnes: '', fuelType: 'diesel', cargoCompatibility: [], driverName: '', driverPhone: '' });
  // Whether the user has manually touched capacity/cargo themselves --
  // picking a vehicle type only auto-fills those two fields while they're
  // still at their suggested default, never overwriting a value the user
  // already typed or chose on purpose.
  const [touched, setTouched] = useState({ capacity: false, cargo: false });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  function handleVehicleTypeChange(type) {
    const info = VEHICLE_TYPE_INFO[type];
    setForm((f) => ({
      ...f,
      vehicleType: type,
      maxCapacityTonnes: touched.capacity ? f.maxCapacityTonnes : String(info.typicalCapacityTonnes),
      cargoCompatibility: touched.cargo ? f.cargoCompatibility : info.cargo,
    }));
  }

  function toggleCargo(id) {
    setTouched((tch) => ({ ...tch, cargo: true }));
    setForm((f) => ({
      ...f,
      cargoCompatibility: f.cargoCompatibility.includes(id) ? f.cargoCompatibility.filter((c) => c !== id) : [...f.cargoCompatibility, id],
    }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createVehicle({
        ...form,
        maxCapacityTonnes: Number(form.maxCapacityTonnes),
      });
      setForm({ vehicleNumber: '', vehicleType: VEHICLE_TYPES[0], maxCapacityTonnes: '', fuelType: 'diesel', cargoCompatibility: [], driverName: '', driverPhone: '' });
      setTouched({ capacity: false, cargo: false });
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const [assignError, setAssignError] = useState(null);
  async function handleAssign(vehicleId, driverId) {
    setAssignError(null);
    try {
      await assignDriver(vehicleId, driverId || null);
      reload();
      reloadDrivers();
    } catch (err) {
      setAssignError(err.message);
    }
  }

  const typeInfo = VEHICLE_TYPE_INFO[form.vehicleType];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canManage && (
        <div className="card">
          <h3>{t('forms.vehicle.heading')}</h3>
          <p className="form-help">{t('forms.vehicle.help')}</p>
          <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 10 }}>
            <div className="field">
              <label className="field-label" htmlFor="veh-number">{t('forms.vehicle.number')}</label>
              <input id="veh-number" className="input" placeholder={t('forms.vehicle.numberPlaceholder')} required value={form.vehicleNumber} onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="veh-type">{t('forms.vehicle.type')}</label>
              <select id="veh-type" className="input" value={form.vehicleType} onChange={(e) => handleVehicleTypeChange(e.target.value)}>
                {VEHICLE_TYPES.map((vt) => (
                  <option key={vt} value={vt}>
                    {t(`catalog.vehicleTypes.${vt}.label`, VEHICLE_TYPE_INFO[vt].label)}
                  </option>
                ))}
              </select>
              {typeInfo && <span className="field-hint">{t(`catalog.vehicleTypes.${form.vehicleType}.hint`, typeInfo.hint)}</span>}
            </div>
            <div className="field">
              <label className="field-label" htmlFor="veh-capacity">{t('forms.vehicle.capacity')}</label>
              <input
                id="veh-capacity"
                className="input"
                type="number"
                min="0.1"
                step="0.1"
                placeholder={t('forms.vehicle.capacityPlaceholder')}
                required
                value={form.maxCapacityTonnes}
                onChange={(e) => {
                  setTouched((tch) => ({ ...tch, capacity: true }));
                  setForm({ ...form, maxCapacityTonnes: e.target.value });
                }}
              />
              <span className="field-hint">{t('forms.vehicle.capacityHint')}</span>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="veh-fuel">{t('forms.vehicle.fuelType')}</label>
              <select id="veh-fuel" className="input" value={form.fuelType} onChange={(e) => setForm({ ...form, fuelType: e.target.value })}>
                {['diesel', 'petrol', 'cng', 'electric'].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <span className="field-label">{t('forms.vehicle.cargoCompat')}</span>
              <div className="chip-check-grid">
                {CARGO_TYPES.map((c) => (
                  <label key={c.id} className={`chip-check${form.cargoCompatibility.includes(c.id) ? ' checked' : ''}`}>
                    <input type="checkbox" checked={form.cargoCompatibility.includes(c.id)} onChange={() => toggleCargo(c.id)} />
                    {t(`catalog.cargoTypes.${c.id}`, c.label)}
                  </label>
                ))}
              </div>
              <span className="field-hint">{t('forms.vehicle.cargoCompatHint')}</span>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="veh-driver-name">{t('forms.vehicle.driverName')}</label>
              <input id="veh-driver-name" className="input" placeholder={t('forms.vehicle.driverNamePlaceholder')} value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="veh-driver-phone">{t('forms.vehicle.driverPhone')}</label>
              <input id="veh-driver-phone" className="input" placeholder={t('forms.vehicle.driverPhonePlaceholder')} value={form.driverPhone} onChange={(e) => setForm({ ...form, driverPhone: e.target.value })} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={saving} style={{ gridColumn: 'span 3' }}>
              {saving ? t('forms.vehicle.submitting') : t('forms.vehicle.submit')}
            </button>
          </form>
          {error && <p style={{ color: '#DC2626', fontSize: 13, marginTop: 8 }}>{error}</p>}
        </div>
      )}

      {isFleetOwner && assignError && <p style={{ color: '#DC2626', fontSize: 13 }}>{assignError}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {vehicles.map((v) => (
          <div key={v._id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>
                {v.vehicleNumber} · {t(`catalog.vehicleTypes.${v.vehicleType}.label`, VEHICLE_TYPE_INFO[v.vehicleType]?.label || v.vehicleType.replace('_', ' '))}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {v.maxCapacityTonnes}t capacity · {v.fuelType} · {v.status}
                {v.driverName ? ` · Contact: ${v.driverName}` : ''}
                {v.assignedDriverId ? ` · Assigned driver: ${v.assignedDriverId.name || v.assignedDriverId.email}` : ' · No driver assigned'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {isFleetOwner && (
                <select
                  className="input"
                  style={{ fontSize: 12, padding: '6px 8px' }}
                  value={v.assignedDriverId?._id || ''}
                  onChange={(e) => handleAssign(v._id, e.target.value)}
                >
                  <option value="">{t('forms.vehicle.unassigned')}</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id} disabled={d.assignedVehicle && String(d.assignedVehicle.id) !== String(v._id)}>
                      {d.name || d.email}
                      {d.assignedVehicle && String(d.assignedVehicle.id) !== String(v._id) ? ` (on ${d.assignedVehicle.vehicleNumber})` : ''}
                    </option>
                  ))}
                </select>
              )}
              {canManage && (
                <button className="btn btn-outline" style={{ fontSize: 12 }} onClick={() => deleteVehicle(v._id).then(reload)}>
                  {t('forms.vehicle.remove')}
                </button>
              )}
            </div>
          </div>
        ))}
        {vehicles.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>{t('forms.vehicle.noneYet')}</p>}
      </div>
    </div>
  );
}

function TripsTab({ canManage, vehicles, trips, reload }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ vehicleId: '', source: '', destination: '', availableFrom: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createTrip(form);
      setForm({ vehicleId: '', source: '', destination: '', availableFrom: '' });
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canManage && (
        <div className="card">
          <h3>{t('forms.trip.heading')}</h3>
          <p className="form-help">{t('forms.trip.help')}</p>
          <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 10 }}>
            <div className="field">
              <label className="field-label" htmlFor="trip-vehicle">{t('forms.trip.vehicle')}</label>
              <select id="trip-vehicle" className="input" required value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
                <option value="">{t('forms.trip.selectVehicle')}</option>
                {vehicles.map((v) => (
                  <option key={v._id} value={v._id}>
                    {v.vehicleNumber} ({t(`catalog.vehicleTypes.${v.vehicleType}.label`, VEHICLE_TYPE_INFO[v.vehicleType]?.label || v.vehicleType.replace('_', ' '))}, {v.maxCapacityTonnes}t)
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="trip-source">{t('forms.trip.source')}</label>
              <LocationSelect id="trip-source" value={form.source} onChange={(v) => setForm({ ...form, source: v })} placeholder={t('forms.trip.sourcePlaceholder')} required />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="trip-destination">{t('forms.trip.destination')}</label>
              <LocationSelect id="trip-destination" value={form.destination} onChange={(v) => setForm({ ...form, destination: v })} placeholder={t('forms.trip.destinationPlaceholder')} required />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="trip-available">{t('forms.trip.availableFrom')}</label>
              <input id="trip-available" className="input" type="datetime-local" required value={form.availableFrom} onChange={(e) => setForm({ ...form, availableFrom: e.target.value })} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={saving} style={{ gridColumn: 'span 4' }}>
              {saving ? t('forms.trip.submitting') : t('forms.trip.submit')}
            </button>
          </form>
          {error && <p style={{ color: '#DC2626', fontSize: 13, marginTop: 8 }}>{error}</p>}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {trips.map((t2) => (
          <div key={t2._id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>
                {t2.source} → {t2.destination}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {t2.vehicleId?.vehicleNumber || 'vehicle'} · available from {new Date(t2.availableFrom).toLocaleString()} · {t2.status}
              </div>
            </div>
            {canManage && (
              <button className="btn btn-outline" style={{ fontSize: 12 }} onClick={() => deleteTrip(t2._id).then(reload)}>
                {t('forms.trip.remove')}
              </button>
            )}
          </div>
        ))}
        {trips.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>{t('forms.trip.noneYet')}</p>}
      </div>
    </div>
  );
}

function FindLoadsTab({ trips, user }) {
  const { t } = useTranslation();
  const [tripId, setTripId] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const isDriver = user.role === 'driver';
  // A Fleet Driver sees the whole fleet's trips (scopeOwnerId), but may
  // only request a load for the one vehicle their Fleet Owner assigned
  // to them -- the backend enforces this too (routes/requests.js POST /);
  // this just keeps them from picking a trip they'd be blocked on anyway.
  const available = trips.filter(
    (t3) => t3.status === 'available' && (!isDriver || String(t3.vehicleId?.assignedDriverId?._id || t3.vehicleId?.assignedDriverId) === String(user.id)),
  );

  async function search(id) {
    setTripId(id);
    setResult(null);
    setError(null);
    if (!id) return;
    setLoading(true);
    try {
      const data = await matchesForTrip(id);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <h3>{t('forms.findLoads.heading')}</h3>
        <p className="form-help">{t('forms.findLoads.help')}</p>
        <div className="field">
          <label className="field-label" htmlFor="find-loads-trip">{t('forms.findLoads.tripLabel')}</label>
          <select id="find-loads-trip" className="input" value={tripId} onChange={(e) => search(e.target.value)}>
            <option value="">{t('forms.findLoads.selectTrip')}</option>
            {available.map((t4) => (
              <option key={t4._id} value={t4._id}>
                {t4.source} → {t4.destination} ({t4.vehicleId?.vehicleNumber})
              </option>
            ))}
          </select>
        </div>
        {available.length === 0 && isDriver && (
          <p style={{ fontSize: 12.5, color: '#D97706', marginTop: 8 }}>{t('forms.findLoads.noVehicleAssigned')}</p>
        )}
        {available.length === 0 && !isDriver && <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>{t('forms.findLoads.planTripFirst')}</p>}
      </div>

      {loading && <p style={{ fontSize: 13, color: 'var(--muted)' }}>{t('forms.findLoads.scoring')}</p>}
      {error && <p style={{ color: '#DC2626', fontSize: 13 }}>{error}</p>}
      {result && (
        <>
          <MatchResults
            matches={result.matches}
            mode="trip"
            fixedId={tripId}
            onRequest={(tid, lid) => createRequest(tid, lid).then(() => search(tripId))}
          />
          {!isDriver && <ChainComparison tripId={tripId} />}
        </>
      )}
      {isDriver && result && <p style={{ fontSize: 12, color: 'var(--muted)' }}>{t('forms.findLoads.driverApprovalNote')}</p>}
    </div>
  );
}

function NearbyLoadsTab() {
  const { t } = useTranslation();
  const [location, setLocation] = useState('');
  const [radiusKm, setRadiusKm] = useState(150);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function search(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!location) return;
    setLoading(true);
    try {
      const data = await loadsNear(location, radiusKm);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <h3>{t('forms.nearbyLoads.heading')}</h3>
        <p className="form-help">{t('forms.nearbyLoads.help')}</p>
        <form onSubmit={search} style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label className="field-label" htmlFor="nearby-location">{t('forms.nearbyLoads.nearCity')}</label>
            <LocationSelect id="nearby-location" value={location} onChange={setLocation} placeholder={t('forms.nearbyLoads.selectCity')} required />
          </div>
          <div className="field" style={{ width: 150 }}>
            <label className="field-label" htmlFor="nearby-radius">{t('forms.nearbyLoads.radius')}</label>
            <input id="nearby-radius" className="input" type="number" min="10" step="10" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? t('forms.nearbyLoads.searching') : t('forms.nearbyLoads.search')}
          </button>
        </form>
      </div>

      {error && <p style={{ color: '#DC2626', fontSize: 13 }}>{error}</p>}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {t('forms.nearbyLoads.resultsSummary', { count: result.loads.length, radius: result.radiusKm, place: result.location })}
          </p>
          {result.loads.map(({ load, distanceKm }) => (
            <div key={load._id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {load.pickupLocation} → {load.deliveryLocation}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  {load.cargoType} · {load.cargoWeightTonnes}t · ₹{load.expectedPrice} · pickup {distanceKm}km away
                </div>
              </div>
            </div>
          ))}
          {result.loads.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>{t('forms.nearbyLoads.noneFound')}</p>}
        </div>
      )}
    </div>
  );
}

function DriversSection({ drivers }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <h3>Your drivers</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {drivers.map((d) => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span>
                {d.name || d.email} {d.phone ? <span style={{ color: 'var(--muted)' }}>· {d.phone}</span> : null}
              </span>
              <span style={{ color: d.assignedVehicle ? 'var(--primary)' : 'var(--muted)', fontWeight: 700 }}>
                {d.assignedVehicle ? `On ${d.assignedVehicle.vehicleNumber}` : 'Unassigned'}
              </span>
            </div>
          ))}
          {drivers.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No drivers have signed up with your invite codes yet.</p>}
        </div>
      </div>
      <InviteManager />
    </div>
  );
}

// Both NAV_SECTIONS and SECTION_META take `t` (react-i18next's translate
// function) now instead of hardcoded English, so the sidebar and topbar
// follow whichever language is picked in the LanguageSwitcher (Addendum 32)
// -- same labels, same structure, just resolved through dashboard.nav.*
// and dashboard.section.* in frontend/src/i18n/locales/*.json.
const NAV_SECTIONS = ({ t, isFleetOwner, vehiclesCount, tripsCount, pendingApprovalCount }) => [
  { items: [{ key: 'overview', label: t('dashboard.nav.overview'), icon: IconGrid }] },
  {
    title: 'Fleet',
    items: [
      { key: 'vehicles', label: t('dashboard.nav.vehicles'), icon: IconTruck, badge: vehiclesCount },
      { key: 'trips', label: t('dashboard.nav.trips'), icon: IconRoute, badge: tripsCount },
      ...(isFleetOwner ? [{ key: 'drivers', label: t('dashboard.nav.drivers'), icon: IconUsers }] : []),
    ],
  },
  {
    title: 'Loads',
    items: [
      { key: 'find-loads', label: t('dashboard.nav.findLoads'), icon: IconBox },
      { key: 'nearby-loads', label: t('dashboard.nav.nearbyLoads'), icon: IconMapPin },
    ],
  },
  {
    title: 'Requests',
    items: [{ key: 'requests', label: t('dashboard.nav.myRequests'), icon: IconClipboard, badge: pendingApprovalCount }],
  },
];

const SECTION_META = (t) => ({
  overview: { title: t('dashboard.section.overview.title'), subtitle: t('dashboard.section.overview.subtitleFleet') },
  vehicles: { title: t('dashboard.section.vehicles.title'), subtitle: t('dashboard.section.vehicles.subtitle') },
  trips: { title: t('dashboard.section.trips.title'), subtitle: t('dashboard.section.trips.subtitle') },
  drivers: { title: t('dashboard.section.drivers.title'), subtitle: t('dashboard.section.drivers.subtitle') },
  'find-loads': { title: t('dashboard.section.findLoads.title'), subtitle: t('dashboard.section.findLoads.subtitle') },
  'nearby-loads': { title: t('dashboard.section.nearbyLoads.title'), subtitle: t('dashboard.section.nearbyLoads.subtitle') },
  requests: { title: t('dashboard.section.requests.title'), subtitle: t('dashboard.section.requests.subtitle') },
});

// Internal bucket KEYS for the "requests by status" chart are stable
// English identifiers (never shown to anyone); only the DISPLAY label
// resolved via t('charts.requestStatus.<key>', <English fallback>) is
// locale-dependent -- same fallback pattern as status.* elsewhere in this
// file, so the chart now follows the picked language (Addendum 32's own
// follow-up item, finished in Addendum 35).
const REQUEST_STATUS_BUCKETS = [
  { key: 'pendingApproval', fallback: 'Pending approval' },
  { key: 'active', fallback: 'Active' },
  { key: 'completed', fallback: 'Completed' },
  { key: 'rejectedCancelled', fallback: 'Rejected / cancelled' },
];

export default function FleetDashboard({ user, onLogout }) {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useState('overview');
  const [vehicles, setVehicles] = useState([]);
  const [trips, setTrips] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [requests, setRequests] = useState([]);
  const canManage = user.role === 'fleet_owner' || user.role === 'owner_driver';
  const isFleetOwner = user.role === 'fleet_owner';

  function reloadVehicles() {
    listVehicles().then(setVehicles).catch(() => {});
  }
  function reloadTrips() {
    listTrips().then(setTrips).catch(() => {});
  }
  function reloadDrivers() {
    if (isFleetOwner) listFleetDrivers().then(setDrivers).catch(() => {});
  }
  function reloadRequests() {
    listRequests().then(setRequests).catch(() => {});
  }

  useEffect(() => {
    reloadVehicles();
    reloadTrips();
    reloadDrivers();
    reloadRequests();
  }, []);

  const pendingApprovalCount = useMemo(
    () => (isFleetOwner ? requests.filter((r) => r.status === 'pending_fleet_approval').length : 0),
    [requests, isFleetOwner],
  );

  const tripsChart = useMemo(() => bucketByDay(trips, (tr) => tr.createdAt, 14), [trips]);

  const requestStatusChart = useMemo(() => {
    const counts = { pendingApproval: 0, active: 0, completed: 0, rejectedCancelled: 0 };
    for (const r of requests) {
      if (r.status === 'pending_fleet_approval') counts.pendingApproval += 1;
      else if (ACTIVE_STATUSES.includes(r.status)) counts.active += 1;
      else if (r.status === 'completed') counts.completed += 1;
      else counts.rejectedCancelled += 1;
    }
    return REQUEST_STATUS_BUCKETS.map(({ key, fallback }) => ({
      label: t(`charts.requestStatus.${key}`, fallback),
      value: counts[key],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same
    // t-identity-is-stable reasoning as recentActivity below.
  }, [requests, t, i18n.language]);

  const recentActivity = useMemo(
    () =>
      [...requests]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 6)
        .map((r) => ({
          id: r._id,
          icon: r.status === 'pending_fleet_approval' ? IconClock : r.status === 'rejected' || r.status === 'cancelled' ? IconClock : IconCheckCircle,
          accent: r.status === 'pending_fleet_approval' ? 'amber' : r.status === 'rejected' || r.status === 'cancelled' ? 'red' : 'primary',
          title: r.tripId ? `${r.tripId.source} → ${r.tripId.destination}` : 'Trip removed',
          subtitle: `${r.loadId ? `${r.loadId.pickupLocation} → ${r.loadId.deliveryLocation}` : 'Load removed'} · ${t(`status.${r.status}`, STATUS_LABELS[r.status] || r.status)}`,
          time: timeAgo(r.createdAt),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t's identity
    // doesn't change on language switch, only i18n.language does, so that's
    // the one that needs to be a dep to make this list re-translate live.
    [requests, t, i18n.language],
  );

  const meta = SECTION_META(t)[section];

  return (
    <DashboardShell
      brandMark="IB"
      brandName="IBLMS Fleet"
      navSections={NAV_SECTIONS({ t, isFleetOwner, vehiclesCount: vehicles.length, tripsCount: trips.length, pendingApprovalCount })}
      activeKey={section}
      onNavigate={setSection}
      pageTitle={meta.title}
      pageSubtitle={meta.subtitle}
      userLabel={user.name || user.email}
      userSub={{ fleet_owner: 'Fleet Owner', owner_driver: 'Individual Owner', driver: 'Fleet Driver' }[user.role] || user.role}
      onLogout={onLogout}
    >
      {section === 'overview' && (
        <>
          <div className="wg-overview-grid">
            <StatCard icon={IconTruck} label="Vehicles" value={vehicles.length} accent="primary" />
            <StatCard icon={IconRoute} label="Trips planned" value={trips.length} accent="blue" />
            {isFleetOwner && <StatCard icon={IconUsers} label="Drivers" value={drivers.length} accent="violet" />}
            <StatCard icon={IconClipboard} label="Active requests" value={requests.filter((r) => ACTIVE_STATUSES.includes(r.status)).length} accent="amber" />
          </div>

          <div className="wg-row-2">
            <div className="card">
              <div className="wg-panel-header">
                <h3>Trips planned, last 14 days</h3>
              </div>
              <MiniLineChart data={tripsChart} emptyText="No trips planned yet." />
            </div>
            <div className="card">
              <div className="wg-panel-header">
                <h3>Recent activity</h3>
              </div>
              <ActivityList items={recentActivity} emptyText="No requests yet." />
            </div>
          </div>

          <div className="card">
            <div className="wg-panel-header">
              <h3>Requests by status</h3>
            </div>
            <MiniBarChart data={requestStatusChart} />
          </div>
        </>
      )}

      {section === 'vehicles' && (
        <VehiclesTab canManage={canManage} isFleetOwner={isFleetOwner} vehicles={vehicles} drivers={drivers} reload={reloadVehicles} reloadDrivers={reloadDrivers} />
      )}
      {section === 'trips' && <TripsTab canManage={canManage} vehicles={vehicles} trips={trips} reload={reloadTrips} />}
      {section === 'drivers' && isFleetOwner && <DriversSection drivers={drivers} />}
      {section === 'find-loads' && <FindLoadsTab trips={trips} user={user} />}
      {section === 'nearby-loads' && <NearbyLoadsTab />}
      {section === 'requests' && <RequestsPanel user={user} />}
    </DashboardShell>
  );
}
