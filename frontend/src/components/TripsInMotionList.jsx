import './dataViews.css';

// `trips`: pre-computed rows [{ id, route, meta, statusLabel, tone }].
// FleetDashboard builds these by joining its own already-fetched trips and
// requests (a trip's displayed status comes from its matched request's
// real lifecycle status when one exists -- e.g. "In Transit" -- falling
// back to the Trip document's own available/matched/completed/cancelled
// status otherwise). No new data, no new API calls, nothing fabricated.
export default function TripsInMotionList({ trips, onViewAll, emptyText = 'No trips planned yet.' }) {
  return (
    <div className="dv-panel">
      <div className="dv-panel-head">
        <h2>Trips in motion</h2>
        {onViewAll && trips.length > 0 && (
          <button
            type="button"
            style={{ background: 'none', border: 'none', fontSize: 12.5, color: 'var(--primary)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            onClick={onViewAll}
          >
            View all
          </button>
        )}
      </div>
      {trips.length === 0 ? (
        <div className="dv-empty">{emptyText}</div>
      ) : (
        trips.map((t) => (
          <div className="dv-trip-row" key={t.id}>
            <span className={`dv-status-chip tone-${t.tone}`}>{t.statusLabel}</span>
            <div className="dv-trip-route">{t.route}</div>
            <div className="dv-trip-meta">{t.meta}</div>
          </div>
        ))
      )}
    </div>
  );
}
