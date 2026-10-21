import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const FACTOR_LABELS = {
  routeCompatibility: 'Route Compatibility',
  capacityCompatibility: 'Capacity Fit',
  timingCompatibility: 'Timing',
  cargoVehicleFit: 'Cargo / Vehicle Fit',
  detourEfficiency: 'Detour Efficiency',
  profitability: 'Profitability',
  reliability: 'Reliability',
};

function ScoreRing({ score }) {
  const color = score >= 75 ? 'var(--primary)' : score >= 50 ? '#D97706' : '#DC2626';
  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: `4px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: 17,
        flexShrink: 0,
      }}
    >
      {score}
    </div>
  );
}

function FactorBar({ label, value, weight }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--muted)', marginBottom: 2 }}>
        <span>
          {label} <span style={{ opacity: 0.7 }}>({Math.round(weight * 100)}%)</span>
        </span>
        <span style={{ fontWeight: 700 }}>{Math.round(value)}</span>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${Math.max(0, Math.min(100, value))}%`,
            background: 'linear-gradient(90deg, color-mix(in srgb, var(--primary) 70%, white), var(--primary))',
          }}
        />
      </div>
    </div>
  );
}

// Renders ranked matching results from either /matching/for-trip (mode
// "trip": each result carries a candidate `load`; `fixedId` is that trip's
// own id) or /matching/for-load (mode "load": each result carries a
// candidate `trip` + `vehicle`; `fixedId` is that load's own id).
// `onRequest(tripId, loadId)` fires the actual booking request.
// A small, clearly-labelled chip for ML Module 1's output (ml-service/ --
// a classifier trained on a synthetic dataset, since there's no real
// historical match-outcome data yet to train on). Always shown alongside,
// never instead of, the explainable rule-based score above -- and simply
// omitted (m.mlCompatibility is undefined) whenever the Python microservice
// wasn't reachable, so there's nothing to recover from on the frontend.
function MlBadge({ probability }) {
  const { t } = useTranslation();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: 'color-mix(in srgb, var(--primary) 15%, transparent)',
        color: 'var(--primary)',
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11.5,
        whiteSpace: 'nowrap',
      }}
      title={t('ml.syntheticNote')}
    >
      {t('ml.compatibilityLabel')}: {Math.round(probability * 100)}%
    </span>
  );
}

// Same clearly-labelled-chip pattern as MlBadge above, for ML Module 2
// (Profitability Prediction, Addendum 36) -- a second, independent model
// trained on synthetic data that predicts a realized profit margin,
// shown alongside (never instead of) the existing rule-based profitability
// estimate above it. Omitted whenever m.mlProfitability is undefined,
// exactly like MlBadge.
function MlProfitabilityBadge({ marginPct }) {
  const { t } = useTranslation();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: 'color-mix(in srgb, #D97706 15%, transparent)',
        color: '#D97706',
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11.5,
        whiteSpace: 'nowrap',
      }}
      title={t('ml.profitabilityNote')}
    >
      {t('ml.profitabilityLabel')}: {marginPct}%
    </span>
  );
}

export default function MatchResults({ matches, mode, fixedId, onRequest }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState(null);

  if (!matches || matches.length === 0) {
    return <p style={{ fontSize: 14, color: 'var(--muted)' }}>No eligible matches right now. Try adjusting dates or capacity.</p>;
  }

  async function handleRequest(m, key) {
    setError(null);
    setBusyKey(key);
    try {
      const tripId = mode === 'trip' ? fixedId : m.trip._id;
      const loadId = mode === 'trip' ? m.load._id : fixedId;
      await onRequest(tripId, loadId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <p style={{ color: '#DC2626', fontSize: 14 }}>{error}</p>}
      {matches.map((m, idx) => {
        const key = mode === 'trip' ? m.load._id : `${m.trip._id}-${m.vehicle._id}`;
        const isOpen = expanded === key;
        return (
          <div key={key} className="card">
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <ScoreRing score={m.matchScore} />
              <div style={{ flex: 1 }}>
                {mode === 'trip' ? (
                  <>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>
                      {m.load.pickupLocation} → {m.load.deliveryLocation}
                    </div>
                    <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>
                      {m.load.cargoType} · {m.load.cargoWeightTonnes}t · expects ₹{m.load.expectedPrice}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>
                      {m.trip.source} → {m.trip.destination}
                    </div>
                    <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>
                      {m.vehicle.vehicleNumber} · {m.vehicle.vehicleType.replace('_', ' ')} · {m.vehicle.maxCapacityTonnes}t capacity
                    </div>
                  </>
                )}
                <div style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 700, marginTop: 2 }}>
                  Detour: {m.detourKm} km
                  {m.profitability && !m.profitability.error ? ` · Est. profit ₹${m.profitability.estimatedProfit}` : ''}
                </div>
                {(m.mlCompatibility != null || m.mlProfitability != null) && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {m.mlCompatibility != null && <MlBadge probability={m.mlCompatibility} />}
                    {m.mlProfitability != null && <MlProfitabilityBadge marginPct={m.mlProfitability.predictedMarginPct} />}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button className="btn btn-outline" style={{ fontSize: 13 }} onClick={() => setExpanded(isOpen ? null : key)}>
                  {isOpen ? 'Hide details' : 'Why this score?'}
                </button>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 13 }}
                  disabled={busyKey === key}
                  onClick={() => handleRequest(m, key)}
                >
                  {busyKey === key ? 'Requesting...' : 'Request booking'}
                </button>
              </div>
            </div>

            {isOpen && (
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                {Object.keys(m.factors).map((k) => (
                  <FactorBar key={k} label={FACTOR_LABELS[k] || k} value={m.factors[k]} weight={m.weights[k]} />
                ))}
                {m.profitability && !m.profitability.error && (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>
                    Revenue ₹{m.profitability.revenue} · Est. cost ₹{m.profitability.estimatedOperatingCost} ({m.profitability.assumptions})
                  </div>
                )}
                {m.mlCompatibility != null && (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                    <strong style={{ color: 'var(--text)' }}>
                      {t('ml.compatibilityLabel')}: {Math.round(m.mlCompatibility * 100)}%
                    </strong>{' '}
                    — {t('ml.syntheticNote')}
                  </div>
                )}
                {m.mlProfitability != null && (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                    <strong style={{ color: 'var(--text)' }}>
                      {t('ml.profitabilityLabel')}: {m.mlProfitability.predictedMarginPct}% (₹{m.mlProfitability.predictedProfit})
                    </strong>{' '}
                    — {t('ml.profitabilityNote')}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
