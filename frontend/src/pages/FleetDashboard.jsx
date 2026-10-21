import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listVehicles, createVehicle, updateVehicle, deleteVehicle, listFleetDrivers, assignDriver, VEHICLE_TYPES } from '../lib/vehicleApi.js';
import { listTrips, createTrip, deleteTrip } from '../lib/tripApi.js';
import { matchesForTrip } from '../lib/matchingApi.js';
import { createRequest, listRequests, updateRequestStatus, STATUS_LABELS } from '../lib/requestApi.js';
import { loadsNear } from '../lib/loadApi.js';
import { demandForecast, emptyRunRisk, warmMl } from '../lib/insightsApi.js';
import { timeAgo } from '../lib/time.js';
import MatchResults from '../components/MatchResults.jsx';
import ChainComparison from '../components/ChainComparison.jsx';
import RequestsPanel from '../components/RequestsPanel.jsx';
import PaymentsPanel from '../components/PaymentsPanel.jsx';
import InviteManager from '../components/InviteManager.jsx';
import DashboardShell from '../components/DashboardShell.jsx';
import ActivityList from '../components/ActivityList.jsx';
import LocationSelect from '../components/LocationSelect.jsx';
import RoutePreviewMap from '../components/RoutePreviewMap.jsx';
import DataTable from '../components/DataTable.jsx';
import SidePanel from '../components/SidePanel.jsx';
import AttentionPanel from '../components/AttentionPanel.jsx';
import PulseRow from '../components/PulseRow.jsx';
import TripsInMotionList from '../components/TripsInMotionList.jsx';
import RequestPipeline from '../components/RequestPipeline.jsx';
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
  IconSearch,
  IconTrendUp,
  IconAlert,
  IconNavigation,
  IconHistory,
  IconWallet,
} from '../components/icons.jsx';
import '../components/dataViews.css';

const ACTIVE_STATUSES = ['requested', 'accepted', 'confirmed', 'pickup', 'in_transit', 'delivered'];

// A trip is "on the move" once it has a vehicle with a matched trip --
// Trip.status itself is only ever available/matched/completed/cancelled
// (see backend/models/Trip.js); the finer pickup/in_transit/etc. lifecycle
// belongs to its LoadRequest, not the trip. tripDisplayStatus() below joins
// the two so the Overview can show the real, more specific status when one
// exists, instead of inventing trip-level states that don't exist in the
// data model.
function tripDisplayStatus(trip, requestsForTrip, t) {
  const liveRequest = requestsForTrip.find((r) => !['rejected', 'cancelled'].includes(r.status));
  if (liveRequest) {
    const label = t(`status.${liveRequest.status}`, STATUS_LABELS[liveRequest.status] || liveRequest.status);
    const tone = liveRequest.status === 'pending_fleet_approval' ? 'pending' : liveRequest.status === 'completed' ? 'done' : 'active';
    return { label, tone };
  }
  if (trip.status === 'available') return { label: t('dashboard.fleet.tripOpen', 'Open'), tone: 'open' };
  if (trip.status === 'cancelled') return { label: t('status.cancelled', STATUS_LABELS.cancelled), tone: 'rejected' };
  if (trip.status === 'completed') return { label: t('status.completed', STATUS_LABELS.completed), tone: 'done' };
  return { label: trip.status, tone: 'open' };
}

function VehiclesTab({ canManage, isFleetOwner, vehicles, drivers, trips, reload, reloadDrivers }) {
  const { t } = useTranslation();
  const EMPTY_FORM = { vehicleNumber: '', vehicleType: VEHICLE_TYPES[0], maxCapacityTonnes: '', fuelType: 'diesel', cargoCompatibility: [], driverName: '', driverPhone: '' };
  const [form, setForm] = useState(EMPTY_FORM);
  // Whether the user has manually touched capacity/cargo themselves --
  // picking a vehicle type only auto-fills those two fields while they're
  // still at their suggested default, never overwriting a value the user
  // already typed or chose on purpose.
  const [touched, setTouched] = useState({ capacity: false, cargo: false });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [search, setSearch] = useState('');
  // null = the panel is creating a new vehicle; a vehicle's _id = the
  // panel is editing that vehicle instead (same form/panel, reused --
  // updateVehicle() already existed in lib/vehicleApi.js but had no UI
  // caller until now).
  const [editingId, setEditingId] = useState(null);

  // An Individual Owner (owner_driver) drives exactly one truck -- also
  // enforced server-side in backend/routes/vehicles.js's POST handler, so
  // this is a UI convenience, not the real guard against a direct API call.
  const isOwnerDriver = canManage && !isFleetOwner;
  const vehicleCapReached = isOwnerDriver && vehicles.length >= 1;

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setTouched({ capacity: false, cargo: false });
    setError(null);
    setPanelOpen(true);
  }

  function startEdit(vehicle) {
    setEditingId(vehicle._id);
    setForm({
      vehicleNumber: vehicle.vehicleNumber,
      vehicleType: vehicle.vehicleType,
      maxCapacityTonnes: String(vehicle.maxCapacityTonnes),
      fuelType: vehicle.fuelType || 'diesel',
      cargoCompatibility: vehicle.cargoCompatibility || [],
      driverName: vehicle.driverName || '',
      driverPhone: vehicle.driverPhone || '',
    });
    // Editing an existing vehicle's own saved values shouldn't be
    // silently overwritten by the vehicle-type auto-fill behavior above.
    setTouched({ capacity: true, cargo: true });
    setError(null);
    setPanelOpen(true);
  }

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

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = { ...form, maxCapacityTonnes: Number(form.maxCapacityTonnes) };
      if (editingId) {
        await updateVehicle(editingId, payload);
      } else {
        await createVehicle(payload);
      }
      setForm(EMPTY_FORM);
      setTouched({ capacity: false, cargo: false });
      setEditingId(null);
      reload();
      setPanelOpen(false);
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

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter((v) => {
      const typeLabel = t(`catalog.vehicleTypes.${v.vehicleType}.label`, VEHICLE_TYPE_INFO[v.vehicleType]?.label || v.vehicleType);
      return [v.vehicleNumber, typeLabel, v.driverName, v.assignedDriverId?.name, v.assignedDriverId?.email].some((val) => val && String(val).toLowerCase().includes(q));
    });
  }, [vehicles, search, t]);

  const columns = [
    {
      key: 'vehicle',
      header: t('forms.vehicle.number'),
      render: (v) => (
        <>
          <div className="dv-cell-primary">{v.vehicleNumber}</div>
          <div className="dv-cell-sub">{v.fuelType}</div>
        </>
      ),
    },
    {
      key: 'type',
      header: t('forms.vehicle.type'),
      render: (v) => (
        <>
          {t(`catalog.vehicleTypes.${v.vehicleType}.label`, VEHICLE_TYPE_INFO[v.vehicleType]?.label || v.vehicleType.replace('_', ' '))}
          <div className="dv-cell-sub">{v.maxCapacityTonnes}t</div>
        </>
      ),
    },
    {
      key: 'cargo',
      header: t('forms.vehicle.cargoCompat'),
      render: (v) => (
        <div className="dv-badge-row">
          {(v.cargoCompatibility || []).length === 0 && <span className="dv-cell-sub">—</span>}
          {(v.cargoCompatibility || []).map((c) => (
            <span className="dv-tag" key={c}>
              {t(`catalog.cargoTypes.${c}`, c)}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'driver',
      header: t('dashboard.nav.drivers', 'Driver'),
      render: (v) =>
        isFleetOwner ? (
          <select className="dv-select-inline" value={v.assignedDriverId?._id || ''} onChange={(e) => handleAssign(v._id, e.target.value)}>
            <option value="">{t('forms.vehicle.unassigned')}</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id} disabled={d.assignedVehicle && String(d.assignedVehicle.id) !== String(v._id)}>
                {d.name || d.email}
                {d.assignedVehicle && String(d.assignedVehicle.id) !== String(v._id) ? ` (${d.assignedVehicle.vehicleNumber})` : ''}
              </option>
            ))}
          </select>
        ) : (
          <span>{v.assignedDriverId ? v.assignedDriverId.name || v.assignedDriverId.email : v.driverName || <span className="dv-cell-sub">{t('forms.vehicle.unassigned')}</span>}</span>
        ),
    },
    {
      key: 'status',
      header: t('common.status', 'Status'),
      render: (v) => {
        const onTrip = trips.some((tr) => String(tr.vehicleId?._id || tr.vehicleId) === String(v._id) && tr.status === 'matched');
        return (
          <span className={`dv-status-chip ${onTrip ? 'tone-active' : v.status === 'active' ? 'tone-open' : 'tone-done'}`}>
            {onTrip ? t('dashboard.fleet.onTrip', 'On trip') : v.status}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (v) =>
        canManage ? (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline" style={{ fontSize: 13 }} onClick={() => startEdit(v)}>
              {t('forms.vehicle.edit')}
            </button>
            <button className="btn btn-outline" style={{ fontSize: 13 }} onClick={() => deleteVehicle(v._id).then(reload)}>
              {t('forms.vehicle.remove')}
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isFleetOwner && assignError && <p style={{ color: '#DC2626', fontSize: 14 }}>{assignError}</p>}

      <div className="dv-panel">
        <div className="dv-panel-head">
          <h2>
            {t('dashboard.section.vehicles.title')} · {vehicles.length}
          </h2>
          <div className="dv-table-toolbar">
            <div className="dv-search">
              <IconSearch size={13} />
              <input placeholder={t('common.search', 'Search vehicles')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {canManage && !vehicleCapReached && (
              <button type="button" className="btn btn-primary" onClick={startCreate}>
                + {t('forms.vehicle.submit')}
              </button>
            )}
          </div>
        </div>
        {vehicleCapReached && <p className="form-help" style={{ padding: '0 16px 12px' }}>{t('forms.vehicle.capReached')}</p>}
        <DataTable columns={columns} rows={filteredVehicles} rowKey={(v) => v._id} emptyText={t('forms.vehicle.noneYet')} />
      </div>

      {canManage && (
        <SidePanel
          open={panelOpen}
          onClose={() => {
            setPanelOpen(false);
            setEditingId(null);
          }}
          title={editingId ? t('forms.vehicle.editHeading') : t('forms.vehicle.heading')}
        >
          <p className="form-help">{t('forms.vehicle.help')}</p>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 10 }}>
            <div className="field">
              <label className="field-label" htmlFor="veh-number">
                {t('forms.vehicle.number')}
              </label>
              <input
                id="veh-number"
                className="input"
                placeholder={t('forms.vehicle.numberPlaceholder')}
                required
                disabled={!!editingId}
                value={form.vehicleNumber}
                onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })}
              />
              {editingId && <span className="field-hint">{t('forms.vehicle.numberLocked')}</span>}
            </div>
            <div className="field">
              <label className="field-label" htmlFor="veh-type">
                {t('forms.vehicle.type')}
              </label>
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
              <label className="field-label" htmlFor="veh-capacity">
                {t('forms.vehicle.capacity')}
              </label>
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
              <label className="field-label" htmlFor="veh-fuel">
                {t('forms.vehicle.fuelType')}
              </label>
              <select id="veh-fuel" className="input" value={form.fuelType} onChange={(e) => setForm({ ...form, fuelType: e.target.value })}>
                {['diesel', 'petrol', 'cng', 'electric'].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
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
              <label className="field-label" htmlFor="veh-driver-name">
                {t('forms.vehicle.driverName')}
              </label>
              <input id="veh-driver-name" className="input" placeholder={t('forms.vehicle.driverNamePlaceholder')} value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="veh-driver-phone">
                {t('forms.vehicle.driverPhone')}
              </label>
              <input id="veh-driver-phone" className="input" placeholder={t('forms.vehicle.driverPhonePlaceholder')} value={form.driverPhone} onChange={(e) => setForm({ ...form, driverPhone: e.target.value })} />
            </div>
            {error && <p style={{ color: '#DC2626', fontSize: 14 }}>{error}</p>}
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {editingId
                ? saving
                  ? t('forms.vehicle.updating')
                  : t('forms.vehicle.submitUpdate')
                : saving
                  ? t('forms.vehicle.submitting')
                  : t('forms.vehicle.submit')}
            </button>
          </form>
        </SidePanel>
      )}
    </div>
  );
}

function TripsTab({ canManage, vehicles, trips, requests, reload, onViewCurrentTrip, t: tProp }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ vehicleId: '', source: '', destination: '', availableFrom: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // The one request still moving (if any) for this trip -- same "not yet
  // completed/rejected/cancelled" rule RequestsPanel's Current Trip view
  // filters by, so clicking through here always lands on a row that's
  // actually still there.
  function liveRequestFor(tr) {
    return requests.find((r) => String(r.tripId?._id || r.tripId) === String(tr._id) && !['completed', 'rejected', 'cancelled'].includes(r.status));
  }

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

  const columns = [
    {
      key: 'route',
      header: t('forms.trip.heading'),
      render: (tr) => (
        <>
          <div className="dv-cell-primary">
            {tr.source} → {tr.destination}
          </div>
          <div className="dv-cell-sub">{tr.vehicleId?.vehicleNumber || 'vehicle'}</div>
        </>
      ),
    },
    {
      key: 'available',
      header: t('forms.trip.availableFrom'),
      render: (tr) => new Date(tr.availableFrom).toLocaleString(),
    },
    {
      key: 'status',
      header: t('common.status', 'Status'),
      render: (tr) => {
        const d = tripDisplayStatus(tr, requests.filter((r) => String(r.tripId?._id || r.tripId) === String(tr._id)), t);
        return <span className={`dv-status-chip tone-${d.tone}`}>{d.label}</span>;
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (tr) => {
        const live = liveRequestFor(tr);
        return (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {live && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 13 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onViewCurrentTrip(live._id);
                }}
              >
                {t('dashboard.fleet.viewInCurrentTrip', 'View in Current Trip')}
              </button>
            )}
            {canManage && (
              <button
                className="btn btn-outline"
                style={{ fontSize: 13 }}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteTrip(tr._id).then(reload);
                }}
              >
                {t('forms.trip.remove')}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canManage && (
        <div className="dv-panel">
          <div className="dv-panel-head">
            <h2>{t('forms.trip.heading')}</h2>
          </div>
          <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, padding: '14px 18px' }}>
            <div className="field">
              <label className="field-label" htmlFor="trip-vehicle">
                {t('forms.trip.vehicle')}
              </label>
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
              <label className="field-label" htmlFor="trip-source">
                {t('forms.trip.source')}
              </label>
              <LocationSelect id="trip-source" value={form.source} onChange={(v) => setForm({ ...form, source: v })} placeholder={t('forms.trip.sourcePlaceholder')} required />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="trip-destination">
                {t('forms.trip.destination')}
              </label>
              <LocationSelect id="trip-destination" value={form.destination} onChange={(v) => setForm({ ...form, destination: v })} placeholder={t('forms.trip.destinationPlaceholder')} required />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="trip-available">
                {t('forms.trip.availableFrom')}
              </label>
              <input id="trip-available" className="input" type="datetime-local" required value={form.availableFrom} onChange={(e) => setForm({ ...form, availableFrom: e.target.value })} />
            </div>
            <div style={{ gridColumn: 'span 4' }}>
              <RoutePreviewMap source={form.source} destination={form.destination} />
            </div>
            {error && (
              <p style={{ color: '#DC2626', fontSize: 14, gridColumn: 'span 4', margin: 0 }}>{error}</p>
            )}
            <button className="btn btn-primary" type="submit" disabled={saving} style={{ gridColumn: 'span 4' }}>
              {saving ? t('forms.trip.submitting') : t('forms.trip.submit')}
            </button>
          </form>
        </div>
      )}

      <div className="dv-panel">
        <div className="dv-panel-head">
          <h2>
            {t('dashboard.section.trips.title')} · {trips.length}
          </h2>
        </div>
        {trips.some((tr) => liveRequestFor(tr)) && (
          <p className="dv-hint" style={{ padding: '0 18px 10px' }}>
            {t('dashboard.fleet.tripRowHint', 'A trip with a live booking is clickable — tap it to open Current Trip.')}
          </p>
        )}
        <DataTable
          columns={columns}
          rows={trips}
          rowKey={(tr) => tr._id}
          emptyText={t('forms.trip.noneYet')}
          onRowClick={(tr) => {
            const live = liveRequestFor(tr);
            if (live) onViewCurrentTrip(live._id);
          }}
          isRowClickable={(tr) => !!liveRequestFor(tr)}
        />
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
          <p style={{ fontSize: 13.5, color: '#D97706', marginTop: 8 }}>{t('forms.findLoads.noVehicleAssigned')}</p>
        )}
        {available.length === 0 && !isDriver && <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 8 }}>{t('forms.findLoads.planTripFirst')}</p>}
      </div>

      {loading && <p style={{ fontSize: 14, color: 'var(--muted)' }}>{t('forms.findLoads.scoring')}</p>}
      {error && <p style={{ color: '#DC2626', fontSize: 14 }}>{error}</p>}
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
      {isDriver && result && <p style={{ fontSize: 13, color: 'var(--muted)' }}>{t('forms.findLoads.driverApprovalNote')}</p>}
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
      <div className="dv-panel">
        <div className="dv-panel-head">
          <h2>{t('forms.nearbyLoads.heading')}</h2>
        </div>
        <form onSubmit={search} style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', padding: '14px 18px' }}>
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
        {error && <p style={{ color: '#DC2626', fontSize: 14, padding: '0 18px 14px' }}>{error}</p>}
      </div>

      {result && (
        <div className="dv-panel">
          <div className="dv-panel-head">
            <h2>{t('forms.nearbyLoads.resultsSummary', { count: result.loads.length, radius: result.radiusKm, place: result.location })}</h2>
          </div>
          <DataTable
            columns={[
              {
                key: 'route',
                header: t('forms.nearbyLoads.heading'),
                render: ({ load }) => (
                  <>
                    <div className="dv-cell-primary">
                      {load.pickupLocation} → {load.deliveryLocation}
                    </div>
                    <div className="dv-cell-sub">
                      {load.cargoType} · {load.cargoWeightTonnes}t
                    </div>
                  </>
                ),
              },
              { key: 'price', header: '₹', render: ({ load }) => `₹${load.expectedPrice}` },
              { key: 'distance', header: 'km', align: 'right', render: ({ distanceKm }) => `${distanceKm} km` },
            ]}
            rows={result.loads}
            rowKey={({ load }) => load._id}
            emptyText={t('forms.nearbyLoads.noneFound')}
          />
        </div>
      )}
    </div>
  );
}

// Semantic color chips for ML Modules 3 & 4 (Addendum 39) -- unlike the
// monochrome .dv-status-chip tone system (not semantically red/amber/green
// by design, see dataViews.css), these two genuinely mean "good" vs "bad"
// so they get literal colors, the same way MatchResults.jsx's MlBadge /
// MlProfitabilityBadge chips do. Local to this file since neither module
// has a vehicle-load pairing to slot into MatchResults' own cards.
const DEMAND_COLORS = { High: 'var(--primary)', Medium: '#D97706', Low: '#DC2626' };
function DemandCategoryChip({ category }) {
  const color = DEMAND_COLORS[category] || 'var(--muted)';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: `color-mix(in srgb, ${color} 15%, transparent)`, color,
        fontWeight: 700, padding: '3px 10px', borderRadius: 999, fontSize: 13, whiteSpace: 'nowrap',
      }}
    >
      {category}
    </span>
  );
}

const RISK_COLORS = { Low: 'var(--primary)', Medium: '#D97706', High: '#DC2626' };
function RiskChip({ pct, level }) {
  const color = RISK_COLORS[level] || 'var(--muted)';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: `color-mix(in srgb, ${color} 15%, transparent)`, color,
        fontWeight: 700, padding: '3px 10px', borderRadius: 999, fontSize: 13, whiteSpace: 'nowrap',
      }}
    >
      {pct}% · {level}
    </span>
  );
}

// "Route Insights" (Addendum 39) -- the UI home for ML Module 3 (Demand
// Forecasting, a per-ROUTE lookup the user drives with a city picker, no
// vehicle/load pairing involved) and ML Module 4 (Empty-Run Risk
// Prediction, scored for every one of the user's own available trips).
// Neither fits the existing MatchResults cards (built for a specific
// vehicle-load pair), so this is a dedicated panel rather than a re-use of
// existing match/profitability UI.
function RouteInsightsTab() {
  const { t } = useTranslation();
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [demand, setDemand] = useState(null);
  const [demandError, setDemandError] = useState(null);
  const [demandLoading, setDemandLoading] = useState(false);

  const [riskTrips, setRiskTrips] = useState(null);
  const [riskError, setRiskError] = useState(null);
  const [riskLoading, setRiskLoading] = useState(true);

  useEffect(() => {
    // Also ping here directly (cheap, idempotent) in case this tab is
    // reached long enough after the dashboard's own mount-time ping that
    // the ml-service could plausibly have gone back to sleep in between.
    warmMl().catch(() => {});
    emptyRunRisk()
      .then((data) => setRiskTrips(data.trips))
      .catch((err) => setRiskError(err.message))
      .finally(() => setRiskLoading(false));
  }, []);

  async function handleForecast(e) {
    e.preventDefault();
    setDemandError(null);
    setDemand(null);
    if (!origin || !destination) return;
    setDemandLoading(true);
    try {
      const data = await demandForecast(origin, destination);
      if (!data.eligible) setDemandError(data.reason);
      else setDemand(data);
    } catch (err) {
      setDemandError(err.message);
    } finally {
      setDemandLoading(false);
    }
  }

  const riskColumns = [
    {
      key: 'route',
      header: 'Trip',
      render: ({ trip }) => (
        <>
          <div className="dv-cell-primary">
            {trip.source} → {trip.destination}
          </div>
          <div className="dv-cell-sub">{trip.vehicleId?.vehicleNumber || 'vehicle'} · available {new Date(trip.availableFrom).toLocaleDateString()}</div>
        </>
      ),
    },
    {
      key: 'nearby',
      header: 'Compatible loads nearby',
      align: 'right',
      render: ({ compatibleLoadsNearbyCount }) => compatibleLoadsNearbyCount,
    },
    {
      key: 'risk',
      header: 'Empty-run risk',
      align: 'right',
      render: ({ emptyRunRiskPct, riskLevel }) =>
        emptyRunRiskPct != null ? <RiskChip pct={emptyRunRiskPct} level={riskLevel} /> : <span className="dv-cell-sub">—</span>,
    },
  ];
  const highRiskCount = (riskTrips || []).filter((r) => r.riskLevel === 'High').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="dv-panel">
        <div className="dv-panel-head">
          <h2>Demand forecast</h2>
        </div>
        <p className="form-help" style={{ padding: '0 18px' }} title={t('ml.syntheticNote')}>
          Predicted load volume on this route over the next 7 days.
        </p>
        <form onSubmit={handleForecast} style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', padding: '14px 18px' }}>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label className="field-label" htmlFor="insights-origin">Origin</label>
            <LocationSelect id="insights-origin" value={origin} onChange={setOrigin} placeholder="Select origin" required />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label className="field-label" htmlFor="insights-destination">Destination</label>
            <LocationSelect id="insights-destination" value={destination} onChange={setDestination} placeholder="Select destination" required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={demandLoading}>
            {demandLoading ? 'Forecasting...' : 'Forecast demand'}
          </button>
        </form>
        <div style={{ padding: '0 18px 14px' }}>
          <RoutePreviewMap source={origin} destination={destination} />
        </div>
        {demandError && <p style={{ color: '#DC2626', fontSize: 14, padding: '0 18px 14px' }}>{demandError}</p>}
        {demand && (
          <div style={{ padding: '0 18px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div>
              <div style={{ fontSize: 23, fontWeight: 800 }}>{demand.predictedLoadCount7d}</div>
              <div className="dv-cell-sub">predicted loads, next 7 days</div>
            </div>
            <DemandCategoryChip category={demand.demandCategory} />
            <div className="dv-cell-sub">
              Recent activity: {demand.recentLoadCount14d} in 14d / {demand.recentLoadCount30d} in 30d
            </div>
          </div>
        )}
      </div>

      <div className="dv-panel">
        <div className="dv-panel-head">
          <h2>
            Empty-run risk · your available trips
            {highRiskCount > 0 && <span style={{ marginLeft: 8, color: '#DC2626', fontWeight: 700, fontSize: 14 }}><IconAlert size={14} /> {highRiskCount} high risk</span>}
          </h2>
        </div>
        <p className="form-help" style={{ padding: '0 18px' }} title={t('ml.syntheticNote')}>
          How likely each trip is to return empty, and how many compatible loads exist near its destination.
        </p>
        {riskLoading && <p style={{ fontSize: 14, color: 'var(--muted)', padding: '0 18px 14px' }}>Scoring your trips...</p>}
        {riskError && <p style={{ color: '#DC2626', fontSize: 14, padding: '0 18px 14px' }}>{riskError}</p>}
        {!riskLoading && !riskError && (
          <DataTable columns={riskColumns} rows={riskTrips || []} rowKey={({ trip }) => trip._id} emptyText="No available trips to score yet. Plan a trip first." />
        )}
      </div>
    </div>
  );
}

function DriversSection({ drivers }) {
  const { t } = useTranslation();
  const columns = [
    {
      key: 'name',
      header: t('forms.vehicle.driverName'),
      render: (d) => (
        <>
          <div className="dv-cell-primary">{d.name || d.email}</div>
          {d.phone && <div className="dv-cell-sub">{d.phone}</div>}
        </>
      ),
    },
    {
      key: 'assignment',
      header: t('dashboard.nav.vehicles'),
      render: (d) => (
        <span className={`dv-status-chip ${d.assignedVehicle ? 'tone-active' : 'tone-open'}`}>
          {d.assignedVehicle ? d.assignedVehicle.vehicleNumber : t('forms.vehicle.unassigned')}
        </span>
      ),
    },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="dv-panel">
        <div className="dv-panel-head">
          <h2>
            {t('dashboard.section.drivers.title')} · {drivers.length}
          </h2>
        </div>
        <DataTable columns={columns} rows={drivers} rowKey={(d) => d.id} emptyText="No drivers have signed up with your invite codes yet." />
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
      { key: 'trips', label: t('dashboard.nav.tripPlanner', 'Trip Planner'), icon: IconRoute, badge: tripsCount },
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
    title: 'Bookings',
    items: [
      { key: 'current-trip', label: t('dashboard.nav.currentTrip', 'Current Trip'), icon: IconNavigation, badge: pendingApprovalCount },
      { key: 'history', label: t('dashboard.nav.history', 'History'), icon: IconHistory },
    ],
  },
  {
    title: 'Payments',
    items: [{ key: 'payments', label: t('dashboard.nav.payments', 'Payments'), icon: IconWallet }],
  },
  {
    title: 'Insights',
    items: [{ key: 'route-insights', label: t('dashboard.nav.trendAnalysis', 'Trend Analysis'), icon: IconTrendUp }],
  },
];

const SECTION_META = (t) => ({
  overview: { title: t('dashboard.section.overview.title'), subtitle: t('dashboard.section.overview.subtitleFleet') },
  vehicles: { title: t('dashboard.section.vehicles.title'), subtitle: t('dashboard.section.vehicles.subtitle') },
  trips: { title: t('dashboard.nav.tripPlanner', 'Trip Planner'), subtitle: t('dashboard.section.trips.subtitle') },
  drivers: { title: t('dashboard.section.drivers.title'), subtitle: t('dashboard.section.drivers.subtitle') },
  'find-loads': { title: t('dashboard.section.findLoads.title'), subtitle: t('dashboard.section.findLoads.subtitle') },
  'nearby-loads': { title: t('dashboard.section.nearbyLoads.title'), subtitle: t('dashboard.section.nearbyLoads.subtitle') },
  'current-trip': {
    title: t('dashboard.section.currentTrip.title', 'Current Trip'),
    subtitle: t('dashboard.section.currentTrip.subtitle', 'Every booking still moving, with live actions, navigation and a demo simulate option.'),
  },
  history: {
    title: t('dashboard.section.history.title', 'History'),
    subtitle: t('dashboard.section.history.subtitle', 'Completed, rejected and cancelled bookings -- a read-only record of what already happened.'),
  },
  payments: {
    title: t('dashboard.section.payments.title', 'Payments'),
    subtitle: t('dashboard.section.payments.subtitle', 'Record payment and leave a rating once a trip is over.'),
  },
  'route-insights': {
    title: t('dashboard.nav.trendAnalysis', 'Trend Analysis'),
    subtitle: t('dashboard.section.routeInsights.subtitle', 'Demand forecasting and empty-run risk for your available trips.'),
  },
});

// Bucket keys/colors for the request pipeline distribution -- same 4
// buckets this dashboard has always computed (pendingApproval/active/
// completed/rejectedCancelled), now rendered as a stacked bar instead of
// an axis-labeled chart. Colors are CSS custom properties so they follow
// the light/dark theme automatically.
const REQUEST_STATUS_BUCKETS = [
  { key: 'pendingApproval', fallback: 'Pending approval', color: 'var(--accent)' },
  { key: 'active', fallback: 'Active', color: 'var(--primary)' },
  { key: 'completed', fallback: 'Completed', color: 'var(--secondary)' },
  { key: 'rejectedCancelled', fallback: 'Rejected / cancelled', color: 'var(--ink-faint)' },
];

export default function FleetDashboard({ user, onLogout }) {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useState('overview');
  const [vehicles, setVehicles] = useState([]);
  const [trips, setTrips] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [attnBusyId, setAttnBusyId] = useState(null);
  // Set when a Trip Planner row (or any other "open this booking" action)
  // wants Current Trip to land on, and highlight, one specific request --
  // see RequestsPanel.jsx's focusId/onFocusHandled props.
  const [focusRequestId, setFocusRequestId] = useState(null);
  const canManage = user.role === 'fleet_owner' || user.role === 'owner_driver';
  const isFleetOwner = user.role === 'fleet_owner';

  function viewInCurrentTrip(requestId) {
    setFocusRequestId(requestId);
    setSection('current-trip');
  }

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
    // Fire-and-forget: nudge a sleeping ml-service awake (Render free-tier
    // cold start) the moment the dashboard itself loads, not only once the
    // user opens Route Insights -- by the time they get to "Forecast
    // demand" a cold instance has had a real head start instead of none.
    // See backend/routes/insights.js's /warm-ml and services/mlClient.js's
    // pingMlService() for why: no timeout value fixes a true cold start,
    // only starting it earlier does.
    warmMl().catch(() => {});
    reloadVehicles();
    reloadTrips();
    reloadDrivers();
    reloadRequests();
  }, []);

  const pendingApprovalRequests = useMemo(
    () => (isFleetOwner ? requests.filter((r) => r.status === 'pending_fleet_approval') : []),
    [requests, isFleetOwner],
  );
  const pendingApprovalCount = pendingApprovalRequests.length;

  async function actOnRequest(id, status) {
    setAttnBusyId(id);
    try {
      await updateRequestStatus(id, status);
      reloadRequests();
    } catch {
      /* the Requests tab surfaces the same action with its own error
         message if this one fails -- this panel just stays as-is so the
         item is still visible to retry from. */
    } finally {
      setAttnBusyId(null);
    }
  }

  // Vehicles with no driver and no open/matched trip yet -- a genuine
  // "this needs you" signal, not decoration: an idle, unassigned vehicle
  // earns nothing for the fleet.
  const unassignedVehicles = useMemo(
    () => (isFleetOwner ? vehicles.filter((v) => v.status === 'active' && !v.assignedDriverId) : []),
    [vehicles, isFleetOwner],
  );

  const attentionItems = useMemo(() => {
    const items = [];
    for (const r of pendingApprovalRequests) {
      items.push({
        id: r._id,
        text: (
          <>
            <b>{t('dashboard.fleet.driverRequest', 'A driver')}</b>{' '}
            <span className="muted">
              {t('dashboard.fleet.requestedLoad', 'requested a load on')} {r.tripId ? `${r.tripId.source} → ${r.tripId.destination}` : t('dashboard.fleet.tripRemoved', 'a removed trip')}
              {' · '}
              {t('dashboard.fleet.waitingApproval', 'waiting on your approval before it reaches the poster')}
            </span>
          </>
        ),
        actions: [
          { label: t('common.reject', 'Reject'), onClick: () => actOnRequest(r._id, 'rejected'), disabled: attnBusyId === r._id },
          { label: t('common.approve', 'Approve'), variant: 'primary', onClick: () => actOnRequest(r._id, 'requested'), disabled: attnBusyId === r._id },
        ],
      });
    }
    for (const v of unassignedVehicles) {
      items.push({
        id: v._id,
        text: (
          <>
            <b>{v.vehicleNumber}</b> <span className="muted">{t('dashboard.fleet.noDriverAssigned', 'has no driver assigned')}</span>
          </>
        ),
        actions: [{ label: t('dashboard.fleet.assignDriver', 'Assign driver'), onClick: () => setSection('vehicles') }],
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t's identity
    // doesn't change on language switch, only i18n.language does.
  }, [pendingApprovalRequests, unassignedVehicles, attnBusyId, i18n.language]);

  const pulseTiles = useMemo(() => {
    const onTripCount = vehicles.filter((v) => trips.some((tr) => String(tr.vehicleId?._id || tr.vehicleId) === String(v._id) && tr.status === 'matched')).length;
    const idleCount = vehicles.length - onTripCount;
    const activeRequests = requests.filter((r) => ACTIVE_STATUSES.includes(r.status));
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const newThisWeek = requests.filter((r) => r.createdAt && new Date(r.createdAt).getTime() >= weekAgo).length;
    const profitableActive = activeRequests.filter((r) => r.profitability && !r.profitability.error && typeof r.profitability.estimatedProfit === 'number');
    const totalActiveProfit = profitableActive.reduce((sum, r) => sum + r.profitability.estimatedProfit, 0);

    const tiles = [
      {
        key: 'vehicles',
        label: t('dashboard.nav.vehicles'),
        value: onTripCount,
        valueSuffix: `/ ${vehicles.length}`,
        delta: vehicles.length === 0 ? null : idleCount > 0 ? t('dashboard.fleet.idleReady', '{{count}} idle, ready to plan', { count: idleCount }) : t('dashboard.fleet.allOnTrip', 'All on a trip'),
        tone: idleCount > 0 ? '' : 'ok',
      },
    ];
    if (isFleetOwner) {
      const assignedDrivers = drivers.filter((d) => d.assignedVehicle).length;
      tiles.push({
        key: 'drivers',
        label: t('dashboard.nav.drivers'),
        value: assignedDrivers,
        valueSuffix: `/ ${drivers.length}`,
        delta: drivers.length === 0 ? null : drivers.length - assignedDrivers > 0 ? t('dashboard.fleet.unassignedDrivers', '{{count}} unassigned', { count: drivers.length - assignedDrivers }) : t('dashboard.fleet.fullyStaffed', 'Fully staffed'),
        tone: drivers.length - assignedDrivers > 0 ? 'warn' : 'ok',
      });
    }
    tiles.push({
      key: 'requests',
      label: t('dashboard.nav.currentTrip', 'Current Trip'),
      value: activeRequests.length,
      delta: newThisWeek > 0 ? t('dashboard.fleet.newThisWeek', '+{{count}} this week', { count: newThisWeek }) : null,
      tone: 'ok',
    });
    tiles.push({
      key: 'revenue',
      label: t('dashboard.fleet.estRevenue', 'Est. revenue, active'),
      value: totalActiveProfit > 0 ? `₹${Math.round(totalActiveProfit).toLocaleString('en-IN')}` : '₹0',
      delta: profitableActive.length > 0 ? t('dashboard.fleet.acrossBookings', 'across {{count}} bookings', { count: profitableActive.length }) : null,
    });
    return tiles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles, trips, drivers, requests, isFleetOwner, i18n.language]);

  const tripsInMotion = useMemo(() => {
    const requestsByTrip = (tripId) => requests.filter((r) => String(r.tripId?._id || r.tripId) === String(tripId));
    return trips
      .filter((tr) => tr.status !== 'cancelled')
      .map((tr) => {
        const d = tripDisplayStatus(tr, requestsByTrip(tr._id), t);
        return {
          id: tr._id,
          route: `${tr.source} → ${tr.destination}`,
          meta: tr.vehicleId?.vehicleNumber || '',
          statusLabel: d.label,
          tone: d.tone,
          // matched/active trips surface above still-open ones
          sortRank: d.tone === 'active' || d.tone === 'pending' ? 0 : d.tone === 'open' ? 1 : 2,
        };
      })
      .sort((a, b) => a.sortRank - b.sortRank)
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, requests, i18n.language]);

  const pipelineBuckets = useMemo(() => {
    const counts = { pendingApproval: 0, active: 0, completed: 0, rejectedCancelled: 0 };
    for (const r of requests) {
      if (r.status === 'pending_fleet_approval') counts.pendingApproval += 1;
      else if (ACTIVE_STATUSES.includes(r.status)) counts.active += 1;
      else if (r.status === 'completed') counts.completed += 1;
      else counts.rejectedCancelled += 1;
    }
    return REQUEST_STATUS_BUCKETS.map(({ key, fallback, color }) => ({
      key,
      color,
      label: t(`charts.requestStatus.${key}`, fallback),
      value: counts[key],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, i18n.language]);

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
          <AttentionPanel items={attentionItems} />
          <PulseRow tiles={pulseTiles} />

          <div className="dv-two-col dv-section-gap">
            <TripsInMotionList trips={tripsInMotion} onViewAll={() => setSection('current-trip')} />
            <RequestPipeline buckets={pipelineBuckets} />
          </div>

          <div className="dv-panel">
            <div className="dv-panel-head">
              <h2>{t('dashboard.fleet.recentActivity', 'Recent activity')}</h2>
            </div>
            <div style={{ padding: '2px 16px' }}>
              <ActivityList items={recentActivity} emptyText="No requests yet." />
            </div>
          </div>
        </>
      )}

      {section === 'vehicles' && (
        <VehiclesTab canManage={canManage} isFleetOwner={isFleetOwner} vehicles={vehicles} drivers={drivers} trips={trips} reload={reloadVehicles} reloadDrivers={reloadDrivers} />
      )}
      {section === 'trips' && (
        <TripsTab canManage={canManage} vehicles={vehicles} trips={trips} requests={requests} reload={reloadTrips} onViewCurrentTrip={viewInCurrentTrip} />
      )}
      {section === 'drivers' && isFleetOwner && <DriversSection drivers={drivers} />}
      {section === 'find-loads' && <FindLoadsTab trips={trips} user={user} />}
      {section === 'nearby-loads' && <NearbyLoadsTab />}
      {section === 'current-trip' && (
        <RequestsPanel user={user} mode="current" focusId={focusRequestId} onFocusHandled={() => setFocusRequestId(null)} />
      )}
      {section === 'history' && <RequestsPanel user={user} mode="history" />}
      {section === 'payments' && <PaymentsPanel user={user} />}
      {section === 'route-insights' && <RouteInsightsTab />}
    </DashboardShell>
  );
}
