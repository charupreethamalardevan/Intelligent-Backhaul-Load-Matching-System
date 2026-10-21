import './dataViews.css';

// Stacked distribution bar + legend -- replaces the old axis-labeled
// MiniBarChart for this one spot, since what a Fleet Owner needs here is
// the proportion of requests sitting in each stage at a glance, not a
// bar-per-bucket chart with axis labels. `buckets`: [{ key, label, value,
// color }] -- color is a CSS color value (the caller passes var(--token)
// so it stays theme-aware); values come from the same status counts
// FleetDashboard already computes for its own data.
export default function RequestPipeline({ buckets, emptyText = 'No requests yet.' }) {
  const total = buckets.reduce((sum, b) => sum + b.value, 0);
  return (
    <div className="dv-panel">
      <div className="dv-panel-head">
        <h2>Request pipeline</h2>
        <span className="dv-hint">{total} total</span>
      </div>
      {total === 0 ? (
        <div className="dv-empty">{emptyText}</div>
      ) : (
        <>
          <div className="dv-pipeline-bar">
            {buckets.map((b) => b.value > 0 && <div key={b.key} style={{ width: `${(b.value / total) * 100}%`, background: b.color }} />)}
          </div>
          <div className="dv-pipeline-legend">
            {buckets.map((b) => (
              <div className="dv-pipeline-legend-row" key={b.key}>
                <span className="lbl">
                  <span className="dv-pipeline-sw" style={{ background: b.color }} />
                  {b.label}
                </span>
                <span className="val">{b.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
