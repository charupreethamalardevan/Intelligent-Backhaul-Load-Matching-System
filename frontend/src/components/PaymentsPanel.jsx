import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listRequests, STATUS_LABELS } from '../lib/requestApi.js';
import CompletedActions from './CompletedActions.jsx';
import './dataViews.css';

// Dedicated "Payments" dashboard, split out of RequestsPanel so recording
// a payment (and leaving a rating) for a finished booking has its own
// real-app-style place instead of being buried inline on every completed
// row of a general requests list. Only ever lists requests whose status
// is 'completed' -- i.e. payment only becomes possible once the trip is
// actually over, the same gate CompletedActions.jsx and the backend
// (paymentApi.js/ratingApi.js) already enforce; this just makes that gate
// the whole point of the page instead of a per-row aside.
export default function PaymentsPanel({ user }) {
  const { t } = useTranslation();
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(null);

  function load() {
    listRequests()
      .then((all) => setRequests(all.filter((r) => r.status === 'completed')))
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  return (
    <div className="dv-panel">
      <div className="dv-panel-head">
        <h2>
          {t('dashboard.section.payments.title', 'Payments')} · {requests.length}
        </h2>
      </div>
      <p className="dv-hint" style={{ padding: '0 18px 10px' }}>
        {t('dashboard.payments.help', 'A trip shows up here the moment it is marked completed -- payment and rating only unlock once the trip is actually over.')}
      </p>
      {error && <p style={{ color: '#DC2626', fontSize: 14, padding: '0 18px 10px' }}>{error}</p>}
      {requests.length === 0 ? (
        <div className="dv-empty">{t('dashboard.payments.noneYet', 'No completed trips to settle yet.')}</div>
      ) : (
        requests.map((r) => {
          const trip = r.tripId;
          const load = r.loadId;
          return (
            <div key={r._id} className="dv-req-row">
              <div className="dv-req-top">
                <div>
                  <div className="dv-req-route">
                    {trip ? `${trip.source} → ${trip.destination}` : 'Trip removed'}
                    <span className="sep"> carrying </span>
                    {load ? `${load.pickupLocation} → ${load.deliveryLocation}` : 'Load removed'}
                  </div>
                  <div className="dv-req-sub">
                    {load ? `${load.cargoType}, ${load.cargoWeightTonnes}t` : ''}
                    {r.profitability && !r.profitability.error ? ` · Est. profit ₹${r.profitability.estimatedProfit}` : ''}
                  </div>
                </div>
                <span className="dv-status-chip tone-done">{t(`status.${r.status}`, STATUS_LABELS[r.status] || r.status)}</span>
              </div>
              <CompletedActions request={r} user={user} />
            </div>
          );
        })
      )}
    </div>
  );
}
