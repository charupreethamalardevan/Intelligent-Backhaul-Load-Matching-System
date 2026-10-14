import { IconTrendDown, IconTrendUp } from './icons.jsx';
import './widgets.css';

// A single stat tile: icon, label, big number, optional trend line.
// `trend` is optional: { direction: 'up' | 'down', text: '+12% this week' }.
// All real numbers computed by the caller from already-fetched app data --
// no fabricated percentages.
export default function StatCard({ icon: ItemIcon, label, value, trend, accent = 'primary' }) {
  return (
    <div className="wg-stat-card">
      <div className={`wg-stat-icon wg-accent-${accent}`}>{ItemIcon && <ItemIcon size={18} />}</div>
      <div className="wg-stat-body">
        <div className="wg-stat-label">{label}</div>
        <div className="wg-stat-value">{value}</div>
        {trend && (
          <div className={`wg-stat-trend wg-stat-trend-${trend.direction}`}>
            {trend.direction === 'down' ? <IconTrendDown size={13} /> : <IconTrendUp size={13} />}
            <span>{trend.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}
