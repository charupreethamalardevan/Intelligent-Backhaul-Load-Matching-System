import './widgets.css';

// items: [{ id, icon, title, subtitle, time, accent? }]. `time` is a
// pre-formatted string (the caller decides relative vs absolute).
export default function ActivityList({ items, emptyText = 'Nothing yet.' }) {
  if (!items || items.length === 0) {
    return <p className="wg-muted">{emptyText}</p>;
  }
  return (
    <div className="wg-activity-list">
      {items.map((it) => {
        const ItemIcon = it.icon;
        return (
          <div className="wg-activity-item" key={it.id}>
            <div className={`wg-activity-icon wg-accent-${it.accent || 'primary'}`}>{ItemIcon && <ItemIcon size={15} />}</div>
            <div className="wg-activity-body">
              <div className="wg-activity-title">{it.title}</div>
              {it.subtitle && <div className="wg-activity-subtitle">{it.subtitle}</div>}
            </div>
            {it.time && <div className="wg-activity-time">{it.time}</div>}
          </div>
        );
      })}
    </div>
  );
}
