import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listLoads, createLoad, deleteLoad } from '../lib/loadApi.js';
import { VEHICLE_TYPES } from '../lib/vehicleApi.js';
import { matchesForLoad } from '../lib/matchingApi.js';
import { warmMl } from '../lib/insightsApi.js';
import { createRequest, listRequests, STATUS_LABELS } from '../lib/requestApi.js';
import { timeAgo, bucketByDay } from '../lib/time.js';
import MatchResults from '../components/MatchResults.jsx';
import RequestsPanel from '../components/RequestsPanel.jsx';
import PaymentsPanel from '../components/PaymentsPanel.jsx';
import DashboardShell from '../components/DashboardShell.jsx';
import StatCard from '../components/StatCard.jsx';
import { MiniLineChart, MiniBarChart } from '../components/MiniCharts.jsx';
import ActivityList from '../components/ActivityList.jsx';
import AddressInput from '../components/AddressInput.jsx';
import RoutePreviewMap from '../components/RoutePreviewMap.jsx';
import { locationLabel } from '../lib/locationLabel.js';
import { CARGO_TYPES, VEHICLE_TYPE_INFO } from '../lib/catalog.js';
import {
  IconGrid,
  IconBox,
  IconTruck,
  IconClipboard,
  IconSearch,
  IconClock,
  IconCheckCircle,
  IconWallet,
  IconMapPin,
} from '../components/icons.jsx';

const ACTIVE_STATUSES = ['requested', 'accepted', 'confirmed', 'pickup', 'in_transit', 'delivered'];

// Round-4 colour pass (Addendum 65): Load.status was rendered as plain
// inline text with no colour at all -- this maps it onto the same shared
// .dv-status-chip tone system Current Trip/History/Vehicles already use
// (see dataViews.css), so a posted load's state reads at a glance instead
// of being just another word in a muted line of text.
const LOAD_STATUS_TONE = { open: 'open', matched: 'active', completed: 'done', cancelled: 'rejected' };

const EMPTY_FORM = {
  pickupLocation: null,
  deliveryLocation: null,
  cargoType: '',
  cargoWeightTonnes: '',
  requiredVehicleType: 'any',
  pickupDateTime: '',
  deliveryDeadline: '',
  specialRequirements: '',
  expectedPrice: '',
};

function LoadsTab({ loads, reload }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    // AddressInput only ever hands back a real {label, lat, lng} point or
    // null -- catch an unresolved pick here before it even reaches the
    // network, same guard FleetDashboard's Plan-a-Trip form has.
    if (!form.pickupLocation || !form.deliveryLocation) {
      setError('Pick a pickup and delivery location from the suggestions, a quick city, your location, or the map.');
      return;
    }
    setSaving(true);
    try {
      await createLoad({
        ...form,
        cargoWeightTonnes: Number(form.cargoWeightTonnes),
        expectedPrice: Number(form.expectedPrice),
      });
      setForm(EMPTY_FORM);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <h3>{t('forms.load.heading')}</h3>
        <p className="form-help">{t('forms.load.help')}</p>
        <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 10 }}>
          <div className="field">
            <label className="field-label" htmlFor="load-pickup">{t('forms.load.pickup')}</label>
            <AddressInput id="load-pickup" value={form.pickupLocation} onChange={(v) => setForm({ ...form, pickupLocation: v })} placeholder={t('forms.load.pickupPlaceholder')} required allowLiveLocation />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="load-delivery">{t('forms.load.delivery')}</label>
            <AddressInput id="load-delivery" value={form.deliveryLocation} onChange={(v) => setForm({ ...form, deliveryLocation: v })} placeholder={t('forms.load.deliveryPlaceholder')} required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="load-cargo-type">{t('forms.load.cargoType')}</label>
            <select id="load-cargo-type" className="input" required value={form.cargoType} onChange={(e) => setForm({ ...form, cargoType: e.target.value })}>
              <option value="">{t('forms.load.selectCargoType')}</option>
              {CARGO_TYPES.map((c) => (
                <option key={c.id} value={c.id}>
                  {t(`catalog.cargoTypes.${c.id}`, c.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="load-weight">{t('forms.load.weight')}</label>
            <input id="load-weight" className="input" type="number" min="0.1" step="0.1" placeholder={t('forms.load.weightPlaceholder')} required value={form.cargoWeightTonnes} onChange={(e) => setForm({ ...form, cargoWeightTonnes: e.target.value })} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="load-vehicle-type">{t('forms.load.vehicleTypeNeeded')}</label>
            <select id="load-vehicle-type" className="input" value={form.requiredVehicleType} onChange={(e) => setForm({ ...form, requiredVehicleType: e.target.value })}>
              <option value="any">{t('forms.load.anyVehicleType')}</option>
              {VEHICLE_TYPES.map((vt) => (
                <option key={vt} value={vt}>
                  {t(`catalog.vehicleTypes.${vt}.label`, VEHICLE_TYPE_INFO[vt]?.label || vt.replace('_', ' '))}
                </option>
              ))}
            </select>
            <span className="field-hint">{t('forms.load.vehicleTypeHint')}</span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="load-price">{t('forms.load.price')}</label>
            <input id="load-price" className="input" type="number" min="0" placeholder={t('forms.load.pricePlaceholder')} required value={form.expectedPrice} onChange={(e) => setForm({ ...form, expectedPrice: e.target.value })} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="load-pickup-time">{t('forms.load.pickupTime')}</label>
            <input id="load-pickup-time" className="input" type="datetime-local" required value={form.pickupDateTime} onChange={(e) => setForm({ ...form, pickupDateTime: e.target.value })} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="load-deadline">{t('forms.load.deadline')}</label>
            <input id="load-deadline" className="input" type="datetime-local" required value={form.deliveryDeadline} onChange={(e) => setForm({ ...form, deliveryDeadline: e.target.value })} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="load-special">{t('forms.load.special')}</label>
            <input id="load-special" className="input" placeholder={t('forms.load.specialPlaceholder')} value={form.specialRequirements} onChange={(e) => setForm({ ...form, specialRequirements: e.target.value })} />
          </div>
          <div style={{ gridColumn: 'span 3' }}>
            <RoutePreviewMap source={form.pickupLocation} destination={form.deliveryLocation} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving} style={{ gridColumn: 'span 3' }}>
            {saving ? t('forms.load.submitting') : t('forms.load.submit')}
          </button>
        </form>
        {error && <p style={{ color: 'var(--critical)', fontSize: 14, marginTop: 8 }}>{error}</p>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loads.map((l) => (
          <div key={l._id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                {locationLabel(l.pickupLocation)} → {locationLabel(l.deliveryLocation)}
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {l.cargoType} · {l.cargoWeightTonnes}t · ₹{l.expectedPrice}
                <span className={`dv-status-chip tone-${LOAD_STATUS_TONE[l.status] || 'open'}`}>{l.status}</span>
              </div>
            </div>
            <button className="btn btn-outline" style={{ fontSize: 13, flexShrink: 0 }} onClick={() => deleteLoad(l._id).then(reload)}>
              {t('forms.load.remove')}
            </button>
          </div>
        ))}
        {loads.length === 0 && <p style={{ fontSize: 14, color: 'var(--muted)' }}>{t('forms.load.noneYet')}</p>}
      </div>
    </div>
  );
}

function FindVehiclesTab({ loads }) {
  const { t } = useTranslation();
  const [loadId, setLoadId] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const open = loads.filter((l) => l.status === 'open');

  async function search(id) {
    setLoadId(id);
    setResult(null);
    setError(null);
    if (!id) return;
    setLoading(true);
    try {
      const data = await matchesForLoad(id);
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
        <h3>{t('forms.findVehicles.heading')}</h3>
        <p className="form-help">{t('forms.findVehicles.help')}</p>
        <div className="field">
          <label className="field-label" htmlFor="find-vehicles-load">{t('forms.findVehicles.loadLabel')}</label>
          <select id="find-vehicles-load" className="input" value={loadId} onChange={(e) => search(e.target.value)}>
            <option value="">{t('forms.findVehicles.selectLoad')}</option>
            {open.map((l) => (
              <option key={l._id} value={l._id}>
                {locationLabel(l.pickupLocation)} → {locationLabel(l.deliveryLocation)} ({l.cargoType})
              </option>
            ))}
          </select>
        </div>
        {open.length === 0 && <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 8 }}>{t('forms.findVehicles.postLoadFirst')}</p>}
      </div>

      {loading && <p style={{ fontSize: 14, color: 'var(--muted)' }}>{t('forms.findVehicles.scoring')}</p>}
      {error && <p style={{ color: 'var(--critical)', fontSize: 14 }}>{error}</p>}
      {result && (
        <MatchResults
          matches={result.matches}
          mode="load"
          fixedId={loadId}
          onRequest={(tid, lid) => createRequest(tid, lid).then(() => search(loadId))}
        />
      )}
    </div>
  );
}

// Same pattern as FleetDashboard.jsx's NAV_SECTIONS/SECTION_META -- both
// take `t` so the sidebar/topbar follow the picked language instead of
// hardcoded English (Addendum 32).
const NAV_SECTIONS = ({ t, openCount, activeRequestCount, trackableCount }) => [
  { items: [{ key: 'overview', label: t('dashboard.nav.overview'), icon: IconGrid }] },
  {
    title: 'Loads',
    items: [
      { key: 'loads', label: t('dashboard.nav.myLoads'), icon: IconBox, badge: openCount },
      { key: 'find-vehicles', label: t('dashboard.nav.findVehicles'), icon: IconTruck },
    ],
  },
  {
    title: 'Requests',
    items: [{ key: 'requests', label: t('dashboard.nav.myRequests'), icon: IconClipboard, badge: activeRequestCount }],
  },
  {
    title: 'Tracking',
    items: [{ key: 'track-load', label: t('dashboard.nav.trackLoad', 'Track Load'), icon: IconMapPin, badge: trackableCount }],
  },
  {
    title: 'Payments',
    items: [{ key: 'payments', label: t('dashboard.nav.payments', 'Payments'), icon: IconWallet }],
  },
];

const SECTION_META = (t) => ({
  overview: { title: t('dashboard.section.overview.title'), subtitle: t('dashboard.section.overview.subtitlePoster') },
  loads: { title: t('dashboard.section.loads.title'), subtitle: t('dashboard.section.loads.subtitle') },
  'find-vehicles': { title: t('dashboard.section.findVehicles.title'), subtitle: t('dashboard.section.findVehicles.subtitle') },
  requests: { title: t('dashboard.section.requests.title'), subtitle: t('dashboard.section.requests.subtitle') },
  'track-load': {
    title: t('dashboard.section.trackLoad.title', 'Track Load'),
    subtitle: t('dashboard.section.trackLoad.subtitle', 'Live location for loads on the move.'),
  },
  payments: {
    title: t('dashboard.section.payments.title', 'Payments'),
    subtitle: t('dashboard.section.payments.subtitle', 'Record payment and leave a rating once a trip is over.'),
  },
});

// Same stable-key / translated-fallback pattern as FleetDashboard.jsx's
// identical chart -- see the comment there.
// Round 3 colour pass: same status-token mapping as FleetDashboard.jsx's
// identical bucket list (index.css's new --accent/--info/--good/--critical
// tokens) so this bar chart stops rendering every status in plain black.
const REQUEST_STATUS_BUCKETS = [
  { key: 'pendingApproval', fallback: 'Pending approval', color: 'var(--accent)' },
  { key: 'active', fallback: 'Active', color: 'var(--info)' },
  { key: 'completed', fallback: 'Completed', color: 'var(--good)' },
  { key: 'rejectedCancelled', fallback: 'Rejected / cancelled', color: 'var(--critical)' },
];

export default function PosterDashboard({ user, onLogout }) {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useState('overview');
  const [loads, setLoads] = useState([]);
  const [requests, setRequests] = useState([]);

  function reloadLoads() {
    listLoads().then(setLoads).catch(() => {});
  }
  function reloadRequests() {
    listRequests().then(setRequests).catch(() => {});
  }

  useEffect(() => {
    // Fire-and-forget: nudge a sleeping ml-service awake (Render free-tier
    // cold start) as soon as this dashboard loads, so by the time the user
    // asks to see matches for a load, a cold instance has had a head
    // start instead of none. See backend/routes/insights.js's /warm-ml.
    warmMl().catch(() => {});
    reloadLoads();
    reloadRequests();

    // "Live" Overview (user asked for second-by-second updates) -- polls
    // every second but skips the actual fetch while this tab isn't
    // visible, so a backgrounded/minimized tab doesn't keep hammering the
    // API for no one to see. Same pattern FleetDashboard.jsx's Overview
    // now uses.
    const liveTimer = setInterval(() => {
      if (document.hidden) return;
      reloadLoads();
      reloadRequests();
    }, 1000);
    return () => clearInterval(liveTimer);
  }, []);

  const openCount = useMemo(() => loads.filter((l) => l.status === 'open').length, [loads]);
  const activeRequestCount = useMemo(() => requests.filter((r) => ACTIVE_STATUSES.includes(r.status)).length, [requests]);
  // Same set RequestsPanel's mode="track" filters to -- a vehicle is
  // actually assigned and moving against this booking from Confirmed
  // through Delivered, which is what "Track Load" is for.
  const trackableCount = useMemo(
    () => requests.filter((r) => ['confirmed', 'pickup', 'in_transit', 'delivered'].includes(r.status)).length,
    [requests],
  );
  const completedCount = useMemo(() => requests.filter((r) => r.status === 'completed').length, [requests]);

  const loadsChart = useMemo(() => bucketByDay(loads, (l) => l.createdAt, 14), [loads]);

  const requestStatusChart = useMemo(() => {
    const counts = { pendingApproval: 0, active: 0, completed: 0, rejectedCancelled: 0 };
    for (const r of requests) {
      if (r.status === 'pending_fleet_approval') counts.pendingApproval += 1;
      else if (ACTIVE_STATUSES.includes(r.status)) counts.active += 1;
      else if (r.status === 'completed') counts.completed += 1;
      else counts.rejectedCancelled += 1;
    }
    return REQUEST_STATUS_BUCKETS.map(({ key, fallback, color }) => ({
      label: t(`charts.requestStatus.${key}`, fallback),
      value: counts[key],
      color,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see
    // FleetDashboard.jsx's identical comment on this same pattern.
  }, [requests, t, i18n.language]);

  // Mirrors FleetDashboard.jsx's own earningsTrend -- a 14-day trend of
  // estimated profit, summing profitability.estimatedProfit (already
  // computed by the matching engine, nothing newly fetched for this)
  // across every request that isn't rejected/cancelled, bucketed by when
  // it was requested.
  const profitTrend = useMemo(
    () =>
      bucketByDay(
        requests.filter((r) => r.status !== 'rejected' && r.status !== 'cancelled'),
        (r) => r.createdAt,
        14,
        (r) => (r.profitability && !r.profitability.error ? r.profitability.estimatedProfit : 0),
      ),
    [requests],
  );

  // What's actually moving through this poster's own loads, by cargo
  // type -- a single fixed hue (each bar already carries its own x-axis
  // label, so colour doesn't need to encode identity here) counted
  // straight off the already-loaded `loads` list, same "no new fetch"
  // rule as every other Overview chart on this page.
  const cargoMixChart = useMemo(() => {
    const counts = {};
    for (const l of loads) counts[l.cargoType] = (counts[l.cargoType] || 0) + 1;
    return CARGO_TYPES.filter((c) => counts[c.id]).map((c) => ({
      label: t(`catalog.cargoTypes.${c.id}`, c.label),
      value: counts[c.id],
      color: 'var(--violet)',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loads, t, i18n.language]);

  const recentActivity = useMemo(
    () =>
      [...requests]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 6)
        .map((r) => ({
          id: r._id,
          icon: r.status === 'pending_fleet_approval' ? IconClock : r.status === 'rejected' || r.status === 'cancelled' ? IconClock : IconCheckCircle,
          accent: r.status === 'pending_fleet_approval' ? 'amber' : r.status === 'rejected' || r.status === 'cancelled' ? 'red' : r.status === 'completed' ? 'good' : 'blue',
          title: r.loadId ? `${locationLabel(r.loadId.pickupLocation)} → ${locationLabel(r.loadId.deliveryLocation)}` : 'Load removed',
          subtitle: `${r.tripId ? `Carried by ${locationLabel(r.tripId.source)} → ${locationLabel(r.tripId.destination)}` : 'Trip removed'} · ${t(`status.${r.status}`, STATUS_LABELS[r.status] || r.status)}`,
          time: timeAgo(r.createdAt),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see
    // FleetDashboard.jsx's identical comment on this same pattern.
    [requests, t, i18n.language],
  );

  const meta = SECTION_META(t)[section];

  return (
    <DashboardShell
      brandMark="IB"
      brandName="IBLMS Poster"
      navSections={NAV_SECTIONS({ t, openCount, activeRequestCount, trackableCount })}
      activeKey={section}
      onNavigate={setSection}
      pageTitle={meta.title}
      pageSubtitle={meta.subtitle}
      userLabel={user.name || user.companyName || user.email}
      userSub={{ business_poster: 'Business Poster', individual_poster: 'Individual Poster' }[user.role] || user.role}
      onLogout={onLogout}
    >
      {section === 'overview' && (
        <>
          <div className="wg-overview-grid">
            <StatCard icon={IconBox} label="Loads posted" value={loads.length} accent="teal" />
            <StatCard icon={IconSearch} label="Open loads" value={openCount} accent="blue" />
            <StatCard icon={IconClipboard} label="Active requests" value={activeRequestCount} accent="amber" />
            <StatCard icon={IconCheckCircle} label="Completed" value={completedCount} accent="good" />
          </div>

          <div className="wg-row-2">
            <div className="card">
              <div className="wg-panel-header">
                <h3>Loads posted, last 14 days</h3>
                <span className="wg-panel-sub wg-live-sub">
                  <span className="wg-live-dot" /> {t('dashboard.live', 'Live')}
                </span>
              </div>
              <MiniLineChart data={loadsChart} color="var(--teal)" emptyText="No loads posted yet." />
            </div>
            <div className="card">
              <div className="wg-panel-header">
                <h3>Recent activity</h3>
              </div>
              <ActivityList items={recentActivity} emptyText="No requests yet." />
            </div>
          </div>

          <div className="wg-row-2">
            <div className="card">
              <div className="wg-panel-header">
                <h3>{t('dashboard.profitTrend', 'Profit trend, last 14 days')}</h3>
                <span className="wg-panel-sub">{t('dashboard.estimatedFromBookings', 'Estimated, from matched bookings')}</span>
              </div>
              <MiniLineChart data={profitTrend} color="var(--good)" emptyText="Not enough data yet." />
            </div>
            <div className="card">
              <div className="wg-panel-header">
                <h3>{t('dashboard.cargoMix', 'Cargo mix')}</h3>
              </div>
              <MiniBarChart data={cargoMixChart} emptyText="No loads posted yet." />
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

      {section === 'loads' && <LoadsTab loads={loads} reload={reloadLoads} />}
      {section === 'find-vehicles' && <FindVehiclesTab loads={loads} />}
      {section === 'requests' && <RequestsPanel user={user} restrictToDecision />}
      {section === 'track-load' && <RequestsPanel user={user} mode="track" />}
      {section === 'payments' && <PaymentsPanel user={user} />}
    </DashboardShell>
  );
}
