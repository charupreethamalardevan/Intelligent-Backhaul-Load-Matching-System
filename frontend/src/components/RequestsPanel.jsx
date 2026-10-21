import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listRequests, updateRequestStatus, STATUS_LABELS, NEXT_ACTIONS } from '../lib/requestApi.js';
import { timeAgo } from '../lib/time.js';
import TripMapModal from './TripMapModal.jsx';
import SimulateModal from './SimulateModal.jsx';
import { IconZap, IconCheckCircle, IconX } from './icons.jsx';
import './dataViews.css';

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

// A booking is "history" once it's reached one of these -- there is no
// way back out of any of them (see backend/routes/requests.js's
// ALLOWED_TRANSITIONS, which never lists a next state for any of the
// three). Everything else is still moving and belongs on "Current Trip".
const TERMINAL_STATUSES = ['completed', 'rejected', 'cancelled'];

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

// Same tone vocabulary FleetDashboard's status chips already use
// (open/pending/active/primary/done/rejected) -- kept here as a pure
// display mapping over the real backend status, nothing invented.
function requestTone(status) {
  switch (status) {
    case 'pending_fleet_approval':
      return 'pending';
    case 'requested':
      return 'open';
    case 'accepted':
    case 'confirmed':
      return 'primary';
    case 'pickup':
    case 'in_transit':
    case 'delivered':
      return 'active';
    case 'completed':
      return 'done';
    case 'rejected':
    case 'cancelled':
      return 'rejected';
    default:
      return 'open';
  }
}

// Shared between FleetDashboard and PosterDashboard -- the booking
// lifecycle (SRS Section 13) is symmetric, both sides see the same list
// filtered to their own requests and can advance it the same way. The
// backend (requests.js) is the real authority on who may do what; this
// just offers the buttons that are plausible for the current status.
// `user` is needed for exactly one case: a request pending_fleet_approval
// is visible to both the Fleet Driver who created it and their Fleet
// Owner, but only the Fleet Owner may approve/reject it -- the driver
// only gets a Cancel button for their own request.
//
// `mode` splits this single list into two separate, real-app-style
// dashboards instead of one flat feed mixing everything together:
//   'current' (default) -- every booking still moving (not yet completed,
//      rejected or cancelled). Gets the full action buttons, "Start
//      Navigation", and the "Simulate" demo control.
//   'history' -- every booking that's done, one way or another. Fully
//      read-only -- no action buttons, no Start Navigation, no Simulate --
//      just a record of what happened and when.
// Recording payment for a completed booking lives in its own dashboard
// now (PaymentsPanel.jsx), not inline here.
//
// `focusId` (optional) is a request id to scroll to and briefly highlight
// on mount -- used by FleetDashboard when a Trip Planner row with a live
// booking is clicked, so "open in Current Trip" actually lands the user
// on the right row instead of just switching tabs. `onFocusHandled` lets
// the parent clear its own copy of that id once this panel has it, so a
// later unrelated visit to Current Trip doesn't re-highlight a stale row.
export default function RequestsPanel({ user, mode = 'current', focusId = null, onFocusHandled }) {
  const { t } = useTranslation();
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // The request currently open in the "Start Navigation" popup, or in the
  // "Simulate" dialog (or null when closed) -- neither sits inline on the
  // row itself anymore, both only ever show once explicitly asked for.
  const [navigatingId, setNavigatingId] = useState(null);
  const [simulatingId, setSimulatingId] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const rowRefs = useRef({});

  function load() {
    listRequests()
      .then(setRequests)
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  useEffect(() => {
    if (!focusId) return undefined;
    setHighlightId(focusId);
    onFocusHandled?.();
    const timer = setTimeout(() => setHighlightId(null), 2800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the id
    // itself should re-trigger this, not onFocusHandled's identity.
  }, [focusId]);

  useEffect(() => {
    if (highlightId && rowRefs.current[highlightId]) {
      rowRefs.current[highlightId].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightId, requests]);

  const visibleRequests = requests.filter((r) => (mode === 'history' ? TERMINAL_STATUSES.includes(r.status) : !TERMINAL_STATUSES.includes(r.status)));

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

  return (
    <div className="dv-panel">
      <div className="dv-panel-head">
        <h2>
          {mode === 'history'
            ? `${t('dashboard.section.history.title', 'History')} · ${visibleRequests.length}`
            : `${t('dashboard.section.currentTrip.title', 'Current Trip')} · ${visibleRequests.length}`}
        </h2>
      </div>
      {error && <p style={{ color: '#DC2626', fontSize: 14, padding: '0 18px 10px' }}>{error}</p>}
      {visibleRequests.length === 0 ? (
        <div className="dv-empty">
          {mode === 'history'
            ? t('dashboard.history.noneYet', 'No finished bookings yet -- completed, rejected and cancelled trips will show up here.')
            : t('dashboard.requests.noneYet', 'No booking requests yet.')}
        </div>
      ) : (
        visibleRequests.map((r) => {
          const trip = r.tripId;
          const load = r.loadId;
          let actions = NEXT_ACTIONS[r.status] || [];
          let hint = null;
          const isRequester = String(r.requestedBy) === String(user?.id);
          if (r.status === 'pending_fleet_approval') {
            if (user?.role === 'fleet_owner') {
              actions = ['requested', 'rejected'];
              hint = 'One of your drivers requested this load. Approve to send it on to the Load Poster, or reject it.';
            } else {
              actions = ['cancelled'];
              hint = "Waiting for your Fleet Owner to approve this before it's sent to the Load Poster.";
            }
          } else if (r.status === 'requested') {
            // The backend (matches.js) refuses to let whoever created a
            // request accept/reject it themselves -- "that's up to the
            // other party" -- so the requester only ever gets Cancel here,
            // and the other side only ever gets Accept/Reject. Previously
            // this showed NEXT_ACTIONS['requested'] (all three buttons) to
            // BOTH sides unconditionally, so the requester could click
            // "Accept" on their own request and get a 403 back from the
            // server for a button that was never going to work for them.
            if (isRequester) {
              actions = ['cancelled'];
              hint = t('dashboard.requests.waitingOtherSide', 'Waiting for the other party to accept or reject.');
            } else {
              actions = ['accepted', 'rejected'];
            }
          }
          const canSimulate = mode === 'current' && trip && !TERMINAL_STATUSES.includes(r.status);
          const tone = requestTone(r.status);
          const rowClass = mode === 'history' ? `dv-req-row dv-req-row-history tone-${tone}` : 'dv-req-row';
          return (
            <div
              key={r._id}
              ref={(el) => {
                rowRefs.current[r._id] = el;
              }}
              className={`${rowClass}${highlightId === r._id ? ' dv-req-row-highlight' : ''}`}
            >
              <div className="dv-req-top">
                <div>
                  <div className="dv-req-route">
                    {trip ? `${trip.source} → ${trip.destination}` : 'Trip removed'}
                    <span className="sep"> carrying </span>
                    {load ? `${load.pickupLocation} → ${load.deliveryLocation}` : 'Load removed'}
                  </div>
                  <div className="dv-req-sub">
                    Match score {r.matchScore} · {load ? `${load.cargoType}, ${load.cargoWeightTonnes}t` : ''}
                    {r.profitability && !r.profitability.error ? ` · Est. profit ₹${r.profitability.estimatedProfit}` : ''}
                  </div>
                  {hint && <div className="dv-req-hint">{hint}</div>}
                </div>
                <div className="dv-req-meta">
                  <span className={`dv-status-chip tone-${tone}`}>
                    {tone === 'done' && <IconCheckCircle size={11} />} {tone === 'rejected' && <IconX size={11} />}{' '}
                    {t(`status.${r.status}`, STATUS_LABELS[r.status] || r.status)}
                  </span>
                  {mode === 'history' && <span className="dv-req-time">{timeAgo(r.updatedAt || r.createdAt)}</span>}
                </div>
              </div>
              {mode === 'current' && (actions.length > 0 || (TRACKABLE_STATUSES.includes(r.status) && trip) || canSimulate) && (
                <div className="dv-req-actions">
                  {actions.map((a) => (
                    <button
                      key={a}
                      className={a === 'rejected' || a === 'cancelled' ? 'btn btn-outline' : 'btn btn-primary'}
                      style={{ fontSize: 13 }}
                      disabled={busyId === r._id}
                      onClick={() => act(r._id, a)}
                    >
                      {ACTION_LABELS[a] || a}
                    </button>
                  ))}
                  {TRACKABLE_STATUSES.includes(r.status) && trip && (
                    <button type="button" className="btn btn-outline" style={{ fontSize: 13 }} onClick={() => setNavigatingId(r._id)}>
                      {t('map.startNavigation', 'Start Navigation')}
                    </button>
                  )}
                  {canSimulate && (
                    <button
                      type="button"
                      className="btn btn-outline dv-sim-btn"
                      style={{ fontSize: 13 }}
                      title={t('sim.hint', 'Opens a big step-by-step simulation that fast-forwards this booking to Completed, for a demo.')}
                      onClick={() => setSimulatingId(r._id)}
                    >
                      <IconZap size={13} /> {t('sim.fastForward', 'Simulate')}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
      <TripMapModal
        request={requests.find((r) => r._id === navigatingId) || null}
        canShareLocation={isVehicleSide(requests.find((r) => r._id === navigatingId) || {}, user)}
        onClose={() => setNavigatingId(null)}
      />
      <SimulateModal request={requests.find((r) => r._id === simulatingId) || null} onClose={() => setSimulatingId(null)} onAdvance={load} />
    </div>
  );
}
