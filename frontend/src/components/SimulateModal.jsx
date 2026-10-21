import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { updateRequestStatus, STATUS_LABELS } from '../lib/requestApi.js';
import { IconCheckCircle, IconZap } from './icons.jsx';
import './dataViews.css';

// Walks the same lifecycle backend/routes/requests.js's ALLOWED_TRANSITIONS
// enforces, one real PATCH at a time -- see RequestsPanel.jsx's header
// comment for why this is a demo convenience and not a shortcut around the
// backend.
const SIM_PATH = ['pending_fleet_approval', 'requested', 'accepted', 'confirmed', 'pickup', 'in_transit', 'delivered', 'completed'];

// Deliberately slow (per the user's "I want it to open big and slow") --
// this is meant to be *watched*, e.g. while recording a demo video, not
// raced through. 2.2s/step keeps 7 steps under 16s total.
const STEP_DELAY_MS = 2200;

// A big, centered "Simulate" dialog -- opened from a Current Trip row's
// Simulate button instead of the status quietly flipping in the
// background. Shows the whole lifecycle as a stepper and animates through
// it one real status update at a time, so what's happening is actually
// visible (and demo-recordable) rather than just a disabled button and a
// changing chip.
export default function SimulateModal({ request, onClose, onAdvance }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(request?.status || null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (request) {
      setCurrent(request.status);
      setError(null);
      setDone(request.status === 'completed');
      cancelledRef.current = false;
    }
  }, [request?._id]);

  useEffect(() => {
    if (!request) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  if (!request) return null;

  async function run() {
    setRunning(true);
    setError(null);
    let c = current;
    try {
      while (c !== 'completed' && !cancelledRef.current) {
        const next = SIM_PATH[SIM_PATH.indexOf(c) + 1];
        if (!next) break;
        await new Promise((resolve) => setTimeout(resolve, STEP_DELAY_MS));
        if (cancelledRef.current) break;
        await updateRequestStatus(request._id, next);
        c = next;
        setCurrent(next);
        onAdvance?.();
      }
      if (c === 'completed') setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  function handleClose() {
    cancelledRef.current = true;
    onClose();
  }

  const idx = SIM_PATH.indexOf(current);

  return (
    <>
      <div className="sim-backdrop" onClick={handleClose} />
      <div className="sim-modal" role="dialog" aria-modal="true" aria-label={t('sim.modalTitle', 'Simulate booking')}>
        <div className="sim-head">
          <div>
            <h2>{t('sim.modalTitle', 'Simulate booking')}</h2>
            <p className="sim-sub">
              {request.tripId ? `${request.tripId.source} → ${request.tripId.destination}` : 'Trip removed'}
              {request.loadId ? ` · ${request.loadId.pickupLocation} → ${request.loadId.deliveryLocation}` : ''}
            </p>
          </div>
          <button type="button" className="btn btn-outline" onClick={handleClose}>
            {t('common.close', 'Close')}
          </button>
        </div>
        <div className="sim-body">
          <div className="sim-steps">
            {SIM_PATH.map((s, i) => (
              <div key={s} className={`sim-step ${i < idx ? 'done' : i === idx ? 'active' : ''}`}>
                <div className="sim-step-dot">{i < idx ? <IconCheckCircle size={16} /> : i + 1}</div>
                <div className="sim-step-label">{t(`status.${s}`, STATUS_LABELS[s] || s)}</div>
              </div>
            ))}
          </div>
          {error && <p className="sim-error">{t('sim.stopped', 'Simulation stopped: {{message}}', { message: error })}</p>}
          {done && !error && <p className="sim-success">{t('sim.done', 'Booking completed — head to Payments to settle it.')}</p>}
          <div className="sim-actions">
            {!done && (
              <button type="button" className="btn btn-primary" disabled={running} onClick={run}>
                <IconZap size={14} /> {running ? t('sim.running', 'Simulating...') : t('sim.start', 'Start simulation')}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
