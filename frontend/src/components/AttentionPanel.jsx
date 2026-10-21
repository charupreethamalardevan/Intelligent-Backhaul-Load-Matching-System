import './dataViews.css';

// "Needs your attention" -- the one thing a Fleet Owner should see first:
// driver-initiated requests waiting on their approval, and vehicles with
// no driver assigned. This panel owns no logic of its own; every action
// FleetDashboard wires in here calls the exact same functions
// (updateRequestStatus, navigating to the Vehicles tab to assign a driver)
// the rest of the dashboard already uses. Renders nothing when the fleet
// has nothing pending, rather than an empty "all caught up" card.
export default function AttentionPanel({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="dv-panel dv-section-gap">
      <div className="dv-panel-head">
        <h2>Needs your attention</h2>
        <span className="dv-hint">
          {items.length} item{items.length === 1 ? '' : 's'}
        </span>
      </div>
      {items.map((item) => (
        <div className="dv-attn-row" key={item.id}>
          <span className="dv-attn-dot" />
          <div className="dv-attn-text">{item.text}</div>
          <div className="dv-attn-actions">
            {item.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={a.variant === 'primary' ? 'btn btn-primary' : 'btn btn-outline'}
                style={{ fontSize: 13 }}
                disabled={a.disabled}
                onClick={a.onClick}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
