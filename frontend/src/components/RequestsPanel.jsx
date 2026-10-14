import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listRequests, updateRequestStatus, STATUS_LABELS, NEXT_ACTIONS } from '../lib/requestApi.js';
import TripMap from './TripMap.jsx';

const ACTION_LABELS = {
  requested: 'Approve',
  accepted: 'Accept',
  rejected: 'Reject',
  confirmed: 'Confirm',
  pickup: 'Mark picked up',
  in_transit: 'Mark in transit',
  delivered: 'Mark delivered',
  completed: 'Mark completed',
  cancelled: 'Cancel',
};

const TRACKABLE_STATUSES = ['confirmed', 'pickup', 'in_transit', 'delivered', 'completed'];

// Whether `user` is the vehicle side of this request -- the same rule
// routes/requests.js's sideOfCaller() applies server-side, reimplemented
// here only to decide whether to offer the "Share my location" control at
// all (the backend is still the real authority: TripMap's PATCH call gets
// rejected regardless if this is ever wrong). A Fleet Driver is vehicle
// side only for the vehicle actually assigned to them; a Fleet/Individual
// Owner is vehicle side for anything carrying their own vehicleOwnerId.
function isVehicleSide(r, user) {
  if (!user) return false;
  if (user.role === 'driver') {
    const assigned = r.vehicleId?.assignedDriverId;
    return String(assigned?._id || assigned || '') === String(user.id);
  }
  return String(r.vehicleOwnerId) === String(user.id);
}

const STATUS_COLORS = {
  pending_fleet_approval: '#D97706',
  requested: 'var(--muted)',
  accepted: 'var(--primary)',
  confirmed: 'var(--primary)',
  pickup: '#D97706',
  in_transit: '#D97706',
  delivered: 'var(--primary)',
  completed: 'var(--primary)',
  rejected: '#DC2626',
  cancelled: '#DC2626',
};

// Shared between FleetDashboard and PosterDashboard -- the booking
// lifecycle (SRS Section 13) is symmetric, both sides see the same list
// filtered to their own requests and can advance it the same way. The
// backend (requests.js) is the real authority on who may do what; this
// just offers the buttons that are plausible for the current status.
// `user` is needed for exactly one case: a request pending_fleet_approval
// is visible to both the Fleet Driver who created it and their Fleet
// Owner, but only the Fleet Owner may approve/reject it -- the driver
// only gets a Cancel button for their own request.
export default function RequestsPanel({ user }) {
  const { t } = useTranslation();
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [trackingId, setTrackingId] = useState(null);

  function load() {
    listRequests()
      .then(setRequests)
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function act(id, status) {
    setError(null);
    setBusyId(id);
    try {
      await updateRequestStatus(id, status);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--muted)' }}>No booking requests yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <p style={{ color: '#DC2626', fontSize: 13 }}>{error}</p>}
      {requests.map((r) => {
        const trip = r.tripId;
        const load = r.loadId;
        let actions = NEXT_ACTIONS[r.status] || [];
        let hint = null;
        if (r.status === 'pending_fleet_approval') {
          if (user?.role === 'fleet_owner') {
            actions = ['requested', 'rejected'];
            hint = 'One of your drivers requested this load. Approve to send it on to the Load Poster, or reject it.';
          } else {
            actions = ['cancelled'];
            hint = "Waiting for your Fleet Owner to approve this before it's sent to the Load Poster.";
          }
        }
        return (
          <div key={r._id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {trip ? `${trip.source} → ${trip.destination}` : 'Trip removed'}
                  <span style={{ color: 'var(--muted)', fontWeight: 400 }}> carrying </span>
                  {load ? `${load.pickupLocation} → ${load.deliveryLocation}` : 'Load removed'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
                  Match score {r.matchScore} · {load ? `${load.cargoType}, ${load.cargoWeightTonnes}t` : ''}
                  {r.profitability && !r.profitability.error ? ` · Est. profit ₹${r.profitability.estimatedProfit}` : ''}
                </div>
                {hint && <div style={{ fontSize: 12, color: '#D97706', marginTop: 4, fontStyle: 'italic' }}>{hint}</div>}
              </div>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 800,
                  color: STATUS_COLORS[r.status] || 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  whiteSpace: 'nowrap',
                }}
              >
                {t(`status.${r.status}`, STATUS_LABELS[r.status] || r.status)}
              </span>
            </div>
            {(actions.length > 0 || (TRACKABLE_STATUSES.includes(r.status) && trip)) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {actions.map((a) => (
                <button
                  key={a}
                  className={a === 'rejected' || a === 'cancelled' ? 'btn btn-outline' : 'btn btn-primary'}
                  style={{ fontSize: 12 }}
                  disabled={busyId === r._id}
                  onClick={() => act(r._id, a)}
                >
                  {ACTION_LABELS[a] || a}
                </button>
              ))}
              {TRACKABLE_STATUSES.includes(r.status) && trip && (
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: 12 }}
                  onClick={() => setTrackingId(trackingId === r._id ? null : r._id)}
                >
                  {trackingId === r._id ? t('common.hide') : t('common.track')}
                </button>
              )}
            </div>
            )}
            {trackingId === r._id && <TripMap request={r} canShareLocation={isVehicleSide(r, user)} />}
          </div>
        );
      })}
    </div>
  );
}
