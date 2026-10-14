import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { chainForTrip } from '../lib/chainApi.js';

// A clearly-scoped comparison, not a general route planner: it shows the
// single best direct backhaul load for this trip side-by-side with the
// single best 2-leg chain found among a bounded set of candidates
// (backend/services/chainFinder.js), and says which one wins on total
// estimated profit. Opt-in (behind a button) so it never runs unless a
// user actually wants the comparison, and it never changes anything the
// Find Loads tab above it already shows.
function LegCard({ leg, label }) {
  const { t } = useTranslation();
  const hasProfit = leg.profitability && !leg.profitability.error;
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 14, marginTop: 2 }}>
        {leg.load.pickupLocation} → {leg.load.deliveryLocation}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
        {leg.load.cargoType} · {leg.load.cargoWeightTonnes}t · ₹{leg.load.expectedPrice}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--primary)', fontWeight: 700, marginTop: 4 }}>
        {hasProfit ? `${t('chain.estProfit')} ₹${leg.profitability.estimatedProfit}` : '—'}
      </div>
    </div>
  );
}

export default function ChainComparison({ tripId }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setOpen(true);
    setError(null);
    setLoading(true);
    try {
      const data = await chainForTrip(tripId);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const rec = result?.recommendation;
  const diff = rec === 'chain_wins' && result.chain && result.directProfit != null ? result.chain.totalProfit - result.directProfit : null;

  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0 }}>{t('chain.heading')}</h3>
          <p className="form-help" style={{ marginTop: 4 }}>{t('chain.help')}</p>
        </div>
        <button className="btn btn-outline" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={run} disabled={loading}>
          {loading ? t('chain.comparing') : t('chain.compareButton')}
        </button>
      </div>

      {open && error && <p style={{ color: '#DC2626', fontSize: 13, marginTop: 10 }}>{error}</p>}

      {open && !error && result && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>{t('chain.directOption')}</div>
              {result.directBackhaul ? (
                <LegCard leg={result.directBackhaul} label={t('chain.leg', { n: 1 })} />
              ) : (
                <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('chain.noDirectFound')}</p>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>
                {t('chain.chainOption')}
                {result.chain && (
                  <span style={{ fontWeight: 700, color: 'var(--primary)', marginLeft: 8, fontSize: 12.5 }}>
                    {t('chain.totalProfit')}: ₹{result.chain.totalProfit}
                  </span>
                )}
              </div>
              {result.chain ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {result.chain.legs.map((leg, i) => (
                    <LegCard key={i} leg={leg} label={t('chain.leg', { n: i + 1 })} />
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('chain.noChainFound')}</p>
              )}
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 10,
              background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {rec === 'chain_wins' && t('chain.winnerChain', { amount: diff })}
            {rec === 'direct_wins' && t('chain.winnerDirect')}
            {rec === 'chain_only' && t('chain.chainOnlyFound')}
            {rec === 'direct_only' && t('chain.directOnlyFound')}
            {rec === 'none' && t('chain.noneFound')}
          </div>

          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{t('chain.scopeNote')}</p>
        </div>
      )}
    </div>
  );
}
