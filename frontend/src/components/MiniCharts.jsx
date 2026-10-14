import './widgets.css';

// Two small, dependency-free SVG charts -- no charting library is in this
// project (plain CSS, minimal deps is the established pattern here), and
// these datasets are small enough that hand-drawn SVG is simpler than
// pulling one in. Both are theme-aware via CSS custom properties resolved
// directly in SVG presentation attributes (supported in all modern
// browsers), so they follow the Forest & Gray light/dark tokens for free.

const W = 520;
const H = 180;
const PAD = 28;

// data: [{ label, value }], oldest-first.
export function MiniLineChart({ data, emptyText = 'Not enough data yet.' }) {
  if (!data || data.length < 2) {
    return <div className="wg-chart-empty">{emptyText}</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const stepX = (W - PAD * 2) / (data.length - 1);
  const points = data.map((d, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (1 - d.value / max) * (H - PAD * 2 - 10);
    return { x, y, ...d };
  });
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${H - PAD} L${points[0].x.toFixed(1)},${H - PAD} Z`;

  return (
    <svg className="wg-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="wgLineFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#wgLineFill)" stroke="none" />
      <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--card)" stroke="var(--primary)" strokeWidth="2" />
      ))}
      {points.map(
        (p, i) =>
          (i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) && (
            <text key={`l${i}`} x={p.x} y={H - 6} textAnchor="middle" className="wg-chart-axis-label">
              {p.label}
            </text>
          ),
      )}
    </svg>
  );
}

// data: [{ label, value, color? }]. color defaults to the theme primary.
export function MiniBarChart({ data, emptyText = 'No data yet.' }) {
  if (!data || data.every((d) => d.value === 0)) {
    return <div className="wg-chart-empty">{emptyText}</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = Math.min(52, (W - PAD * 2) / data.length - 16);
  const gap = (W - PAD * 2 - barW * data.length) / Math.max(1, data.length - 1);

  return (
    <svg className="wg-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {data.map((d, i) => {
        const x = PAD + i * (barW + gap);
        const barH = Math.max(3, (d.value / max) * (H - PAD * 2 - 14));
        const y = H - PAD - barH;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={barH} rx="6" fill={d.color || 'var(--primary)'} opacity={d.value === 0 ? 0.25 : 1} />
            <text x={x + barW / 2} y={H - PAD + 16} textAnchor="middle" className="wg-chart-axis-label">
              {d.label}
            </text>
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="wg-chart-bar-value">
              {d.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
